# DingerLab — Stadium Night (v6.0)

MLB home-run prop & parlay intelligence. `index.html` is a single
self-contained file — open it in a browser, no build step required.

## What's live (no key needed)
- **Real MLB slate** — today's games, venues, probable pitchers from MLB Stats API
- **Real HR model** — regressed season HR rate, park factor + opposing-starter adjusted, every qualified hitter (40+ PA) ranked by Dinger Score
- **Live HR feed** — home runs as they happen (Live tab)
- **Sample fallback** — works offline, shows representative data

## What's connected via your proxy
- **Live sportsbook odds** — fetches DraftKings, FanDuel, BetMGM, Caesars HR prices
  from `mlb-slate.onrender.com/api/oddsblaze` (CORS-enabled)
- **Real EV & edge** — model probability vs devigged implied probability per book
- **BEST EV** KPI, live prices on every play card, real parlay payouts in Builder
- **"Odds Connected · N books"** panel in Bet Slip when live

## Deploy on GitHub Pages
1. Add `index.html` + this README to a repo.
2. **Settings → Pages → Build from branch** → your branch, root `/`.
3. Live at `https://<you>.github.io/<repo>/` — model + odds load automatically.

## Local use
Opening as a `file://` URL blocks cross-origin fetches — the app shows sample
data. Serve locally with `python3 -m http.server 8080` and open
`http://localhost:8080` instead.

## Screens
Dashboard (Command Center) · Games · Builder · Data · Tracking · Research · Tools · Live.
