"""
DingerLab Engine Server
=======================
Server-side parlay engine + OddsBlaze proxy for the DingerLab front-end.

Endpoints
---------
POST /api/engine     — authoritative parlay build. Body: {"players": [...], "stake": 25}
                       Mirrors the front-end's on-device engine exactly (same ensemble,
                       same confidence weights, same combinatorial search), so results
                       agree whether or not the server is reachable.
GET  /api/oddsblaze  — OddsBlaze pass-through with CORS. Reads ODDSBLAZE_KEY from env.
                       Query: ?sportsbook=draftkings&league=mlb
GET  /health         — liveness check.

Run
---
    pip install flask requests
    ODDSBLAZE_KEY=your-key python engine_server.py

Env
---
    ODDSBLAZE_KEY               required for /api/oddsblaze
    PORT                        default 8502
    DINGERLAB_ALLOWED_ORIGIN    default * (lock to your GitHub Pages origin in prod)
"""

import json
import math
import os
from itertools import combinations

import requests
from flask import Flask, jsonify, request

app = Flask(__name__)

ALLOWED_ORIGIN = os.environ.get("DINGERLAB_ALLOWED_ORIGIN", "*")
ODDSBLAZE_KEY = os.environ.get("ODDSBLAZE_KEY", "")
ODDSBLAZE_URL = "https://odds.oddsblaze.com/"


# ── CORS ──────────────────────────────────────────────────────────────────────

@app.after_request
def add_cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = ALLOWED_ORIGIN
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


@app.route("/api/engine", methods=["OPTIONS"])
@app.route("/api/oddsblaze", methods=["OPTIONS"])
def preflight():
    return ("", 204)


# ── Odds helpers (identical to front-end amDec / amImp / decAm) ───────────────

def am_dec(a):
    return 1 + a / 100.0 if a > 0 else 1 + 100.0 / (-a)


def am_imp(a):
    return 100.0 / (a + 100.0) if a > 0 else (-a) / float(-a + 100)


def dec_am(d):
    return ("+%d" % round((d - 1) * 100)) if d >= 2 else ("-%d" % round(100 / (d - 1)))


# ── Engine (mirror of the front-end computeEngine — keep in lockstep) ─────────

def headshot(pid):
    return "https://midfield.mlbstatic.com/v1/people/%s/spots/120" % pid if pid else ""


def ring(score):
    s = score if isinstance(score, (int, float)) else 70
    return "conic-gradient(var(--ac,#ff8a4c) %d%%, rgba(255,255,255,.08) 0)" % round(s)


def compute_engine(players, stake):
    stake = max(1.0, float(stake or 25))
    pool = [p for p in players if (p.get("pa") or 0) >= 80 and (p.get("modelPct") or 0) >= 4]

    def distinct_games(arr):
        return len({p.get("gameId") for p in arr})

    confirmed_pool = [p for p in pool if p.get("lineupConfirmed")]
    # Only narrow to confirmed lineups when they span enough games to parlay across;
    # a single early-posting game must not starve the whole slate.
    using_confirmed = len(confirmed_pool) >= 2 and distinct_games(confirmed_pool) >= 2
    if using_confirmed:
        pool = confirmed_pool
    if len(pool) < 2:
        return {"ok": False, "reason": "Waiting on the slate — the engine needs at least two qualified hitters (80+ PA, 4%+ model HR) to build."}

    scored = []
    for p in pool:
        model_p = max(0.01, min(0.60, (p.get("modelPct") or 0) / 100.0))
        odds_am = p.get("oddsAm")
        mkt_p, true_p = None, model_p
        if odds_am is not None:
            mkt_p = max(0.01, min(0.70, am_imp(odds_am) * 0.92))
            true_p = 0.60 * model_p + 0.40 * mkt_p
        conf = 0.46
        conf += min(0.18, ((p.get("pa") or 0) - 80) / 900.0)
        if (p.get("barrelPct") or 0) >= 10:
            conf += 0.08
        if (p.get("hardHitPct") or 0) >= 42:
            conf += 0.05
        if p.get("lineupConfirmed"):
            conf += 0.10
        if mkt_p is not None:
            conf += max(0.0, 0.13 - abs(model_p - mkt_p) * 1.6)
        conf = max(0.20, min(0.97, conf))
        dec = am_dec(odds_am) if odds_am is not None else max(1.4, (1 / true_p) * 0.92)
        edge = (true_p - mkt_p) if mkt_p is not None else None
        scored.append(dict(p, engTrueP=true_p, engConf=conf, engDec=dec, engEdge=edge,
                           engRank=true_p * (0.72 + 0.28 * conf)))

    has_odds = any(p.get("oddsAm") is not None for p in scored)
    ranked = sorted(scored, key=lambda p: -p["engRank"])

    def matchup(p):
        return "%s vs %s" % (p.get("team", ""), p.get("opp", ""))

    def ord_slot(p):
        n = p.get("lineupSlot")
        if not n:
            return ""
        suf = "st" if n == 1 else "nd" if n == 2 else "rd" if n == 3 else "th"
        return " · bats %d%s" % (n, suf)

    picks = []
    for i, p in enumerate(ranked[:8]):
        e = p["engEdge"]
        picks.append({
            "id": p["id"], "rank": i + 1, "name": p.get("name", ""), "matchup": matchup(p),
            "ring": ring(p.get("score")), "headshot": headshot(p.get("id")),
            "truePct": "%.1f%%" % (p["engTrueP"] * 100),
            "modelLabel": "model %s%%%s" % (p.get("modelPct"), ord_slot(p)),
            "odds": ("%+d" % p["oddsAm"]) if p.get("oddsAm") is not None else "no line",
            "oddsColor": "#eef1f6" if p.get("oddsAm") is not None else "#5f6878",
            "edgeLabel": ("%+.1f pts" % (e * 100)) if e is not None else "—",
            "edgeColor": ("var(--pos,#35d0c0)" if e >= 0 else "#ff8d8d") if e is not None else "#5f6878",
            "confPct": "%d%%" % round(p["engConf"] * 100),
            "barW": "%d%%" % min(100, round(p["engTrueP"] * 220)),
        })

    top_build = ranked[:14]
    build_games = len({p.get("gameId") for p in top_build})

    def stats_of(legs):
        win_p, dec = 1.0, 1.0
        for l in legs:
            win_p *= l["engTrueP"]
            dec *= l["engDec"]
        conf = sum(l["engConf"] for l in legs) / len(legs)
        any_real = any(l.get("oddsAm") is not None for l in legs)
        all_real = all(l.get("oddsAm") is not None for l in legs)
        return {"winP": win_p, "dec": dec, "ev": win_p * dec - 1, "conf": conf,
                "anyReal": any_real, "allReal": all_real}

    def build_best(k, objective, gate=None):
        # One leg per game whenever the slate allows; on a thin slate allow up to 2 per game.
        cap = 1 if build_games >= k else 2
        best, best_score = None, -math.inf
        for legs in combinations(top_build, k):
            counts = {}
            for l in legs:
                counts[l.get("gameId")] = counts.get(l.get("gameId"), 0) + 1
            if max(counts.values()) > cap:
                continue
            st = stats_of(legs)
            if gate and not gate(st):
                continue
            sc = objective(st)
            if sc > best_score:
                best_score, best = sc, (list(legs), st)
        return best

    safe = build_best(2, lambda st: st["winP"] * (0.7 + 0.3 * st["conf"]))
    balanced = build_best(3,
                          (lambda st: st["ev"] + st["winP"] * 0.5) if has_odds
                          else (lambda st: st["winP"] * (0.7 + 0.3 * st["conf"])),
                          lambda st: st["winP"] >= 0.015)
    longshot = build_best(4, lambda st: math.log(st["dec"]) * (0.6 + 0.4 * st["conf"]),
                          lambda st: st["winP"] >= 0.004)

    def mk_parlay(key, title, sub, built):
        if not built:
            return None
        legs, st = built
        grade_pts = st["conf"] * 40 + min(30, st["winP"] * 180) + \
            (max(-10, min(30, st["ev"] * 120)) if st["allReal"] else 10)
        grade = "A" if grade_pts >= 72 else "B" if grade_pts >= 58 else "C" if grade_pts >= 45 else "D"
        grade_color = {"A": "var(--pos,#35d0c0)", "B": "#9edb63", "C": "#ffc24d", "D": "#ff8d8d"}[grade]
        return {
            "key": key, "title": title, "sub": sub, "nLegs": len(legs),
            "legIds": [l["id"] for l in legs],
            "legs": [{
                "id": l["id"], "name": l.get("name", ""), "matchup": matchup(l),
                "ring": ring(l.get("score")), "headshot": headshot(l.get("id")),
                "truePct": "%.1f%%" % (l["engTrueP"] * 100),
                "odds": ("%+d" % l["oddsAm"]) if l.get("oddsAm") is not None else "model",
                "oddsColor": "var(--ac,#ff8a4c)" if l.get("oddsAm") is not None else "#5f6878",
            } for l in legs],
            "winPct": "%.1f%%" % (st["winP"] * 100),
            "winPNum": round(st["winP"] * 100, 2),
            "odds": dec_am(st["dec"]),
            "ev": ("%+.1f%%" % (st["ev"] * 100)) if st["allReal"] else "model-fair",
            "evColor": ("var(--pos,#35d0c0)" if st["ev"] >= 0 else "#ff8d8d") if st["allReal"] else "#9aa3b2",
            "payout": "${:,}".format(round(stake * st["dec"])),
            "stakeLabel": "$%g returns" % stake,
            "confPct": "%d%%" % round(st["conf"] * 100),
            "grade": grade, "gradeColor": grade_color,
            "synthetic": not st["anyReal"],
        }

    parlays = [p for p in [
        mk_parlay("safe", "Safest cash", "2 legs · highest hit rate on the slate", safe),
        mk_parlay("balanced", "Best value", "3 legs · strongest price vs true probability", balanced),
        mk_parlay("longshot", "Max payout", "4 legs · biggest return that still clears the gate", longshot),
    ] if p]

    top = ranked[0]
    return {
        "ok": True, "picks": picks, "parlays": parlays,
        "summary": {
            "candidates": len(pool),
            "topName": top.get("name", ""),
            "topPct": "%.1f%%" % (top["engTrueP"] * 100),
            "avgConf": "%d%%" % round(sum(p["engConf"] for p in scored) / len(scored) * 100),
            "oddsLabel": "Model + live market blend" if has_odds else "Model only — no live odds yet",
            "oddsColor": "var(--pos,#35d0c0)" if has_odds else "#ffc24d",
            "lineupLabel": "Confirmed lineups only" if using_confirmed else ("Full slate — few lineups posted" if confirmed_pool else "Lineups not posted yet"),
        },
    }


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/api/engine", methods=["POST"])
def api_engine():
    try:
        body = request.get_json(force=True, silent=True) or {}
        players = body.get("players") or []
        if not isinstance(players, list):
            return jsonify({"ok": False, "reason": "players must be a list"}), 400
        return jsonify(compute_engine(players, body.get("stake", 25)))
    except Exception as e:  # noqa: BLE001 — engine must never 500 opaquely
        return jsonify({"ok": False, "reason": "engine error: %s" % e}), 500


@app.route("/api/oddsblaze")
def api_oddsblaze():
    if not ODDSBLAZE_KEY:
        return jsonify({"error": "ODDSBLAZE_KEY env var not set on this server"}), 503
    sportsbook = request.args.get("sportsbook", "draftkings")
    league = request.args.get("league", "mlb")
    try:
        r = requests.get(ODDSBLAZE_URL, params={
            "key": ODDSBLAZE_KEY, "sportsbook": sportsbook,
            "league": league, "market_contains": "Home Run",
        }, timeout=20)
        return app.response_class(r.content, status=r.status_code, mimetype="application/json")
    except requests.RequestException as e:
        return jsonify({"error": "oddsblaze fetch failed: %s" % e}), 502


@app.route("/health")
def health():
    return jsonify({"ok": True, "engine": True, "oddsblaze_key": bool(ODDSBLAZE_KEY)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8502)))
