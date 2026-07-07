import json
import os
import sys
import threading
import re
import time
import unicodedata
from datetime import datetime
from pathlib import Path

import requests
from flask import Flask, jsonify, request
from flask_cors import CORS

APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "server_data"
DATA_DIR.mkdir(exist_ok=True)
STATE_PATH = DATA_DIR / "dingerlab_server_state.json"
LOCK = threading.Lock()

app = Flask(__name__, static_folder=str(APP_DIR), static_url_path="")
# Lock CORS to your front-end origin in production by setting DINGERLAB_ALLOWED_ORIGIN
# (e.g. https://you.github.io). Defaults to "*" so an unconfigured deploy still works.
_ALLOWED_ORIGIN = os.environ.get("DINGERLAB_ALLOWED_ORIGIN", "*")
CORS(app, resources={r"/api/*": {"origins": _ALLOWED_ORIGIN}})

ODDSBLAZE_DEFAULT_KEY = ""  # set ODDSBLAZE_KEY in Render env vars — do not hardcode here
ODDSBLAZE_BOOKS = {"draftkings", "fanatics", "betmgm", "caesars"}

DEFAULT_STATE = {
    "savedParlays": [],
    "boardSnapshots": {},
    "modelExports": [],
    "updatedAt": None,
}


def now_ms():
    return int(time.time() * 1000)


def load_state():
    with LOCK:
        if not STATE_PATH.exists():
            return dict(DEFAULT_STATE)
        try:
            data = json.loads(STATE_PATH.read_text("utf-8"))
        except Exception:
            return dict(DEFAULT_STATE)
        out = dict(DEFAULT_STATE)
        out.update(data if isinstance(data, dict) else {})
        out.setdefault("savedParlays", [])
        out.setdefault("boardSnapshots", {})
        out.setdefault("modelExports", [])
        return out


def save_state(state):
    state["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    tmp = STATE_PATH.with_suffix(".tmp")
    with LOCK:
        tmp.write_text(json.dumps(state, indent=2, sort_keys=True), "utf-8")
        tmp.replace(STATE_PATH)


def merge_by_id(old, new):
    old = old if isinstance(old, list) else []
    new = new if isinstance(new, list) else []
    by = {}
    for item in old + new:
        if not isinstance(item, dict):
            continue
        key = str(item.get("id") or item.get("savedAt") or json.dumps(item, sort_keys=True))
        if key in by:
            prev = by[key]
            # Prefer the object with the latest saved/graded/update timestamp.
            prev_t = max(int(prev.get("serverUpdatedAt") or 0), int(prev.get("savedAt") or 0), int(prev.get("gradedAt") or 0))
            item_t = max(int(item.get("serverUpdatedAt") or 0), int(item.get("savedAt") or 0), int(item.get("gradedAt") or 0))
            if item_t >= prev_t:
                by[key] = item
        else:
            by[key] = item
    return sorted(by.values(), key=lambda x: int(x.get("savedAt") or 0), reverse=True)


def merge_exports(old, new):
    old = old if isinstance(old, list) else []
    new = new if isinstance(new, list) else []
    by = {}
    for ex in old + new:
        if not isinstance(ex, dict):
            continue
        key = f"{ex.get('slateDate','')}::{ex.get('exportedAt','')}::{(ex.get('summary') or {}).get('totalHRs','')}"
        by[key] = ex
    return sorted(by.values(), key=lambda x: str(x.get("slateDate") or ""), reverse=True)[:200]


@app.get("/")
def index():
    # Serve the new bundled design first; fall back to legacy DingerLab.html
    for fname in ("index.html", "DingerLab.html"):
        p = APP_DIR / fname
        if p.exists():
            html = p.read_text("utf-8")
            inject = "<script>window.DL_SERVER_MODE=true;</script>"
            if "</head>" in html:
                html = html.replace("</head>", inject + "</head>", 1)
            else:
                html = inject + html
            return html
    return "DingerLab: no HTML found", 404


@app.get("/api/state")
def api_state():
    return jsonify(load_state())


@app.post("/api/state")
def api_state_post():
    incoming = request.get_json(silent=True) or {}
    state = load_state()
    if "savedParlays" in incoming:
        if incoming.get("replaceSavedParlays"):
            state["savedParlays"] = incoming.get("savedParlays") if isinstance(incoming.get("savedParlays"), list) else []
        else:
            state["savedParlays"] = merge_by_id(state.get("savedParlays"), incoming.get("savedParlays"))
    if "boardSnapshots" in incoming and isinstance(incoming.get("boardSnapshots"), dict):
        bs = state.get("boardSnapshots") or {}
        bs.update(incoming["boardSnapshots"])
        state["boardSnapshots"] = bs
    if "modelExports" in incoming:
        state["modelExports"] = merge_exports(state.get("modelExports"), incoming.get("modelExports"))
    save_state(state)
    return jsonify({"ok": True, "state": state})


@app.get("/api/oddsblaze/status")
def api_oddsblaze_status():
    key_present = bool((os.environ.get("ODDSBLAZE_KEY") or ODDSBLAZE_DEFAULT_KEY).strip())
    return jsonify({
        "ok": True,
        "keyPresent": key_present,
        "books": sorted(ODDSBLAZE_BOOKS),
        "message": "ODDSBLAZE_KEY is set" if key_present else "Set ODDSBLAZE_KEY in Render environment variables"
    })


@app.get("/api/oddsblaze")
def api_oddsblaze():
    sportsbook = (request.args.get("sportsbook") or "").strip().lower()
    league = (request.args.get("league") or "mlb").strip().lower()
    if sportsbook not in ODDSBLAZE_BOOKS:
        return jsonify({"error": "unsupported sportsbook"}), 400
    key = (os.environ.get("ODDSBLAZE_KEY") or ODDSBLAZE_DEFAULT_KEY).strip()
    if not key:
        return jsonify({
            "error": "ODDSBLAZE_KEY missing",
            "hint": "Add ODDSBLAZE_KEY in Render environment variables, then redeploy/restart.",
            "sportsbook": sportsbook,
            "league": league,
            "events": []
        }), 503
    try:
        data = jget(
            "https://odds.oddsblaze.com/",
            params={"key": key, "sportsbook": sportsbook, "league": league},
        )
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e), "sportsbook": sportsbook, "league": league}), 502


def jget(url, **kwargs):
    r = requests.get(url, timeout=30, headers={"user-agent": "DingerLab server sync"}, **kwargs)
    r.raise_for_status()
    return r.json()


def final_status_by_game(dates):
    status = {}
    for d in sorted(set(dates)):
        if not d:
            continue
        try:
            sch = jget("https://statsapi.mlb.com/api/v1/schedule", params={"sportId": 1, "date": d})
            for dd in sch.get("dates", []):
                for g in dd.get("games", []):
                    status[str(g.get("gamePk"))] = ((g.get("status") or {}).get("abstractGameState") or "")
        except Exception as e:
            print("schedule error", d, e)
    return status


def boxscore_stats(game_pk):
    bs = jget("https:" + "//statsapi.mlb.com/api/v1/game/" + str(game_pk) + "/boxscore")
    out = {}
    for side in ("home", "away"):
        players = (((bs.get("teams") or {}).get(side) or {}).get("players") or {})
        for _, prx in players.items():
            person = prx.get("person") or {}
            bat = ((prx.get("stats") or {}).get("batting") or {})
            pid = person.get("id")
            if pid is None or not bat:
                continue
            h = int(bat.get("hits") or 0)
            d2 = int(bat.get("doubles") or 0)
            t3 = int(bat.get("triples") or 0)
            hr = int(bat.get("homeRuns") or 0)
            out[str(pid)] = {
                "hr": hr,
                "h": h,
                "rbi": int(bat.get("rbi") or 0),
                "tb": h + d2 + 2 * t3 + 3 * hr,
                "pa": int(bat.get("plateAppearances") if bat.get("plateAppearances") is not None else (bat.get("atBats") or 0)),
            }
    return out


def live_feed_hr_ids(game_pk):
    # v1.1 feed/live is the reliable endpoint for full play data.
    data = jget("https:" + "//statsapi.mlb.com/api/v1.1/game/" + str(game_pk) + "/feed/live")
    ids = set()
    plays = (((data.get("liveData") or {}).get("plays") or {}).get("allPlays") or [])
    for play in plays:
        res = play.get("result") or {}
        if (res.get("eventType") or res.get("event")) != "home_run":
            continue
        batter = ((play.get("matchup") or {}).get("batter") or {})
        if batter.get("id") is not None:
            ids.add(str(batter.get("id")))
    return ids


def leg_hit(leg, stats, hr_ids):
    mk = leg.get("mk") or leg.get("mkt") or "hr"
    pid = str(leg.get("mlbId")) if leg.get("mlbId") is not None else None
    st = stats.get(pid) if pid else None
    if mk == "hr":
        if pid and pid in hr_ids:
            return True, "live_feed_hr"
        if st is not None:
            return (int(st.get("hr") or 0) >= 1), "boxscore"
        return None, None
    if st is None:
        return None, None
    if mk == "hits":
        return int(st.get("h") or 0) >= 1, "boxscore"
    if mk == "hits2":
        return int(st.get("h") or 0) >= 2, "boxscore"
    if mk == "tb":
        return int(st.get("tb") or 0) >= 2, "boxscore"
    if mk == "rbi":
        return int(st.get("rbi") or 0) >= 1, "boxscore"
    return None, None


def perform_grade():
    state = load_state()
    all_slips = state.get("savedParlays") or []
    pending = [x for x in all_slips if (x.get("result") or "pending") == "pending" and isinstance(x.get("legData"), list)]
    dates, pks = set(), set()
    for pp in pending:
        for l in pp.get("legData") or []:
            if l.get("date"):
                dates.add(str(l.get("date")))
            if l.get("gamePk"):
                pks.add(str(l.get("gamePk")))
    status = final_status_by_game(dates)
    boxes, hr_sets = {}, {}
    for pk in sorted(pks):
        if status.get(pk) != "Final":
            continue
        try:
            boxes[pk] = boxscore_stats(pk)
        except Exception as e:
            print("boxscore error", pk, e)
            boxes[pk] = {}
        try:
            hr_sets[pk] = live_feed_hr_ids(pk)
        except Exception as e:
            print("feed/live error", pk, e)
            hr_sets[pk] = set()
    graded_slips = 0
    graded_legs = 0
    waiting = 0
    for pp in pending:
        ready = True
        win = True
        for l in pp.get("legData") or []:
            pk = str(l.get("gamePk")) if l.get("gamePk") is not None else ""
            if l.get("hit") is None:
                if status.get(pk) != "Final":
                    ready = False
                    continue
                hit, source = leg_hit(l, boxes.get(pk) or {}, hr_sets.get(pk) or set())
                if hit is None:
                    ready = False
                    continue
                l["hit"] = bool(hit)
                l["gradedAt"] = now_ms()
                l["gradeSource"] = source
                graded_legs += 1
            if l.get("hit") is False:
                win = False
        if not ready:
            waiting += 1
            continue
        pp["result"] = "win" if win else "loss"
        pp["gradedAt"] = now_ms()
        pp["serverUpdatedAt"] = now_ms()
        graded_slips += 1
    if graded_slips or graded_legs:
        save_state(state)
    else:
        state["updatedAt"] = state.get("updatedAt")
    return {
        "ok": True,
        "gradedSlips": graded_slips,
        "gradedLegs": graded_legs,
        "waiting": waiting,
        "state": state,
    }


@app.post("/api/grade")
def api_grade():
    return jsonify(perform_grade())


def _norm_name(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace(".", " ").replace("'", " ")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    # strip common suffixes
    parts = [p for p in s.split() if p not in ("jr", "sr", "ii", "iii", "iv")]
    return " ".join(parts)


def final_games_by_date(dates):
    out = {}
    for d in sorted(set(dates)):
        if not d:
            continue
        pks = []
        try:
            sch = jget("https://statsapi.mlb.com/api/v1/schedule", params={"sportId": 1, "date": d})
            for dd in sch.get("dates", []):
                for g in dd.get("games", []):
                    st = ((g.get("status") or {}).get("abstractGameState") or "")
                    if st == "Final":
                        pks.append(str(g.get("gamePk")))
        except Exception as e:
            print("schedule(ledger) error", d, e)
        out[d] = pks
    return out


def boxscore_stats_named(game_pk):
    bs = jget("https:" + "//statsapi.mlb.com/api/v1/game/" + str(game_pk) + "/boxscore")
    out = {}
    for side in ("home", "away"):
        players = (((bs.get("teams") or {}).get(side) or {}).get("players") or {})
        for _, prx in players.items():
            person = prx.get("person") or {}
            bat = ((prx.get("stats") or {}).get("batting") or {})
            name = person.get("fullName")
            if not name or not bat:
                continue
            h = int(bat.get("hits") or 0)
            d2 = int(bat.get("doubles") or 0)
            t3 = int(bat.get("triples") or 0)
            hr = int(bat.get("homeRuns") or 0)
            out[_norm_name(name)] = {
                "hr": hr, "h": h, "rbi": int(bat.get("rbi") or 0),
                "tb": h + d2 + 2 * t3 + 3 * hr, "name": name,
            }
    return out


def _lookup_name(nm, name):
    key = _norm_name(name)
    if not key:
        return None
    if key in nm:
        return nm[key]
    parts = key.split()
    if len(parts) >= 2:
        last, fi = parts[-1], parts[0][0]
        cands = [v for k, v in nm.items()
                 if k.split() and k.split()[-1] == last and k.split()[0][:1] == fi]
        if len(cands) == 1:
            return cands[0]
    return None


def _ledger_market_hit(mk, st):
    if st is None:
        return None
    mk = (mk or "hr").lower()
    if mk == "hr":
        return int(st.get("hr") or 0) >= 1
    if mk == "hits":
        return int(st.get("h") or 0) >= 1
    if mk == "hits2":
        return int(st.get("h") or 0) >= 2
    if mk == "tb":
        return int(st.get("tb") or 0) >= 2
    if mk == "rbi":
        return int(st.get("rbi") or 0) >= 1
    return None


def perform_grade_ledger(bets):
    bets = bets or []
    dates = set()
    for b in bets:
        if b.get("dateStr"):
            dates.add(str(b.get("dateStr"))[:10])
    games_by_date = final_games_by_date(dates)
    namemap_by_date = {}
    for d, pks in games_by_date.items():
        nm = {}
        for pk in pks:
            try:
                nm.update(boxscore_stats_named(pk))
            except Exception as e:
                print("boxscore(named) error", pk, e)
        namemap_by_date[d] = nm
    results = []
    graded = 0
    waiting = 0
    for b in bets:
        bid = b.get("id")
        d = str(b.get("dateStr") or "")[:10]
        nm = namemap_by_date.get(d) or {}
        mk = (b.get("market") or "hr").lower()
        if mk == "parlay" and isinstance(b.get("legs"), list) and b.get("legs"):
            win = True
            ready = True
            legres = []
            for leg in b.get("legs"):
                st = _lookup_name(nm, leg.get("name"))
                hit = _ledger_market_hit(leg.get("mkt") or "hr", st)
                if hit is None:
                    ready = False
                elif hit is False:
                    win = False
                legres.append({"name": leg.get("name"), "hit": hit})
            if not ready:
                waiting += 1
                results.append({"id": bid, "result": "pending", "legs": legres})
            else:
                graded += 1
                results.append({"id": bid, "result": ("win" if win else "loss"), "legs": legres})
        elif mk in ("hr", "hits", "hits2", "tb", "rbi"):
            st = _lookup_name(nm, b.get("player"))
            hit = _ledger_market_hit(mk, st)
            if hit is None:
                waiting += 1
                reason = "no_final_game" if not nm else "player_not_found"
                results.append({"id": bid, "result": "pending", "reason": reason})
            else:
                graded += 1
                results.append({"id": bid, "result": ("win" if hit else "loss"),
                                "stat": st, "source": "boxscore"})
        else:
            waiting += 1
            results.append({"id": bid, "result": "pending", "reason": "unsupported_market"})
    return {"ok": True, "graded": graded, "waiting": waiting, "results": results}


@app.post("/api/grade_ledger")
def api_grade_ledger():
    body = request.get_json(silent=True) or {}
    bets = body.get("bets") if isinstance(body, dict) else None
    if not isinstance(bets, list):
        return jsonify({"ok": False, "error": "expected JSON {bets:[...]}"}), 400
    try:
        return jsonify(perform_grade_ledger(bets))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502



# ---------------------------------------------------------------------------
# HR Engine real-data milestone routes (v1.2.1)
# Synthetic data is not accepted for training/evaluation/backtesting/prediction.
@app.post("/api/hr/init")
def api_hr_init():
    try:
        from hr_real.db import init_db
        path = init_db()
        return jsonify({"ok": True, "db": path, "synthetic_training_allowed": False})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/api/hr/status")
def api_hr_status():
    try:
        from hr_real.db import init_db, connect
        init_db(); con = connect()
        row = con.execute("SELECT * FROM v_hr_engine_status").fetchone()
        runs = [dict(r) for r in con.execute("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 5").fetchall()]
        con.close()
        return jsonify({"ok": True, "status": dict(row), "recent_runs": runs,
                        "network_limited": False, "synthetic_training_allowed": False,
                        "ml_training_unlocked": (row["feature_rows"] or 0) > 10000})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e), "network_limited": False,
                        "synthetic_training_allowed": False}), 500

@app.post("/api/hr/ingest_statcast")
def api_hr_ingest_statcast():
    body = request.get_json(silent=True) or {}
    try:
        from hr_real.ingest_statcast import ingest_range
        season = body.get("season")
        start = body.get("start"); end = body.get("end")
        if season and not (start and end):
            start, end = f"{int(season)}-03-01", f"{int(season)}-11-15"
        if not (start and end):
            return jsonify({"ok": False, "error": "Provide season or start/end"}), 400
        res = ingest_range(start, end)
        return jsonify({"ok": True, **res})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 502

@app.post("/api/hr/build_features")
def api_hr_build_features():
    try:
        from hr_real.clean_features_eda import build_pa_events, build_features, eda_report
        pa = build_pa_events(); feats = build_features(); eda = eda_report()
        return jsonify({"ok": True, "pa_events": pa, "feature_rows": feats, "eda": eda,
                        "synthetic_training_allowed": False})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/api/hr/eda")
def api_hr_eda():
    try:
        from hr_real.clean_features_eda import eda_report
        return jsonify({"ok": True, **eda_report()})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500

@app.get("/api/hr/requirements")
def api_hr_requirements():
    return jsonify({"ok": True, "milestone": "real-data-ingestion-first",
                    "sources": ["Statcast/Baseball Savant via pybaseball", "MLB Stats API", "park factors", "weather", "OddsBlaze via /api/oddsblaze"],
                    "forbidden": ["synthetic model training", "synthetic evaluation", "synthetic backtesting", "synthetic predictions"]})


@app.get("/health")
def health():
    return {"ok": True, "statePath": str(STATE_PATH)}


def background_grade_loop():
    # Server-side auto-settlement: every 10 minutes, check final MLB games,
    # verify HR legs from feed/live, and sync pending bet outcomes.
    while True:
        try:
            res = perform_grade()
            if res.get("gradedSlips") or res.get("gradedLegs"):
                print("auto-grade", res.get("gradedSlips"), "slips", res.get("gradedLegs"), "legs")
        except Exception as e:
            print("auto-grade loop error", e)
        time.sleep(10 * 60)


def start_background_worker():
    if os.environ.get("DINGERLAB_DISABLE_BACKGROUND") == "1":
        return
    if getattr(start_background_worker, "started", False):
        return
    start_background_worker.started = True
    t = threading.Thread(target=background_grade_loop, daemon=True)
    t.start()


start_background_worker()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8501"))
    app.run(host="0.0.0.0", port=port, debug=False)
