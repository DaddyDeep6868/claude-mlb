-- DingerLab HR Engine real-data warehouse. No synthetic training/evaluation tables.
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS ingest_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, season INTEGER, start_date TEXT, end_date TEXT,
  status TEXT NOT NULL, rows_seen INTEGER DEFAULT 0, rows_inserted INTEGER DEFAULT 0, error TEXT,
  started_at TEXT DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
);
CREATE TABLE IF NOT EXISTS players(
  player_id INTEGER PRIMARY KEY, name TEXT, bats TEXT, throws TEXT, primary_position TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS parks(
  park_id TEXT PRIMARY KEY, park_name TEXT, team TEXT, hr_factor_l REAL, hr_factor_r REAL, source TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS games(
  game_pk INTEGER PRIMARY KEY, game_date TEXT, season INTEGER, home_team TEXT, away_team TEXT, park_id TEXT,
  venue_name TEXT, game_type TEXT, day_night TEXT, temperature REAL, wind_speed REAL, wind_direction TEXT,
  weather_raw TEXT, status TEXT, FOREIGN KEY(park_id) REFERENCES parks(park_id)
);
CREATE TABLE IF NOT EXISTS statcast_pitches(
  pitch_uid TEXT PRIMARY KEY, game_pk INTEGER, game_date TEXT, season INTEGER, at_bat_number INTEGER, pitch_number INTEGER,
  batter INTEGER, pitcher INTEGER, batter_name TEXT, pitcher_name TEXT, stand TEXT, p_throws TEXT,
  inning INTEGER, balls INTEGER, strikes INTEGER, outs_when_up INTEGER,
  pitch_type TEXT, release_speed REAL, release_spin_rate REAL, release_pos_x REAL, release_pos_y REAL, release_pos_z REAL,
  pfx_x REAL, pfx_z REAL, plate_x REAL, plate_z REAL, zone INTEGER, vx0 REAL, vy0 REAL, vz0 REAL, ax REAL, ay REAL, az REAL,
  launch_speed REAL, launch_angle REAL, hit_distance_sc REAL, estimated_ba_using_speedangle REAL, estimated_woba_using_speedangle REAL,
  barrel INTEGER, hardhit INTEGER, bb_type TEXT, description TEXT, events TEXT, type TEXT,
  home_team TEXT, away_team TEXT, venue_name TEXT, raw_json TEXT,
  FOREIGN KEY(game_pk) REFERENCES games(game_pk)
);
CREATE INDEX IF NOT EXISTS idx_sc_batter_date ON statcast_pitches(batter, game_date);
CREATE INDEX IF NOT EXISTS idx_sc_pitcher_date ON statcast_pitches(pitcher, game_date);
CREATE INDEX IF NOT EXISTS idx_sc_game_pa ON statcast_pitches(game_pk, at_bat_number);
CREATE TABLE IF NOT EXISTS pa_events(
  pa_uid TEXT PRIMARY KEY, game_pk INTEGER, game_date TEXT, season INTEGER, at_bat_number INTEGER,
  batter INTEGER, pitcher INTEGER, stand TEXT, p_throws TEXT, pitch_count INTEGER,
  terminal_event TEXT, is_bip INTEGER, is_hr INTEGER, max_ev REAL, launch_angle REAL, barrel INTEGER, hardhit INTEGER,
  pitch_mix_json TEXT, zones_json TEXT, feature_json TEXT, FOREIGN KEY(game_pk) REFERENCES games(game_pk)
);
CREATE INDEX IF NOT EXISTS idx_pa_batter_date ON pa_events(batter, game_date);
CREATE INDEX IF NOT EXISTS idx_pa_pitcher_date ON pa_events(pitcher, game_date);
CREATE TABLE IF NOT EXISTS player_profiles(
  profile_date TEXT, player_id INTEGER, role TEXT, season INTEGER, profile_json TEXT, PRIMARY KEY(profile_date, player_id, role)
);
CREATE TABLE IF NOT EXISTS feature_rows(
  row_id TEXT PRIMARY KEY, as_of_date TEXT, season INTEGER, game_pk INTEGER, batter INTEGER, pitcher INTEGER,
  label_is_hr INTEGER, features_json TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS odds_snapshots(
  snapshot_id TEXT PRIMARY KEY, captured_at TEXT DEFAULT CURRENT_TIMESTAMP, sportsbook TEXT, league TEXT, market TEXT,
  player_name TEXT, player_id INTEGER, event_id TEXT, game_pk INTEGER, price INTEGER, line REAL, raw_json TEXT
);
CREATE TABLE IF NOT EXISTS eda_reports(
  report_id TEXT PRIMARY KEY, created_at TEXT DEFAULT CURRENT_TIMESTAMP, season_min INTEGER, season_max INTEGER,
  row_counts_json TEXT, metrics_json TEXT, quality_json TEXT
);
CREATE VIEW IF NOT EXISTS v_hr_engine_status AS
SELECT
  (SELECT COUNT(*) FROM statcast_pitches) AS pitch_rows,
  (SELECT COUNT(*) FROM pa_events) AS pa_rows,
  (SELECT COUNT(*) FROM feature_rows) AS feature_rows,
  (SELECT COUNT(DISTINCT season) FROM statcast_pitches) AS seasons_loaded,
  (SELECT MAX(game_date) FROM statcast_pitches) AS latest_statcast_date,
  (SELECT COUNT(*) FROM odds_snapshots) AS odds_rows;
