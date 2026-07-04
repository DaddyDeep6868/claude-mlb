# DingerLab v1.0.4 — Stadium Night

MLB home-run prop & parlay intelligence. Full front-end + server in this repo.

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
