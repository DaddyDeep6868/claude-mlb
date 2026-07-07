# HR Engine v1.2.1 — Real Data Milestone

Synthetic data is blocked from model training, evaluation, backtesting, and prediction.
Synthetic data may only be used in isolated unit tests outside this production pipeline.

## Milestone 1 only
1. Real data ingestion
2. Real MLB database schema
3. Cleaning into PA-level events
4. Leakage-safe feature engineering
5. Exploratory analysis / data quality report

ML training is intentionally disabled until real historical Statcast rows exist.

## Render setup
Environment variables:
- `ODDSBLAZE_KEY` — OddsBlaze key
- `HR_DB_PATH` — optional SQLite path, defaults to `server_data/hr_engine_real.sqlite`
- `STATCAST_CHUNK_DAYS` — default 7

Install requirements, then run:
```bash
python -m hr_real.ingest_statcast --season 2021
python -m hr_real.ingest_statcast --season 2022
python -m hr_real.ingest_statcast --season 2023
python -m hr_real.ingest_statcast --season 2024
python -m hr_real.clean_features_eda
```

The DingerLab app reads `/api/hr/status` and `/api/hr/eda` from the Render server.
