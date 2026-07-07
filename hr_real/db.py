import sqlite3
from pathlib import Path
from .config import DB_PATH
SCHEMA = Path(__file__).with_name('schema.sql')
def connect():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con
def init_db():
    con = connect(); con.executescript(SCHEMA.read_text()); con.commit(); con.close(); return str(DB_PATH)
