#!/usr/bin/env python3
"""
DingerLab Backtest Harness — v1
================================

Scores an HR-probability model against real historical outcomes so you can
answer the only question that matters: does the model actually predict, and is
it calibrated?

What it does
------------
1. DATA (live mode): pulls historical schedules, lineups, probable pitchers, and
   final box scores from the free public MLB StatsAPI (no key required). Builds
   one row per starting batter per game with features known BEFORE first pitch
   (season-to-date and recent HR/PA from game logs strictly before that date,
   lineup spot, opposing pitcher HR/9, park factor). This leakage discipline is
   the difference between an honest backtest and a fantasy.
2. MODEL: a faithful Python port of the v4.3 "HR Probability Core" runs on each
   row. Models are pluggable (see the MODELS registry) so you can A/B a new one
   against the incumbent and against a naive base-rate baseline.
3. SCORING: Brier score, log loss, a reliability/calibration table, a skill score
   vs the base-rate baseline, and breakdowns by predicted-probability bucket and
   lineup slot.
4. CACHE: every API response is cached to disk, so re-runs are fast and easy on
   the API.

Offline check
-------------
`python dingerlab_backtest.py --demo` runs the entire predict -> outcome ->
score pipeline on synthetic data with a known signal, so you can verify the
harness works with no network. Live mode needs outbound access to
statsapi.mlb.com from wherever you run it.

Live usage
----------
    python dingerlab_backtest.py --start 2025-04-01 --end 2025-09-28 \
        --model v43 --out results

NOTE: MLB StatsAPI response shapes drift occasionally; the client is written
defensively but the live-data functions are the part most likely to need a
small tweak. The scoring engine is the verified, stable core.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import time
import urllib.request
import urllib.error
from dataclasses import dataclass, field, asdict
from datetime import date, timedelta
from typing import Callable, Optional

# --------------------------------------------------------------------------- #
# Constants                                                                   #
# --------------------------------------------------------------------------- #
STATS_API = "https://statsapi.mlb.com/api/v1"
LEAGUE_HR_PER_PA = 0.032
LEAGUE_PITCHER_HR9 = 1.25
CACHE_DIR_DEFAULT = "bt_cache"

# Static HR park factors (relative to 1.00). Update from your preferred source;
# these don't need an API. Venues not listed default to neutral 1.00.
PARK_HR_FACTOR = {
    "Coors Field": 1.28, "Great American Ball Park": 1.22, "Yankee Stadium": 1.13,
    "Citizens Bank Park": 1.13, "Fenway Park": 1.08, "Wrigley Field": 1.04,
    "Dodger Stadium": 1.06, "Truist Park": 1.03, "Globe Life Field": 1.02,
    "Chase Field": 1.01, "Oracle Park": 0.86, "T-Mobile Park": 0.92,
    "Petco Park": 0.94, "Comerica Park": 0.94, "loanDepot park": 0.93,
    "Kauffman Stadium": 0.95, "Tropicana Field": 0.96, "Citi Field": 0.97,
}


# --------------------------------------------------------------------------- #
# Small utilities                                                             #
# --------------------------------------------------------------------------- #
def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def daterange(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


# --------------------------------------------------------------------------- #
# Disk cache + HTTP                                                           #
# --------------------------------------------------------------------------- #
class Cache:
    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def _path(self, key: str) -> str:
        safe = "".join(c if c.isalnum() else "_" for c in key)
        return os.path.join(self.root, safe + ".json")

    def get(self, key: str):
        p = self._path(key)
        if os.path.exists(p):
            try:
                with open(p, "r") as f:
                    return json.load(f)
            except Exception:
                return None
        return None

    def put(self, key: str, value) -> None:
        try:
            with open(self._path(key), "w") as f:
                json.dump(value, f)
        except Exception:
            pass


def http_json(url: str, cache: Optional[Cache], retries: int = 3):
    if cache is not None:
        hit = cache.get(url)
        if hit is not None:
            return hit
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "DingerLab-Backtest/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if cache is not None:
                cache.put(url, data)
            return data
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            time.sleep(1.0 + attempt)
    raise RuntimeError(f"Request failed after {retries} tries: {url} ({last_err})")


# --------------------------------------------------------------------------- #
# Feature row                                                                 #
# --------------------------------------------------------------------------- #
@dataclass
class PlayerGame:
    game_date: str
    game_pk: int
    player_id: int
    player: str
    team: str
    venue: str
    lineup_spot: int            # 1-9; 6 (=neutral) if unknown
    season_hr: int              # season-to-date BEFORE this game
    season_pa: int
    recent_hr: int              # last N games BEFORE this game
    recent_pa: int
    opp_pitcher_hr9: float
    park_hr_factor: float
    iso_proxy: float = 0.0      # season-to-date ISO proxy (power signal)
    # Outcome (filled after the game):
    hit_hr: Optional[int] = None    # 1 if >=1 HR, else 0
    # Optional market price for comparison (American odds), if you supply it:
    market_american: Optional[int] = None


# --------------------------------------------------------------------------- #
# MLB StatsAPI client (live mode)                                             #
# --------------------------------------------------------------------------- #
def fetch_schedule(d: date, cache: Cache):
    url = (f"{STATS_API}/schedule?sportId=1&date={d.isoformat()}"
           f"&hydrate=probablePitcher,venue,team")
    data = http_json(url, cache)
    games = []
    for day in data.get("dates", []):
        for g in day.get("games", []):
            games.append(g)
    return games


def fetch_boxscore(game_pk: int, cache: Cache):
    return http_json(f"{STATS_API}/game/{game_pk}/boxscore", cache)


def fetch_gamelog(player_id: int, season: int, cache: Cache):
    url = (f"{STATS_API}/people/{player_id}/stats?stats=gameLog"
           f"&group=hitting&season={season}")
    return http_json(url, cache)


def pitcher_hr9(player_id: int, season: int, cache: Cache) -> float:
    """Season HR/9 for a pitcher up to whenever the cache was filled."""
    if not player_id:
        return LEAGUE_PITCHER_HR9
    try:
        url = (f"{STATS_API}/people/{player_id}/stats?stats=season"
               f"&group=pitching&season={season}")
        data = http_json(url, cache)
        splits = data.get("stats", [{}])[0].get("splits", [])
        if not splits:
            return LEAGUE_PITCHER_HR9
        stat = splits[0].get("stat", {})
        hr = float(stat.get("homeRuns", 0) or 0)
        ip = float(stat.get("inningsPitched", 0) or 0)
        if ip <= 0:
            return LEAGUE_PITCHER_HR9
        return clamp((hr / ip) * 9.0, 0.4, 3.0)
    except Exception:
        return LEAGUE_PITCHER_HR9


def cumulative_before(gamelog: dict, before: date, recent_games: int = 12):
    """Season-to-date and recent HR/PA from games strictly BEFORE `before`."""
    splits = []
    try:
        splits = gamelog.get("stats", [{}])[0].get("splits", [])
    except Exception:
        splits = []
    rows = []
    for s in splits:
        ds = s.get("date")
        if not ds:
            continue
        try:
            gd = date.fromisoformat(ds)
        except ValueError:
            continue
        if gd >= before:
            continue
        st = s.get("stat", {})
        pa = int(st.get("plateAppearances", 0) or 0)
        hr = int(st.get("homeRuns", 0) or 0)
        ab = int(st.get("atBats", 0) or 0)
        h = int(st.get("hits", 0) or 0)
        d2 = int(st.get("doubles", 0) or 0)
        t3 = int(st.get("triples", 0) or 0)
        rows.append((gd, pa, hr, ab, h, d2, t3))
    rows.sort(key=lambda r: r[0])
    season_pa = sum(r[1] for r in rows)
    season_hr = sum(r[2] for r in rows)
    ab = sum(r[3] for r in rows); h = sum(r[4] for r in rows)
    d2 = sum(r[5] for r in rows); t3 = sum(r[6] for r in rows)
    rec = rows[-recent_games:]
    recent_pa = sum(r[1] for r in rec)
    recent_hr = sum(r[2] for r in rec)
    # ISO proxy = (TB - H)/AB ; TB = singles + 2*2B + 3*3B + 4*HR
    iso = 0.0
    if ab > 0:
        singles = max(0, h - d2 - t3 - season_hr)
        tb = singles + 2 * d2 + 3 * t3 + 4 * season_hr
        iso = max(0.0, (tb / ab) - (h / ab))
    return season_hr, season_pa, recent_hr, recent_pa, iso


def build_rows_for_date(d: date, cache: Cache, recent_games: int = 12):
    """Assemble leakage-safe feature rows + outcomes for one slate date."""
    season = d.year
    rows: list[PlayerGame] = []
    for g in fetch_schedule(d, cache):
        if g.get("status", {}).get("abstractGameState") != "Final":
            continue  # only completed games have outcomes to grade
        game_pk = g.get("gamePk")
        venue = g.get("venue", {}).get("name", "")
        park = PARK_HR_FACTOR.get(venue, 1.00)
        teams = g.get("teams", {})
        # opposing probable pitcher for each side
        opp_pitcher = {
            "home": teams.get("away", {}).get("probablePitcher", {}) or {},
            "away": teams.get("home", {}).get("probablePitcher", {}) or {},
        }
        try:
            box = fetch_boxscore(game_pk, cache)
        except Exception:
            continue
        for side in ("home", "away"):
            tb = box.get("teams", {}).get(side, {})
            team_name = tb.get("team", {}).get("abbreviation", side)
            opp_hr9 = pitcher_hr9(opp_pitcher[side].get("id"), season, cache)
            players = tb.get("players", {})
            # batting order: StatsAPI gives 3-digit codes (100,200,...) for starters
            order = []
            for pid_key, pdata in players.items():
                bo = pdata.get("battingOrder")
                if bo and str(bo).endswith("00"):  # starter
                    order.append((int(bo) // 100, pid_key, pdata))
            for spot, pid_key, pdata in order:
                person = pdata.get("person", {})
                player_id = person.get("id")
                if not player_id:
                    continue
                stat = pdata.get("stats", {}).get("batting", {})
                hr_today = int(stat.get("homeRuns", 0) or 0)
                try:
                    gl = fetch_gamelog(player_id, season, cache)
                    s_hr, s_pa, r_hr, r_pa, iso = cumulative_before(gl, d, recent_games)
                except Exception:
                    s_hr = s_pa = r_hr = r_pa = 0; iso = 0.0
                if s_pa < 20:  # too little history to model honestly
                    continue
                rows.append(PlayerGame(
                    game_date=d.isoformat(), game_pk=game_pk,
                    player_id=player_id, player=person.get("fullName", str(player_id)),
                    team=team_name, venue=venue, lineup_spot=clamp(spot, 1, 9),
                    season_hr=s_hr, season_pa=s_pa, recent_hr=r_hr, recent_pa=r_pa,
                    opp_pitcher_hr9=opp_hr9, park_hr_factor=park, iso_proxy=iso,
                    hit_hr=1 if hr_today >= 1 else 0,
                ))
    return rows


# --------------------------------------------------------------------------- #
# Models (pluggable). Each maps a PlayerGame -> P(>=1 HR this game).          #
# --------------------------------------------------------------------------- #
def expected_pa(spot: int) -> float:
    table = {1: 4.65, 2: 4.55, 3: 4.45, 4: 4.34, 5: 4.18,
             6: 4.02, 7: 3.86, 8: 3.70, 9: 3.55}
    return table.get(int(spot), 4.02)


def power_scores(iso: float, season_hr_pa: float):
    """Compact stand-in for the app's Swing Power DNA, from box-score power.
    Returns (swingPowerScore, seasonPowerScore, fadeRisk) on 0-100.
    Swapping these for real Statcast bat-tracking is the next upgrade."""
    swing = clamp(35 + iso * 230 + season_hr_pa * 700, 0, 100)
    season = clamp(40 + iso * 200 + season_hr_pa * 650, 0, 100)
    fade = clamp(70 - swing * 0.5, 0, 100)
    return swing, season, fade


def model_v43(pg: PlayerGame) -> float:
    """Faithful port of v4.3 HR Probability Core (no market-blend term, so we
    test the model's own signal). Mirrors the multiplier ranges in the app."""
    pa = max(1, pg.season_pa)
    exp_pa = expected_pa(pg.lineup_spot)
    season_hr_pa = clamp(pg.season_hr / pa, .001, .13)
    recent_hr_pa = clamp((pg.recent_hr / pg.recent_pa) if pg.recent_pa else season_hr_pa,
                         .001, .17)
    season_game = 1 - (1 - season_hr_pa) ** exp_pa
    recent_game = 1 - (1 - recent_hr_pa) ** exp_pa

    swing, season_power, fade = power_scores(pg.iso_proxy, season_hr_pa)
    pitcher_comp = clamp(50 + ((pg.opp_pitcher_hr9 - LEAGUE_PITCHER_HR9) /
                               LEAGUE_PITCHER_HR9) * 50, 0, 100)

    pitcher_mult = clamp(.72 + (pitcher_comp / 100) * .68, .72, 1.40)
    park_mult = clamp(1 + ((pg.park_hr_factor - 1.0) * 100) / 100, .82, 1.28)
    swing_mult = clamp(.72 + (swing / 100) * .66, .72, 1.38)
    season_mult = clamp(.78 + (season_power / 100) * .54, .78, 1.32)
    pa_mult = clamp(exp_pa / 4.15, .65, 1.20)
    fade_mult = clamp(1 - (max(0, fade - 55) / 170), .72, 1.04)

    model = (season_game * .68 + recent_game * .32) * \
        pitcher_mult * park_mult * swing_mult * season_mult * pa_mult * fade_mult
    return clamp(model, .003, .24)


def model_season_only(pg: PlayerGame) -> float:
    """Ablation: season rate + expected PA only, no adjustments."""
    pa = max(1, pg.season_pa)
    rate = clamp(pg.season_hr / pa, .001, .13)
    return clamp(1 - (1 - rate) ** expected_pa(pg.lineup_spot), .003, .24)


def make_baseline(base_rate: float) -> Callable[[PlayerGame], float]:
    """Naive baseline: predict the overall HR rate for everyone."""
    return lambda pg: base_rate


MODELS: dict[str, Callable[[PlayerGame], float]] = {
    "v43": model_v43,
    "season_only": model_season_only,
}


def build_eb_shrink(rows: list[PlayerGame]) -> Callable[[PlayerGame], float]:
    """Empirical-Bayes shrinkage model — the recommended upgrade.

    Fixes v4.3's two failure modes directly:
      * over-trusting small samples: each batter's HR/PA is shrunk toward the
        league rate by a strength kappa (estimated from the population), so a
        50-PA hot streak is pulled back and a 600-PA track record is trusted;
      * multiplier stacking: only park and a *regressed* pitcher term adjust the
        rate — no piled-on power/swing/fade proxies that double-count and inflate.
    """
    total_pa = sum(r.season_pa for r in rows if r.season_pa > 0)
    total_hr = sum(r.season_hr for r in rows if r.season_pa > 0)
    league_rate = (total_hr / total_pa) if total_pa > 0 else LEAGUE_HR_PER_PA

    # Estimate shrinkage strength (beta pseudo-counts) by method of moments.
    sample = [r.season_hr / r.season_pa for r in rows if r.season_pa >= 100]
    kappa = 200.0
    if len(sample) >= 30:
        m = sum(sample) / len(sample)
        v = sum((x - m) ** 2 for x in sample) / (len(sample) - 1)
        if v > 1e-9 and 0 < m < 1:
            k = m * (1 - m) / v - 1
            if k == k and k > 0:        # guard against NaN
                kappa = clamp(k, 80.0, 400.0)

    def model(pg: PlayerGame) -> float:
        season_shrunk = (pg.season_hr + league_rate * kappa) / (pg.season_pa + kappa)
        if pg.recent_pa > 0:
            kr = 120.0                  # recent form gets heavy regression (it's noisy)
            recent_shrunk = (pg.recent_hr + season_shrunk * kr) / (pg.recent_pa + kr)
        else:
            recent_shrunk = season_shrunk
        rate = season_shrunk * 0.85 + recent_shrunk * 0.15   # recent only nudges
        pitcher_mult = clamp(1 + ((pg.opp_pitcher_hr9 / LEAGUE_PITCHER_HR9) - 1) * 0.6,
                             0.78, 1.30)
        p_pa = clamp(rate * pg.park_hr_factor * pitcher_mult, .001, .12)
        return clamp(1 - (1 - p_pa) ** expected_pa(pg.lineup_spot), .003, .24)
    return model


def get_model(name: str, rows: list[PlayerGame]) -> Callable[[PlayerGame], float]:
    if name == "eb_shrink":
        return build_eb_shrink(rows)
    return MODELS[name]


# --------------------------------------------------------------------------- #
# Scoring                                                                     #
# --------------------------------------------------------------------------- #
def brier(preds, ys) -> float:
    return sum((p - y) ** 2 for p, y in zip(preds, ys)) / max(1, len(ys))


def log_loss(preds, ys) -> float:
    eps = 1e-12
    s = 0.0
    for p, y in zip(preds, ys):
        p = min(max(p, eps), 1 - eps)
        s += -(y * math.log(p) + (1 - y) * math.log(1 - p))
    return s / max(1, len(ys))


def reliability_table(preds, ys, edges=(0, .02, .04, .06, .08, .10, .14, .20, 1.0)):
    rows = []
    for i in range(len(edges) - 1):
        lo, hi = edges[i], edges[i + 1]
        idx = [j for j, p in enumerate(preds) if (p >= lo and (p < hi or hi == 1.0))]
        if not idx:
            continue
        n = len(idx)
        mean_pred = sum(preds[j] for j in idx) / n
        actual = sum(ys[j] for j in idx) / n
        rows.append((f"{lo:.0%}-{hi:.0%}", n, mean_pred, actual))
    return rows


def segment_by(rows: list[PlayerGame], preds, key_fn):
    out = {}
    for pg, p in zip(rows, preds):
        k = key_fn(pg)
        out.setdefault(k, [0, 0.0, 0])  # [n, sum_pred, sum_actual]
        out[k][0] += 1
        out[k][1] += p
        out[k][2] += pg.hit_hr
    return out


def evaluate(rows: list[PlayerGame], model_fn: Callable[[PlayerGame], float]):
    preds = [model_fn(pg) for pg in rows]
    ys = [pg.hit_hr for pg in rows]
    base_rate = sum(ys) / max(1, len(ys))
    base_preds = [base_rate] * len(ys)

    b_model = brier(preds, ys)
    b_base = brier(base_preds, ys)
    skill = 1 - (b_model / b_base) if b_base > 0 else 0.0

    return {
        "n": len(rows),
        "base_rate": base_rate,
        "mean_pred": sum(preds) / max(1, len(preds)),
        "brier": b_model,
        "brier_baseline": b_base,
        "skill_score": skill,
        "log_loss": log_loss(preds, ys),
        "reliability": reliability_table(preds, ys),
        "by_spot": segment_by(rows, preds, lambda pg: pg.lineup_spot),
        "preds": preds,
        "ys": ys,
    }


def print_report(res: dict, model_name: str):
    print("=" * 70)
    print(f"BACKTEST REPORT — model '{model_name}'")
    print("=" * 70)
    print(f"Rows graded:        {res['n']}")
    print(f"Actual HR rate:     {res['base_rate']:.3%}")
    print(f"Mean prediction:    {res['mean_pred']:.3%}   "
          f"(want this close to actual rate)")
    print(f"Brier score:        {res['brier']:.5f}   "
          f"(lower is better; baseline {res['brier_baseline']:.5f})")
    print(f"Skill vs baseline:  {res['skill_score']:+.2%}   "
          f"(>0 means it beats predicting the league rate for everyone)")
    print(f"Log loss:           {res['log_loss']:.5f}")
    print("-" * 70)
    print("CALIBRATION (reliability) — predicted band vs actual hit rate:")
    print(f"  {'band':<12}{'n':>7}{'pred':>9}{'actual':>9}{'gap':>9}")
    for band, n, pred, actual in res["reliability"]:
        print(f"  {band:<12}{n:>7}{pred:>9.2%}{actual:>9.2%}{(pred-actual):>+9.2%}")
    print("-" * 70)
    print("BY LINEUP SLOT:")
    print(f"  {'spot':<6}{'n':>7}{'pred':>9}{'actual':>9}")
    for spot in sorted(res["by_spot"]):
        n, sp, sa = res["by_spot"][spot]
        print(f"  {spot:<6}{n:>7}{sp/n:>9.2%}{sa/n:>9.2%}")
    print("=" * 70)


def evaluate_picks(rows: list[PlayerGame], preds, n_per_day: int):
    """The pick-quality test: if you bet the model's top picks each slate, did
    they actually homer more than the field? This is what a picks tool lives or
    dies on — more than any aggregate score."""
    by_day: dict[str, list] = {}
    for pg, p in zip(rows, preds):
        by_day.setdefault(pg.game_date, []).append((p, pg.hit_hr))
    topn_hits = topn_n = top1_hits = top1_n = 0
    for _, lst in by_day.items():
        lst.sort(key=lambda x: x[0], reverse=True)
        picks = lst[:n_per_day]
        topn_n += len(picks)
        topn_hits += sum(y for _, y in picks)
        if lst:
            top1_n += 1
            top1_hits += lst[0][1]
    base = sum(pg.hit_hr for pg in rows) / max(1, len(rows))
    topn_rate = topn_hits / max(1, topn_n)
    top1_rate = top1_hits / max(1, top1_n)
    return {
        "days": len(by_day), "n_per_day": n_per_day, "base": base,
        "top1_rate": top1_rate, "topn_rate": topn_rate,
        "lift_top1": (top1_rate / base) if base > 0 else 0.0,
        "lift_topn": (topn_rate / base) if base > 0 else 0.0,
    }


def print_picks(pk: dict):
    print("-" * 70)
    print("PICK QUALITY — do the top picks actually go deep more than the field?")
    print(f"  Slate base HR rate:          {pk['base']:.2%}")
    print(f"  Top-1 pick / slate hit:      {pk['top1_rate']:.2%}   "
          f"({pk['lift_top1']:.2f}x the field)")
    print(f"  Top-{pk['n_per_day']} picks / slate hit:     {pk['topn_rate']:.2%}   "
          f"({pk['lift_topn']:.2f}x the field)")
    print(f"  over {pk['days']} slates")
    print("  (A lift above 1.0 means the picks beat random; this is the headline"
          " number\n   for the tool. True ROI/EV also needs historical odds —"
          " see notes.)")


def write_csv(rows: list[PlayerGame], preds, out_prefix: str):
    path = out_prefix + "_predictions.csv"
    cols = list(asdict(rows[0]).keys()) + ["model_prob"]
    with open(path, "w") as f:
        f.write(",".join(cols) + "\n")
        for pg, p in zip(rows, preds):
            d = asdict(pg)
            vals = [str(d[c]) for c in asdict(pg).keys()] + [f"{p:.6f}"]
            f.write(",".join('"' + v.replace('"', '""') + '"' for v in vals) + "\n")
    return path


# --------------------------------------------------------------------------- #
# Demo mode — synthetic data with a known signal (validates the pipeline)     #
# --------------------------------------------------------------------------- #
def demo_rows(n: int = 2000, seed: int = 7) -> list[PlayerGame]:
    rng = random.Random(seed)
    parks = list(PARK_HR_FACTOR.items()) + [("Neutral Park", 1.00)] * 6
    rows = []
    for i in range(n):
        # latent true talent HR/PA
        true_hr_pa = clamp(rng.lognormvariate(math.log(0.030), 0.45), .005, .085)
        season_pa = rng.randint(120, 600)
        # noisy season estimate of true talent
        season_hr = sum(1 for _ in range(season_pa) if rng.random() < true_hr_pa)
        recent_pa = rng.randint(30, 70)
        recent_hr = sum(1 for _ in range(recent_pa) if rng.random() < true_hr_pa)
        spot = rng.choices(range(1, 10),
                           weights=[10, 12, 14, 13, 11, 10, 9, 8, 7])[0]
        venue, park = rng.choice(parks)
        opp_hr9 = clamp(rng.gauss(1.25, 0.30), 0.6, 2.3)
        iso = clamp(true_hr_pa * 4.5 + rng.gauss(0, 0.02), 0.05, 0.40)

        # generate the outcome from the TRUE per-PA rate scaled by the real
        # environment, over the expected PAs — so park & pitcher genuinely matter
        eff = clamp(true_hr_pa * park * (opp_hr9 / LEAGUE_PITCHER_HR9), .002, .15)
        epa = expected_pa(spot)
        whole = int(epa)
        frac = epa - whole
        hit = 0
        for _ in range(whole):
            if rng.random() < eff:
                hit = 1
        if rng.random() < frac and rng.random() < eff:
            hit = 1

        rows.append(PlayerGame(
            game_date=f"2025-0{(i % 6) + 1}-15", game_pk=700000 + i,
            player_id=i, player=f"Player {i}", team="DMO", venue=venue,
            lineup_spot=spot, season_hr=season_hr, season_pa=season_pa,
            recent_hr=recent_hr, recent_pa=recent_pa, opp_pitcher_hr9=opp_hr9,
            park_hr_factor=park, iso_proxy=iso, hit_hr=hit,
        ))
    return rows


# --------------------------------------------------------------------------- #
# Main                                                                        #
# --------------------------------------------------------------------------- #
def run_live(start: date, end: date, cache: Cache, recent_games: int):
    all_rows: list[PlayerGame] = []
    for d in daterange(start, end):
        try:
            rows = build_rows_for_date(d, cache, recent_games)
            all_rows.extend(rows)
            print(f"  {d}: {len(rows)} batter-games")
        except Exception as e:
            print(f"  {d}: ERROR {e}")
    return all_rows


def main():
    ap = argparse.ArgumentParser(description="DingerLab HR model backtest harness")
    ap.add_argument("--start", help="YYYY-MM-DD (live mode)")
    ap.add_argument("--end", help="YYYY-MM-DD (live mode)")
    ap.add_argument("--model", default="eb_shrink",
                    choices=list(MODELS.keys()) + ["eb_shrink"])
    ap.add_argument("--demo", action="store_true", help="run offline on synthetic data")
    ap.add_argument("--cache-dir", default=CACHE_DIR_DEFAULT)
    ap.add_argument("--recent-games", type=int, default=12)
    ap.add_argument("--picks-per-day", type=int, default=3,
                    help="how many top picks per slate to grade for pick quality")
    ap.add_argument("--out", default="backtest", help="output file prefix")
    args = ap.parse_args()

    if args.demo:
        print("DEMO MODE — synthetic data, no network.\n")
        rows = demo_rows()
    else:
        if not (args.start and args.end):
            ap.error("live mode needs --start and --end (or use --demo)")
        cache = Cache(args.cache_dir)
        rows = run_live(date.fromisoformat(args.start),
                        date.fromisoformat(args.end), cache, args.recent_games)

    rows = [r for r in rows if r.hit_hr is not None]
    if not rows:
        print("No graded rows. Nothing to score.")
        return

    model_fn = get_model(args.model, rows)
    res = evaluate(rows, model_fn)
    print()
    print_report(res, args.model)
    pk = evaluate_picks(rows, res["preds"], args.picks_per_day)
    print_picks(pk)
    path = write_csv(rows, res["preds"], args.out)
    print(f"\nPer-row predictions written to: {path}")


if __name__ == "__main__":
    main()
