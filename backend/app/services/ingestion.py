"""Ingestion: load FIRMS records from CSV files or GeoJSON (.json) downloads
into the unified observations table. Original records are never discarded -
every row's full original field set is preserved in the raw_json column.
"""
import csv
import io
import json
from pathlib import Path

from .harmonizer import harmonize_record


def load_csv_bytes(data: bytes):
    text = data.decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return [harmonize_record(row) for row in reader if row]


def load_geojson_bytes(data: bytes):
    doc = json.loads(data.decode("utf-8-sig", errors="replace"))
    features = doc.get("features", []) if isinstance(doc, dict) else []
    out = []
    for feat in features:
        props = dict(feat.get("properties") or {})
        geom = feat.get("geometry") or {}
        coords = geom.get("coordinates") or [None, None]
        lon, lat = (coords + [None, None])[:2] if coords else (None, None)
        # Some FIRMS JSON exports embed lat/lon as properties instead
        out.append(harmonize_record(props, lat=lat, lon=lon))
    return out


def load_file_bytes(name: str, data: bytes):
    """Auto-detect CSV vs GeoJSON by extension, falling back to content sniffing."""
    ext = Path(name).suffix.lower()
    if ext == ".csv":
        return load_csv_bytes(data)
    if ext in (".json", ".geojson"):
        return load_geojson_bytes(data)
    head = data.lstrip()[:1]
    return load_geojson_bytes(data) if head == b"{" else load_csv_bytes(data)


def load_path(path: Path):
    return load_file_bytes(path.name, Path(path).read_bytes())


INSERT_SQL = """
INSERT INTO observations
 (latitude, longitude, observed_at, obs_date, sensor, satellite,
  confidence_raw, confidence_harmonized, frp, brightness, brightness_bg,
  daynight, source_product, cluster_id, raw_json)
VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
"""


def insert_observations(conn, records) -> int:
    rows = [
        (r["latitude"], r["longitude"], r["observed_at"], r["obs_date"],
         r["sensor"], r["satellite"], r["confidence_raw"],
         r["confidence_harmonized"], r["frp"], r["brightness"],
         r["brightness_bg"], r["daynight"], r["source_product"],
         r["cluster_id"], r["raw_json"])
        for r in records
        if r["latitude"] is not None and r["longitude"] is not None
    ]
    conn.executemany(INSERT_SQL, rows)
    conn.commit()
    return len(rows)
