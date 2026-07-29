# DingerLab v1.4.8 — All-Season HR Ingest

MLB home-run prop & parlay intelligence. Full front-end + server in this repo.

---

## Versioning (keep this current)

**On every update, bump the version in three places so the UI, files, and README stay in sync:**

1. **UI** — `index.html`: `<script>window.__DL_VERSION__="vX.Y.Z";</script>` (near `</head>`). This is what the app shows.
2. **README** — the `# DingerLab vX.Y.Z` title at the top, and add a `## vX.Y.Z — <summary>` changelog section at the bottom.
3. **Zip** — re-deliver the download so the packaged files carry the new version.

Bump **patch** (Z) for fixes, **minor** (Y) for features, **major** (X) for breaking changes. Current: **v1.4.0**.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Bundled app — GitHub Pages, open in any browser, no build step |
| `DingerLab Redesign.dc.html` | Source design component (edit this, re-bundle to update `index.html`) |
| `dingerlab_server.py` | Flask server — multi-device sync, server-side odds proxy, auto-grading |
| `soccer.js` / `support.js` | Front-end JS modules used by the app |
| `tools/` | Build + maintenance scripts (`set-version.js`, `inline-*.js`) |
| `deploy.sh` / `deploy.py` | Helpers to apply an update zip into a local project |
| `requirements.txt` | Python dependencies |

---

## Deploy on GitHub Pages (front-end only)

1. Push this repo to GitHub.
2. **Settings → Pages → Branch:** `main`, root `/`.
3. Done — live at `https://<you>.github.io/<repo>/`.

The app fetches live MLB data automatically (no key needed):
- Today's slate, rosters, probable pitchers → MLB Stats API
- Real HR model (park × opposing-starter adjusted) for every qualified hitter
- Live HR feed once games start

**Odds:** open `Tools → Live odds proxy`, enter your Render server URL and hit **Save & reload**. Your `ODDSBLAZE_KEY` env var on Render is used automatically.

---

## Run the Flask server (multi-device sync + server-side odds)

```bash
pip install -r requirements.txt
python dingerlab_server.py
```

Then open `http://localhost:8501`.

Set env vars before running (Render dashboard → Environment):

```
ODDSBLAZE_KEY=your-key-here
PORT=8501                       # optional, defaults to 8501
DINGERLAB_ALLOWED_ORIGIN=...    # optional, lock CORS to your front-end origin
```

The server handles:
- `/api/oddsblaze` — OddsBlaze proxy (reads `ODDSBLAZE_KEY` from env)
- `/api/state` — saved parlays + board snapshots sync across devices
- `/api/grade` — auto-grades pending legs from MLB boxscores (matches by MLB player id)
- `/api/grade_ledger` — name-based grading for ad-hoc bet ledgers
- `/health` — liveness check

A background worker also re-grades pending slips every 10 min, so results settle even with no tab open.

Data is written to `server_data/dingerlab_server_state.json`. Use a host with persistent disk.

---

## Deploy server on Render

1. New Web Service → connect this repo.
2. Build command: `pip install -r requirements.txt`
3. Start command: `python dingerlab_server.py`
4. Environment → add `ODDSBLAZE_KEY`. Optionally add `DINGERLAB_ALLOWED_ORIGIN=https://<you>.github.io` to restrict CORS.
5. Your URL (e.g. `https://mlb-slate.onrender.com`) goes in the app's **Tools → Live odds proxy**.

> **CORS:** the server defaults to allowing any origin (`*`) on `/api/*` so an unconfigured deploy works out of the box. For a public deploy, set `DINGERLAB_ALLOWED_ORIGIN` to your GitHub Pages origin so only your front-end can call the API.
>
> **Keys:** no credentials are hardcoded — `ODDSBLAZE_KEY` is read from the environment.

---

## Screens

Dashboard (Command Center) · Games · Radar (weather / ball-carry map) · Solver (bankroll-aware Kelly portfolio) · Report Card (model calibration vs results) · Builder (cross-play generator + payoff frontier) · Data (feature store) · Research (steam radar, value plays, what changed) · Tracking (CLV, W/L results) · Tools (odds proxy, model settings, exposure) · Live (HR feed + schedule)


## v1.4.8 — Radar map dots: real-runtime fix + guards
- The v1.4.7 attempt did **not** resolve the blank Radar map in production. This release replaces it with a fix validated against the real app runtime (headless Chromium driving the actual bundled `index.html` with mocked MLB/weather/odds responses), not a hand-built markup copy.
- Park dots now live in their own absolutely-positioned overlay layer (`inset:0; z-index:4`) inside the map, so they can never be covered or clipped by the grid backdrop or legend.
- Dot geometry is precomputed in JS as complete CSS values (`xPct`, `yPct`, `sizePx`) instead of being assembled from bare numbers in the style attribute — a `NaN`/undefined value can no longer collapse a dot to zero size or drop its position.
- Added `Number.isFinite` guards for x, y, size, glow, and carry, plus a `min-width`/`min-height` of 15px and a colour fallback, so a dot always renders even with incomplete weather data.
- The map label now reads `USA · LIVE CONDITIONS · N PARKS`, showing how many parks were actually plotted — instant confirmation the loop is producing data.
- Verified: 7/7 dots rendered, visible, correctly coloured and positioned in the real runtime; all 11 nav tabs still pass the regression harness.

## v1.4.7 — Fixed blank Radar map (no dots showing) [superseded by v1.4.8 — did not fix the issue]
- The "USA · LIVE CONDITIONS" map on the Radar tab was rendering completely empty (no park dots), even though the exact same park data powered the working "Tonight's parks by carry" list right below it and the detail panel.
- Root cause: the map's park-dot buttons were the only empty (childless) elements in a repeating loop anywhere in the app — every other repeating loop's item has inner content. Verified via isolated headless-browser rendering with real production-computed park data (position, size, color, glow) that the childless button pattern is the structural outlier, while every other version of that same markup (with inner content) renders correctly.
- Fix: gave each map dot button a small inner filler element, matching the structural pattern already used everywhere else the app repeats a list, with zero visual change to size, color, glow, or position.
- Verified with real computed park data (7 mock parks spanning the full hot-to-cold color range) rendered pixel-for-pixel correctly in a headless browser both before isolating the fix and after applying it, plus a full 11-tab regression pass.

## v1.4.6 — Show sportsbook next to the best price
- Every player's "Best +price · EV +x%" badge (Intelligence Report drawer) now also shows which book that best price came from, e.g. `Best +850 (Fanatics) · EV +147.0%`.
- This is driven by the same shared player-enrichment logic used for every player on the board, so it applies everywhere that badge shows up — not just one card.
- Falls back gracefully to the plain `Best +price · EV +x%` format if per-book pricing isn't available for that player.
- Verified with mock multi-book pricing (confirmed the correct book is matched to the best price) and with players missing per-book data or odds entirely (no crashes, sensible fallback text).

## v1.4.5 — Stopped using live in-play odds for HR props
- Once a game went live, the Top value plays / model board was picking up sportsbooks' live in-play home run prices instead of the original pregame line — that's why odds sometimes showed things like +25000 mid-game (in-play props reprice based on remaining at-bats and are not comparable to the pregame market).
- Confirmed via OddsBlaze's own API docs that every event includes a `live: true/false` flag; the proxy and the odds fetch were not filtering on it.
- Fixed in two places: the server-side OddsBlaze proxy now requests `live=false` so only pre-match lines are ever fetched, and the front end's odds parser also skips any event flagged `live: true` as a safety net.
- Verified with a mock odds response containing both a pregame and a live-flagged entry for the same player — confirmed only the pregame price is now used.

## v1.4.4 — Actually fixed "Top value plays" (v1.4.3 fix didn't survive rendering)
- v1.4.3's fix moved the row loop inside the table in the source markup, which was correct on paper but got silently undone: real `<table>` elements have strict HTML parsing rules, and any non-standard tag (like the row loop) placed directly inside `<tbody>` gets automatically pulled out by the browser the moment the page is parsed — which is exactly why the table stayed empty even after deploying v1.4.3.
- Rebuilt the table using CSS `display:table` / `table-row` / `table-cell` divs (the same row-looping technique already used everywhere else in this app), which has no such parsing restriction.
- Verified this time by actually loading the exact markup in a headless browser before shipping: confirmed the old table structure reproduced the bug, confirmed the new div-based structure survives parsing intact (loop stays in place), and confirmed it visually renders as a normal aligned table with real sample rows.

## v1.4.3 — Fixed empty "Top value plays" table
- The Research tab's Top value plays table was rendering completely empty (just a stray `%`) no matter what data was live — not a data/odds issue, a markup bug: the row-repeating loop was closed immediately before the `<table>` even started, so the single row template sat outside the loop with no player in scope.
- Moved the loop inside `<tbody>` so it correctly repeats one row per ranked player again.
- Scanned the rest of the app for the same loop-placement mistake — no other instances found.

## v1.4.2 — Fixed missing Tools tab + nav audit
- Audited every nav tab (Dashboard, Games, Radar, Solver, Hedge, Report Card, Builder, Research, Tracking, Live, Tools) by exercising each tab's data/render logic end-to-end; all compute cleanly with no dead bindings.
- Found and fixed a real bug: the **Tools** tab (model settings, exposure guardrails, exports/methodology) had a working content screen but no nav button, so it was unreachable from the sidebar or mobile bottom nav. Added it back to both nav bars.
- No other broken tabs, dead buttons, or undefined bindings found across the remaining 10 tabs.

## v1.4.1 — Fixed player headshots not loading
- Player head shots were breaking silently across the app (locks, watchlist, due list, star plays, game cards, radar top bats, solver bets, anchor parlay, round-robin picker, live HR feed, win-rate legs, and the player drawer) because the single Cloudinary-less `midfield.mlbstatic.com/.../spots/120` URL sometimes fails to resolve for a given player.
- Headshots now load from the primary MLB photo CDN (`img.mlbstatic.com` Cloudinary headshot endpoint) and automatically retry a fallback URL (`midfield.mlbstatic.com`) before giving up and hiding the image, so a bad primary URL no longer means a blank avatar.
- No API, dependency, or route changes — front-end only.

## v1.4.0 — HR Data Engine removed (slimmer app)
- Removed the HR Data Engine entirely to cut data + storage usage: the `hr_real/` Statcast pipeline, all `/api/hr/*` routes, the in-app 🧬 HR Data Engine panel + Data tab, trained-model artifacts (`server_data/models/`), and the `pybaseball` / `pandas` / `numpy` / `streamlit` dependencies.
- Everything else stays: live MLB slate, Dinger Score model %, OddsBlaze odds proxy, EV / edge math, Bet Slip + Kelly solver, round-robin hedge, and bet tracking + auto-grading (`/api/grade`, `/api/grade_ledger`, `/api/state`).
- `requirements.txt` is down to `requests`, `flask`, `flask-cors`. No Statcast ingestion and no local SQLite training DB.
- **Action on your Mac:** delete the local training database `server_data/hr_data.db` (~227 MB) and any `server_data/models/` folder — they are no longer used.

## v1.3.0 — Trained-model probabilities API + repo cleanup
- Added `train_model.score_players()`: scores each player's latest feature row with the newest trained XGBoost model and returns per-player HR probabilities keyed by `player_id` and normalized name.
- Added `GET /api/hr/model_probs` (optional `?player_ids=` filter) so the front-end EV / edge / Bet Slip engine can run off the trained model instead of the in-browser heuristic.
- Feature build joins ballpark weather (`temp_f`, `wind_mph` via Open-Meteo) alongside park factors, opposing-starter HR rate, and 30-day recent form.
- Repo cleanup: removed macOS/bytecode cruft, stale duplicate root build scripts (canonical copies live in `tools/`), the unreferenced `engine_server.py`, and superseded model artifacts (kept the two newest).

## v1.2.2 — MLB Home Run Prediction Engine
- Added a new MLB-side **HR Engine** launcher in the DingerLab app.
- Runs a calibrated ML home-run model directly in the browser using embedded model data.
- Daily HR board ranks hitter-vs-pitcher matchups by game HR probability.
- Click any matchup for Monte Carlo simulation details: simulated PAs, HR count, per-PA HR%, game HR%, confidence, EV/LA/barrel outputs, park/weather factors, and reasons why the model likes or fades the matchup.
- Current build is labeled **Synthetic Data** until live Statcast ingestion is enabled; the backend training pipeline is ready for real Statcast with `ingest_statcast.py`.


## v1.2.2 — MLB HR Engine real-data milestone
- Removed synthetic-trained HR predictions from the app.
- Synthetic data is now forbidden for model training, evaluation, backtesting, and prediction.
- Added a real-data-first HR Data Engine panel inside DingerLab.
- Added Render-ready backend routes for HR database status, Statcast ingestion, cleaning, feature rows, and EDA.
- Added `hr_real/` pipeline: real SQLite schema, Statcast ingestion, PA-event cleaning, leakage-safe feature engineering, and EDA reporting.
- Kept OddsBlaze/Render workflow: `ODDSBLAZE_KEY` stays in Render env vars and `/api/oddsblaze` remains the odds source.
- ML training is intentionally locked until real historical Statcast rows are loaded.


## v1.2.7 — All-season Statcast ingestion + database-lock fix
- The HR Data Engine panel now ingests **all 2021–2025 seasons in one click** instead of one season at a time.
- The backend `/api/hr/ingest_statcast` route now accepts a list of seasons, runs them sequentially, and retries on transient SQLite `database is locked` errors.
- `/api/hr/build_features` is now serialized with ingestion behind the same lock so only one SQLite writer runs at a time.
- Single-season ingestion now sends the full season in one request instead of weekly chunks, reducing HTTP overhead and timeout risk.

## v1.2.5 — HR Data Engine works on localhost
- Fixed the HR Data Engine hitting the Render server instead of your local Flask server when running on localhost.
- All three proxy resolvers (`proxy()`, HR `proxyBase()`, odds `proxyBase()`) now check `window.DL_SERVER_MODE` **first** — when the app is served by `dingerlab_server.py`, MLB/odds/HR calls go same-origin (`/api/...`) instead of the pinned Render URL in localStorage.
- Result: local ingest/build/status now read and write your local DB.
- Note: local Statcast ingestion needs `pybaseball` installed (`pip install -r requirements.txt`) and outbound internet to Baseball Savant.

## v1.2.4 — HR Data Engine: in-app Statcast ingestion
- Fixed the HR Data Engine showing all zeros: the panel could initialize the DB and build features, but there was **no way to actually ingest Statcast from the UI** (ingestion was CLI-only), so the database stayed empty.
- Added a **season picker (2021–2025)** and an **⬇ Ingest Statcast** button to the panel's Status tab.
- Ingestion runs client-side in **weekly chunks** (regular-season window ~Mar 20 → Oct 5) so it doesn't hit request timeouts on long pulls; progress shows live row counts and can resume if a chunk fails.
- On completion it **auto-runs Build (PA events → features → EDA)** and refreshes the status counters — no CLI needed.
- Uses the existing `/api/hr/ingest_statcast`, `/api/hr/build_features`, and `/api/hr/status` routes on the Render server.

## v1.2.3 — Live data via server proxy (board goes live)
- Routed **all** MLB calls (statsapi + Baseball Savant / Statcast) through the Render server's new `/api/mlb` passthrough, instead of the browser hitting MLB directly.
- Fixes the board falling back to "Sample data (offline)": direct browser calls were CORS-blocked (`statSplits`, `hydrate=stats(...)`, `venue`) and rate-limited from shared origins. Server-side fetch removes both.
- Added `/api/mlb` route to `dingerlab_server.py` (restricted to `statsapi.mlb.com` / `baseballsavant.mlb.com`).
- Front-end `index.html`: odds proxy pinned to the Render URL; head shim rewrites MLB requests to the proxy and strips the CORS-breaking `venue` hydrate token.
- Result: live board (real qualified hitters + 4-book odds) works in preview **and** on the deployed GitHub Pages site.

## v1.2.2 — Bundle/offline boot + OddsBlaze proxy fix
- Embedded React/ReactDOM directly into `index.html` so the main app no longer fails with `[bundle] error` when CDN/network access is unavailable.
- Default odds proxy now uses the current Render origin when the app is served over HTTP/HTTPS.
- Added `/api/oddsblaze/status` and clearer `ODDSBLAZE_KEY` diagnostics on the Render server.
