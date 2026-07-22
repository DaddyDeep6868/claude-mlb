# DingerLab v1.2.5 — Stadium Night

MLB home-run prop & parlay intelligence. Full front-end + server in this repo.

---

## Versioning (keep this current)

**On every update, bump the version in three places so the UI, files, and README stay in sync:**

1. **UI** — `index.html`: `<script>window.__DL_VERSION__="vX.Y.Z";</script>` (near `</head>`). This is what the app shows.
2. **README** — the `# DingerLab vX.Y.Z` title at the top, and add a `## vX.Y.Z — <summary>` changelog section at the bottom.
3. **Zip** — re-deliver the download so the packaged files carry the new version.

Bump **patch** (Z) for fixes, **minor** (Y) for features, **major** (X) for breaking changes. Current: **v1.2.5**.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | Bundled app — GitHub Pages, open in any browser, no build step |
| `DingerLab Redesign.dc.html` | Source design component (edit this, re-bundle to update `index.html`) |
| `dingerlab_server.py` | Flask server — multi-device sync, server-side odds proxy, auto-grading |
| `streamlit_app.py` | Streamlit wrapper — alternative cloud deploy on Streamlit Community Cloud |
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
DINGERLAB_DISABLE_HR_ENGINE=false  # set to true on Render to keep the HR Data Engine local-Mac-only
```

The server handles:
- `/api/oddsblaze` — OddsBlaze proxy (reads `ODDSBLAZE_KEY` from env)
- `/api/state` — saved parlays + board snapshots sync across devices
- `/api/grade` — auto-grades pending legs from MLB boxscores (matches by MLB player id)
- `/api/grade_ledger` — name-based grading for ad-hoc bet ledgers
- `/api/hr/*` — HR Data Engine (local-Mac-only by default; see below)
- `/health` — liveness check

A background worker also re-grades pending slips every 10 min, so results settle even with no tab open.

### HR Data Engine — local Mac only

The HR Data Engine ingests and cleans large Statcast data sets, which needs more RAM than Render’s free tier (512 MB) provides. To keep your Render deploy stable:

- Set `DINGERLAB_DISABLE_HR_ENGINE=true` on Render. The front-end will then show a **Local Mac Only** notice instead of trying to load the engine.
- To use the HR Data Engine, run the Flask server locally on your Mac (or any machine with ≥4–8 GB free RAM): `python dingerlab_server.py`, then open `http://localhost:8501`.
- When running locally, keep the default `DINGERLAB_DISABLE_HR_ENGINE=false` (or unset it).

Data is written to `server_data/dingerlab_server_state.json`. Use a host with persistent disk.

---

## Deploy server on Render

1. New Web Service → connect this repo.
2. Build command: `pip install -r requirements.txt`
3. Start command: `python dingerlab_server.py`
4. Environment → add `ODDSBLAZE_KEY`. Optionally add `DINGERLAB_ALLOWED_ORIGIN=https://<you>.github.io` to restrict CORS.
5. Add `DINGERLAB_DISABLE_HR_ENGINE=true` so Render does not try to run the memory-heavy Statcast pipeline (the HR Data Engine stays available when running locally on your Mac).
6. Your URL (e.g. `https://mlb-slate.onrender.com`) goes in the app's **Tools → Live odds proxy**.

> **CORS:** the server defaults to allowing any origin (`*`) on `/api/*` so an unconfigured deploy works out of the box. For a public deploy, set `DINGERLAB_ALLOWED_ORIGIN` to your GitHub Pages origin so only your front-end can call the API.
>
> **Keys:** no credentials are hardcoded — `ODDSBLAZE_KEY` is read from the environment.

---

## Screens

Dashboard (Command Center) · Games · Radar (weather / ball-carry map) · Solver (bankroll-aware Kelly portfolio) · Report Card (model calibration vs results) · Builder (cross-play generator + payoff frontier) · Data (feature store) · Research (steam radar, value plays, what changed) · Tracking (CLV, W/L results) · Tools (odds proxy, model settings, exposure) · Live (HR feed + schedule)


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
