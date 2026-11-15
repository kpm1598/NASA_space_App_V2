"""SQLite storage layer (stdlib sqlite3 only).

Tables:
  observations - unified harmonized observations, originals preserved in raw_json
  links        - candidate cross-sensor links (NOT confirmed duplicates)
  clusters     - per-cluster aggregate stats
  anomalies    - flagged grid-cell/day aggregates with text explanations
  meta         - key/value store (data provenance label, last pipeline run)
"""
import os
import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]  # backend/
DEFAULT_DB = BASE_DIR / "data" / "blackcat.db"


def db_path() -> Path:
    p = Path(os.environ.get("BLACKCAT_DB", str(DEFAULT_DB)))
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path()))
    conn.row_factory = sqlite3.Row
    return conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    observed_at TEXT NOT NULL,
    obs_date TEXT NOT NULL,
    sensor TEXT NOT NULL,
    satellite TEXT,
    confidence_raw TEXT,
    confidence_harmonized INTEGER,
    frp REAL,
    brightness REAL,
    brightness_bg REAL,
    daynight TEXT,
    source_product TEXT,
    cluster_id TEXT,
    raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_obs_date ON observations(obs_date);
CREATE INDEX IF NOT EXISTS idx_obs_sensor ON observations(sensor);
CREATE INDEX IF NOT EXISTS idx_obs_cluster ON observations(cluster_id);

CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obs_id_a INTEGER NOT NULL,
    obs_id_b INTEGER NOT NULL,
    distance_km REAL NOT NULL,
    time_diff_min REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS clusters (
    cluster_id TEXT PRIMARY KEY,
    obs_date TEXT NOT NULL,
    n_obs INTEGER NOT NULL,
    n_modis INTEGER NOT NULL,
    n_viirs INTEGER NOT NULL,
    mixed_sensor INTEGER NOT NULL,
    centroid_lat REAL,
    centroid_lon REAL,
    max_frp REAL,
    mean_frp REAL
);

CREATE TABLE IF NOT EXISTS anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cell_lat REAL NOT NULL,
    cell_lon REAL NOT NULL,
    obs_date TEXT NOT NULL,
    obs_count INTEGER NOT NULL,
    mean_frp REAL,
    max_frp REAL,
    viirs_share REAL,
    night_share REAL,
    anomaly_score REAL,
    explanation TEXT
);

CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()


def clear_all(conn: sqlite3.Connection) -> None:
    for t in ("observations", "links", "clusters", "anomalies"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (key, value),
    )
    conn.commit()


def get_meta(conn: sqlite3.Connection, key: str, default=None):
    row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default
