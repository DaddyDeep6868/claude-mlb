import os
from pathlib import Path
APP_DIR = Path(__file__).resolve().parents[1]
DB_PATH = Path(os.environ.get('HR_DB_PATH', APP_DIR / 'server_data' / 'hr_engine_real.sqlite'))
STATCAST_CHUNK_DAYS = int(os.environ.get('STATCAST_CHUNK_DAYS', '7'))
ODDSBLAZE_BASE = os.environ.get('ODDSBLAZE_BASE', 'https://odds.oddsblaze.com/')
ODDSBLAZE_KEY = os.environ.get('ODDSBLAZE_KEY', '')
