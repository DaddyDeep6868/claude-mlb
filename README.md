# DingerLab v1.8.0 — Steam Alerts + Line Shopping

MLB home-run prop & parlay intelligence. Full front-end + server in this repo.

---

## Versioning (keep this current)

**On every update, bump the version in three places so the UI, files, and README stay in sync:**

1. **UI** — `index.html`: `<script>window.__DL_VERSION__="vX.Y.Z";</script>` (near `</head>`). This is what the app shows.
2. **README** — the `# DingerLab vX.Y.Z` title at the top, and add a `## vX.Y.Z — <summary>` changelog section at the bottom.
3. **Zip** — re-deliver the download so the packaged files carry the new version.

Bump **patch** (Z) for fixes, **minor** (Y) for features, **major** (X) for breaking changes. Current: **v1.8.0**.

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


## v1.8.0 — Steam alerts, stale-line detection, and line shopping
- Added time-aware steam alerts that require a **≥1.2 percentage-point consensus move** with at least **two books moving together**, reducing false positives from one-book repricing.
- Added move velocity, elapsed time, synchronized-book count, per-book price paths, and the current best available line to every steam alert.
- Added stale-line detection for books that have not moved while consensus shortens, plus a cold-start cross-book outlier fallback before enough history exists.
- Added a four-book line-shopping board ranked by implied-probability savings, with every available price shown inline.
- Persists a rolling six-hour, per-book local price history; snapshots are capped and pruned automatically.
- Added an isolated Node harness covering confirmed steam, stale lines, line shopping, single-book false-positive suppression, and snapshot persistence.

## v1.7.0 — Pitcher HR-vulnerability profile

The matchup model used to treat every pitcher's handedness split as the same constant. `platoonMult()` returned exactly three numbers for all of baseball: `1.07` when the batter had the platoon advantage, `0.94` when he didn't, `1.05` for switch hitters. A lefty-killer and a lefty-proof pitcher got identical treatment.

Now each pitcher is scored on **his own** HR splits.

**New data pull** — `fetchPitcherSplits(season)` hits the MLB stats endpoint with `stats=statSplits&group=pitching&sitCodes=vl,vr,h,a` (`playerPool=All`, `gameType=R`), one request for the whole league, fetched in the same `Promise.all` as the existing Statcast / day-night / lineup calls, so it adds no extra round trip to load time. Per pitcher per split it stores `{ hr, bf, ip, rate, hr9 }`.

- `ipVal()` converts MLB innings notation to real decimals — `45.1` means 45⅓, not 45.1. Getting this wrong quietly inflates every HR/9 by a few percent.

**How the factor is built** — `pitcherSplitFactor(prof, batSide, pitchHand, pitcherAtHome)`:

- **Regression to league mean.** Raw HR-per-BF on a partial-season split is extremely noisy, so each split is shrunk toward league average: `(hr + LG*K) / (bf + K)` with `LG = 0.031` and `K = 200` batters faced. A pitcher needs real volume before his split moves the number much.
- **Hand factor** = his regressed rate against the side the batter swings from, divided by his regressed overall rate. Clamped to `[0.80, 1.25]`.
- **Home/road factor** = same construction on the `h`/`a` splits. Clamped tighter, `[0.92, 1.10]`, and only applied when that pitcher has `>= 100` BF in the home/road split.
- **Switch hitters** are routed to the side they'll actually bat from: vs RHP they use the pitcher's vLHB split, vs LHP the vRHB split.
- **Sample gate.** Under 100 BF in the handedness split, we fall back to the old generic constant rather than trusting a tiny sample.
- **One combined clamp.** The final `handFactor * homeFactor` is clamped once to `[0.78, 1.30]`. This matters because the model already applies a season HR/9 multiplier (`pMult`), a recent-form multiplier (`formMult`), and the v1.6.0 calibration/blend layers — without a single outer clamp, the same "this pitcher gives up homers" signal would get counted three or four times and blow up the projection.

**Recent form window widened** — `fetchPitcherForm` now averages the last **5** starts instead of the last 3. Three starts is roughly 18 innings; one bad afternoon dominated the number.

**Surfaced in the UI** — the player detail panel's existing factor list (no new cards or layout changes):

- `Hand split (his own)` — replaces the old `Handedness` row, showing the faced side plus that pitcher's HR/9 against it. Reads `Handedness (generic)` when we fell back.
- `Pitcher L/R profile` — `1.62 vL / 0.74 vR`.
- `Pitcher home/road` — `1.48 home / 0.66 road · at home`.
- `HR/9 L3` label is now `HR/9 L5`.
- The frontier row reads `Pitcher hand/venue split` on the real path, `Platoon (generic)` on the fallback, so you can always tell which one produced the number.
- A reasons line spells out the splits and the combined multiplier, or says plainly that there's no usable split yet.

**Tests** — 26 assertions on the split math (`ipVal` innings conversion, both clamp ceilings and floors, the combined clamp, sample gates, switch-hitter routing, generic-path equivalence with the old constant) and 22 on the detail-panel rows across the splits path, the road variant, the generic fallback, and a bare player with no data. All 11 nav tabs re-verified.

---

## v1.6.1 — Fixed the blank Radar map (actual root cause)

The real fix for the empty Radar map that v1.4.7 and v1.4.8 both failed to solve. Both earlier attempts targeted dot *rendering*; the dots were never the problem — the park list was empty before rendering ever started.

**Two defects, both confirmed by reproduction:**

1. **The radar bailed out entirely whenever the app was not in live mode.** The park builder began with `if (!live || !gamesRaw) return []`. Any time the MLB or odds fetch failed, every other tab fell back to sample data and kept working normally, while Radar alone returned zero parks and painted a blank map. Reproduced in a real headless browser: the app loads in `Sample data (offline)` mode and the map rendered 0 dots.
2. **Venue-name mismatches silently dropped parks.** The coordinate table was keyed by exact venue name, and three names the MLB API actually returns were absent — `Sutter Health Park` (Athletics), `George M. Steinbrenner Field` (Rays), and the `Angel Stadium of Anaheim` variant. Each unmatched park vanished with no error or warning.

**Fixes:**
- Parks are now sourced from the live schedule *or*, on sample/fallback data, from the board itself, so the map is never blank.
- Added the three missing venues, plus `parkGeoLookup()` — a normalized-name fallback (case, punctuation, and `of Anaheim`-style suffixes) so future park renames match instead of silently disappearing.
- The map corner label is now a live self-diagnostic: `USA · 8 PARKS`, appending `· N UNMAPPED` when a venue misses the lookup and `· SAMPLE` when not on live data. A blank or short map now reports its own cause without needing DevTools.

**Verified:** sample/fallback mode went 0 → 6 parks and a live slate using real 2026 venue names went 5 of 8 → 8 of 8, measured directly against the shipped component code. Confirmed in a real headless browser on the offline path: label reads `USA · 6 PARKS · SAMPLE` with 12 dot buttons across 7 distinct map positions and the detail panel populated. Full 11-tab regression pass.

## v1.6.0 — Calibration loop, model/market blend, Kelly off true probability

The board now shows probabilities it can defend. Three linked changes:

**1. Calibration from your own ledger.** Every prediction that reaches a Final game is graded, and the model gets a single correction factor (predicted HRs vs actual HRs). The factor is shrunk toward neutral until the sample is real (`n / (n + 200)`) and hard-clamped to ×0.6–×1.4, so one hot week can't wreck the board. With no history the factor is ×1.00 and nothing changes.

**2. Model/market blend.** Board probabilities are now a weighted mix of the calibrated model and the de-vigged market consensus from v1.5.0. The market gets the larger share by default (65%), and the model earns weight as its track record grows — up to 60/40 in the model's favor. Players with no two-sided market fall back to the calibrated model alone.

**3. Kelly stakes off the blended probability.** The Slate Solver now sizes every bet from the blended number instead of the raw model, which stops the systematic over-betting caused by staking against inflated edges.

Also in this release:
- Headline **EV** on every player is now true EV, priced off the blended probability. The raw model EV is retained internally as `rawEv` for comparison.
- **Edge** is measured as blended probability minus fair probability.
- The market chip reads `HR · 21.4% model → 14.8% blended` (or `→ 20.4% adj` when there's no two-sided market).
- Report Card gained a **Calibration factor** row (with graded-sample count), a **Board blend** row, and a plain-English verdict on whether the model is running hot or cold.

Verified before release: 50 unit assertions covering the calibration math, clamps, blend weighting, EV/edge redefinition and solver staking; the 11-tab regression harness; and a real-browser run with a seeded prediction log confirming the Report Card renders live values (×0.95, 37% model / 63% market, 20 graded).

## v1.5.0 — Fair odds (de-vig), automatic CLV capture, confirmed-lineup gating

Three edge-finding upgrades:

**1. De-vigged fair odds + true EV.** The odds fetch now keeps the **Under 0.5** price alongside the Over. For each book we measure the actual overround (Over% + Under%) and divide it out, then take the median fair probability across books. When a book only posts one side, we fall back to that book's measured median hold (or 1.14 if it never posts two-sided). Every player now carries a **fair price** and a **market EV** — EV measured against the no-vig line instead of the raw posted price. The odds chip reads `Best +850 (DraftKings) · EV +147.0% · Fair +1100`, **Edge** is now model% minus fair% (not raw implied%), and a new **Value** sort ranks the board by market EV.

**2. Automatic closing-line (CLV) capture.** Pre-game prices are now persisted to `dl_close_v1` on every poll. Because the odds feed only returns pre-game events, the last price stored for a player *is* the closing line. When a tracked bet's game goes Live or Final the close is **frozen** (`closeLocked`) so in-play prices can never overwrite it, and legs added late still recover a close from storage. Each leg also records CLV in odds points (`clvCents`) alongside the existing probability-point CLV.

**3. Confirmed-lineup gating + batting-order weighting.** Lineup lookup now returns each hitter's **batting-order slot** and tracks confirmation **per team** instead of per game — so one team posting its card no longer affects the other side. Once a team posts, hitters not on the card are dropped from the board. Expected plate appearances now scale by slot (leadoff 4.65 PA → 9-hole 3.80 PA) instead of a flat 4.1 for everyone, which feeds directly into the HR probability. The badge shows the slot: `✓ IN #3`.

Verified in a real browser run (mocked feeds with two-sided prices and a posted lineup): fair prices render on the odds chip, slot badges appear only for the team that posted, the closing-line store fills, and the Value sort works. 35 unit assertions on the de-vig math, CLV lock behavior, and slot weighting all pass, plus the 11-tab regression.

## v1.4.8 — Radar map hardening + park-count diagnostic [DID NOT SHIP — code was never present in any delivered build, and did not fix the issue; see v1.6.1 for the actual root cause]

Note: this entry was written but the described code never made it into a delivered zip, and the approach was wrong regardless — the dots were not the problem. The blank map was fixed in v1.6.1.

Follow-up after v1.4.7 did not fix the blank map. Dots are now wrapped in their own absolutely-positioned overlay layer, positions/sizes are precomputed and guarded with `Number.isFinite` (with a minimum 15px hit area and explicit z-index), and the map label now reports the live park count — `USA · LIVE CONDITIONS · 7 PARKS` — so a blank map immediately distinguishes "no data arrived" (0 parks) from "data arrived but nothing painted".

## v1.4.7 — Attempted fix for blank Radar map (no dots showing) [did not fix the issue; actual root cause found in v1.6.1]
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
