# DingerLab v1.2.1 — HR Engine real-data rebuild

This replaces v1.2.0's synthetic-trained HR prediction board.

## Policy change
Synthetic data is allowed only for unit tests, pipeline tests, or demos. It is forbidden for model training, evaluation, backtesting, and prediction.

## First milestone delivered
- Real MLB SQLite schema for multi-season Statcast/history.
- Statcast pitch-level ingestion via pybaseball/Baseball Savant.
- Data cleaning into PA-level events.
- Leakage-safe feature rows.
- EDA/data-quality report.
- Render Flask API routes: `/api/hr/init`, `/api/hr/status`, `/api/hr/ingest_statcast`, `/api/hr/build_features`, `/api/hr/eda`, `/api/hr/requirements`.
- Existing OddsBlaze Render proxy remains `/api/oddsblaze`; set `ODDSBLAZE_KEY` in Render env vars.

## Important limitation
The current sandbox has no DNS/network access, so it cannot download Baseball Savant, MLB Stats API, weather, or OddsBlaze data here. Run ingestion on Render or a network-enabled machine.

## Next step on Render
```bash
python -m hr_real.ingest_statcast --season 2021
python -m hr_real.ingest_statcast --season 2022
python -m hr_real.ingest_statcast --season 2023
python -m hr_real.ingest_statcast --season 2024
python -m hr_real.clean_features_eda
```
Only after that should ML training be added.
