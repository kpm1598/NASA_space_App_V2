"""BLACKCAT REST API routes."""
import csv
import io
import json
from pathlib import Path

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import PlainTextResponse

from ..models.database import (clear_all, get_conn, get_meta, init_db,
                               set_meta)
from ..services import ingestion
from ..services.anomaly import run_anomaly_detection
from ..services.clustering import run_clustering
from ..services.event_matcher import find_links
from ..services.insights import generate_insights

router = APIRouter(prefix="/api")
SAMPLES_DIR = Path(__file__).resolve().parents[2] / "data" / "samples"
OBS_CAP = 5000


def _conn():
    conn = get_conn()
    init_db(conn)
    return conn


def run_pipeline(conn):
    links = find_links(conn)
    cl = run_clustering(conn)
    anomalies = run_anomaly_detection(conn)
    return {"links": links, "clusters": cl["clusters"],
            "isolated": cl["isolated"], "anomalies": anomalies}


def _ingest_records(conn, records, provenance, clear=True):
    if clear:
        clear_all(conn)
    n = ingestion.insert_observations(conn, records)
    set_meta(conn, "provenance", provenance)
    pipe = run_pipeline(conn)
    return {"ingested": n, **pipe}


@router.get("/health")
def health():
    conn = _conn()
    n = conn.execute("SELECT COUNT(*) c FROM observations").fetchone()["c"]
    return {"status": "ok", "observations": n}


@router.post("/ingest/sample")
def ingest_sample():
    files = sorted(p for p in SAMPLES_DIR.glob("*")
                   if p.suffix.lower() in (".csv", ".json", ".geojson"))
    if not files:
        return {"ingested": 0, "files": [], "detail": "no sample files found"}
    records = []
    for f in files:
        records.extend(ingestion.load_path(f))
    prov_file = SAMPLES_DIR / "DATA_PROVENANCE.txt"
    provenance = (prov_file.read_text().strip() if prov_file.exists()
                  else "Sample data bundled with the application")
    conn = _conn()
    result = _ingest_records(conn, records, provenance)
    result["files"] = [f.name for f in files]
    return result


@router.post("/ingest/file")
async def ingest_file(file: UploadFile = File(...), append: bool = False):
    """Ingest one uploaded FIRMS file (CSV or GeoJSON).

    Default behaviour replaces the current dataset. Pass ?append=true to
    ADD the file to the data already loaded — this is how a MODIS file and
    a VIIRS file are uploaded one after another without the second upload
    wiping the first. The full pipeline re-runs on the combined data.
    """
    data = await file.read()
    records = ingestion.load_file_bytes(file.filename or "upload", data)
    conn = _conn()
    existing = conn.execute(
        "SELECT COUNT(*) c FROM observations").fetchone()["c"]
    if append and existing:
        prior = get_meta(conn, "provenance", "") or "existing data"
        return _ingest_records(
            conn, records,
            f"{prior} + uploaded file: {file.filename}", clear=False)
    return _ingest_records(conn, records,
                           f"Uploaded file: {file.filename}")


@router.get("/stats")
def stats():
    conn = _conn()
    total = conn.execute("SELECT COUNT(*) c FROM observations").fetchone()["c"]
    per_sensor = {r["sensor"]: r["c"] for r in conn.execute(
        "SELECT sensor, COUNT(*) c FROM observations GROUP BY sensor")}
    rng = conn.execute(
        "SELECT MIN(obs_date) a, MAX(obs_date) b FROM observations").fetchone()
    clusters = conn.execute("SELECT COUNT(*) c FROM clusters").fetchone()["c"]
    mixed = conn.execute(
        "SELECT COUNT(*) c FROM clusters WHERE mixed_sensor=1").fetchone()["c"]
    anomalies = conn.execute("SELECT COUNT(*) c FROM anomalies").fetchone()["c"]
    links = conn.execute("SELECT COUNT(*) c FROM links").fetchone()["c"]
    isolated = conn.execute(
        "SELECT COUNT(*) c FROM observations WHERE cluster_id IS NULL"
    ).fetchone()["c"]
    return {
        "total_observations": total,
        "modis": per_sensor.get("MODIS", 0),
        "viirs": per_sensor.get("VIIRS", 0),
        "clusters": clusters,
        "mixed_sensor_clusters": mixed,
        "candidate_links": links,
        "anomalies": anomalies,
        "isolated_observations": isolated,
        "date_from": rng["a"], "date_to": rng["b"],
        "provenance": get_meta(conn, "provenance",
                               "No data ingested yet"),
    }


def _filtered_query(west=None, south=None, east=None, north=None,
                    date_from=None, date_to=None, sensor=None):
    """Shared WHERE clause for observation listing and CSV export.

    The bounding box (west/south/east/north) is the area-of-interest
    filter the challenge asks for: users select a region and date range,
    then view or download the matching hotspots.
    """
    q = "SELECT * FROM observations WHERE 1=1"
    args = []
    if west is not None and east is not None:
        q += " AND longitude BETWEEN ? AND ?"
        args += [west, east]
    if south is not None and north is not None:
        q += " AND latitude BETWEEN ? AND ?"
        args += [south, north]
    if date_from:
        q += " AND obs_date >= ?"
        args.append(date_from)
    if date_to:
        q += " AND obs_date <= ?"
        args.append(date_to)
    if sensor:
        q += " AND sensor = ?"
        args.append(sensor.upper())
    return q, args


@router.get("/observations")
def observations(west: float = None, south: float = None, east: float = None,
                 north: float = None, date_from: str = None,
                 date_to: str = None, sensor: str = None,
                 limit: int = OBS_CAP):
    conn = _conn()
    q, args = _filtered_query(west, south, east, north,
                              date_from, date_to, sensor)
    limit = max(1, min(limit, OBS_CAP))
    total_matching = conn.execute(
        q.replace("SELECT *", "SELECT COUNT(*) c"), args).fetchone()["c"]
    rows = conn.execute(q + " ORDER BY observed_at LIMIT ?", args + [limit])
    out = []
    linked = {r["obs_id_a"] for r in conn.execute("SELECT obs_id_a FROM links")}
    linked |= {r["obs_id_b"] for r in conn.execute("SELECT obs_id_b FROM links")}
    for r in rows:
        d = dict(r)
        d.pop("raw_json", None)
        d["has_candidate_link"] = r["id"] in linked
        out.append(d)
    return {"count": len(out), "total_matching": total_matching,
            "capped": total_matching > len(out), "cap": OBS_CAP,
            "observations": out}


EXPORT_CAP = 100_000
_CONF_LABELS = {0: "low", 1: "nominal", 2: "high"}


@router.get("/observations.csv")
def observations_csv(west: float = None, south: float = None,
                     east: float = None, north: float = None,
                     date_from: str = None, date_to: str = None,
                     sensor: str = None):
    """Download the hotspot rows matching the current search filters.

    The challenge statement asks for a downloadable CSV of the hotspots
    detected during a search (region, date range, sensor) — distinct from
    the /report.csv regional summary.
    """
    conn = _conn()
    q, args = _filtered_query(west, south, east, north,
                              date_from, date_to, sensor)
    rows = conn.execute(q + " ORDER BY observed_at LIMIT ?",
                        args + [EXPORT_CAP])
    linked = {r["obs_id_a"] for r in conn.execute("SELECT obs_id_a FROM links")}
    linked |= {r["obs_id_b"] for r in conn.execute("SELECT obs_id_b FROM links")}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "sensor", "satellite", "latitude", "longitude",
                "observed_at_utc", "obs_date", "brightness", "frp_mw",
                "confidence_raw", "confidence_harmonized", "daynight",
                "cluster_id", "has_candidate_link",
                "note"])
    for r in rows:
        d = dict(r)
        w.writerow([d.get("id"), d.get("sensor"), d.get("satellite"),
                    d.get("latitude"), d.get("longitude"),
                    d.get("observed_at"), d.get("obs_date"),
                    d.get("brightness"), d.get("frp"),
                    d.get("confidence_raw"),
                    _CONF_LABELS.get(d.get("confidence_harmonized"),
                                     "unknown"),
                    d.get("daynight"), d.get("cluster_id") or "",
                    "yes" if d.get("id") in linked else "no",
                    "satellite-detected thermal anomaly, not a confirmed "
                    "ground-truth wildfire"])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=blackcat_hotspots.csv"})


@router.get("/observations/{obs_id}")
def observation_detail(obs_id: int):
    conn = _conn()
    r = conn.execute("SELECT * FROM observations WHERE id=?",
                     (obs_id,)).fetchone()
    if r is None:
        return {"detail": "observation not found"}
    d = dict(r)
    raw = json.loads(d.pop("raw_json") or "{}")
    links = [dict(x) for x in conn.execute(
        "SELECT * FROM links WHERE obs_id_a=? OR obs_id_b=?",
        (obs_id, obs_id))]
    return {"unified": d, "original": raw, "candidate_links": links}


@router.get("/harmonization")
def harmonization():
    """Per-sensor comparison stats used by the Harmonization view."""
    conn = _conn()
    out = {"sensors": {}}
    for sensor in ("MODIS", "VIIRS"):
        rows = conn.execute(
            "SELECT frp, confidence_harmonized FROM observations "
            "WHERE sensor=?", (sensor,)).fetchall()
        frps = sorted(r["frp"] for r in rows if r["frp"] is not None)
        median = frps[len(frps) // 2] if frps else None
        conf = {0: 0, 1: 0, 2: 0, "unknown": 0}
        for r in rows:
            key = r["confidence_harmonized"]
            conf[key if key in (0, 1, 2) else "unknown"] += 1
        out["sensors"][sensor] = {
            "count": len(rows), "median_frp": median,
            "confidence_distribution": {
                "low": conf[0], "nominal": conf[1], "high": conf[2],
                "unknown": conf["unknown"]}}
    out["candidate_links"] = conn.execute(
        "SELECT COUNT(*) c FROM links").fetchone()["c"]
    out["mixed_sensor_clusters"] = conn.execute(
        "SELECT COUNT(*) c FROM clusters WHERE mixed_sensor=1").fetchone()["c"]
    # One example observation that participates in a candidate link
    row = conn.execute(
        "SELECT obs_id_a FROM links LIMIT 1").fetchone()
    out["example_observation_id"] = row["obs_id_a"] if row else None
    if out["example_observation_id"] is None:
        row = conn.execute("SELECT id FROM observations LIMIT 1").fetchone()
        out["example_observation_id"] = row["id"] if row else None
    return out


@router.get("/calendar")
def calendar():
    conn = _conn()
    rows = conn.execute(
        "SELECT obs_date, sensor, COUNT(*) c FROM observations "
        "GROUP BY obs_date, sensor ORDER BY obs_date").fetchall()
    days = {}
    for r in rows:
        d = days.setdefault(r["obs_date"],
                            {"date": r["obs_date"], "total": 0,
                             "modis": 0, "viirs": 0})
        d["total"] += r["c"]
        d["modis" if r["sensor"] == "MODIS" else "viirs"] += r["c"]
    return {"days": [days[k] for k in sorted(days)]}


@router.get("/clusters")
def clusters():
    conn = _conn()
    return {"clusters": [dict(r) for r in conn.execute(
        "SELECT * FROM clusters ORDER BY obs_date, n_obs DESC")]}


@router.get("/anomalies")
def anomalies():
    conn = _conn()
    return {"anomalies": [dict(r) for r in conn.execute(
        "SELECT * FROM anomalies ORDER BY obs_count DESC")],
        "note": "Anomalies are statistically unusual grid-cell days in this "
                "dataset. They are not confirmed fires and not predictions."}


@router.get("/insights")
def insights():
    conn = _conn()
    return {"insights": generate_insights(conn)}


@router.get("/report.csv")
def report_csv():
    conn = _conn()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["BLACKCAT regional activity summary"])
    w.writerow(["note", "Hotspots are satellite-detected thermal anomalies, "
                        "not confirmed ground-truth wildfires"])
    w.writerow(["provenance", get_meta(conn, "provenance", "")])
    w.writerow([])
    w.writerow(["date", "total_observations", "modis", "viirs",
                "clusters_that_day"])
    days = {}
    for r in conn.execute(
            "SELECT obs_date, sensor, COUNT(*) c FROM observations "
            "GROUP BY obs_date, sensor"):
        d = days.setdefault(r["obs_date"], {"t": 0, "m": 0, "v": 0})
        d["t"] += r["c"]
        d["m" if r["sensor"] == "MODIS" else "v"] += r["c"]
    cl = {r["obs_date"]: r["c"] for r in conn.execute(
        "SELECT obs_date, COUNT(*) c FROM clusters GROUP BY obs_date")}
    for date in sorted(days):
        d = days[date]
        w.writerow([date, d["t"], d["m"], d["v"], cl.get(date, 0)])
    w.writerow([])
    w.writerow(["grid_cell_lat", "grid_cell_lon", "date", "obs_count",
                "mean_frp", "max_frp", "explanation (unusual activity, "
                "not a fire or prediction)"])
    for r in conn.execute("SELECT * FROM anomalies ORDER BY obs_date"):
        w.writerow([r["cell_lat"], r["cell_lon"], r["obs_date"],
                    r["obs_count"], r["mean_frp"], r["max_frp"],
                    r["explanation"]])
    return PlainTextResponse(buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": "attachment; filename=blackcat_report.csv"})
