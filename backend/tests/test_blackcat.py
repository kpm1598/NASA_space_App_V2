import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.database import get_conn
from app.routes import api as api_module
from app.services import ingestion
from app.services.anomaly import build_explanation
from app.services.clustering import run_clustering
from app.services.event_matcher import find_links, haversine_km
from app.services.harmonizer import harmonize_confidence, parse_acq_datetime

from .fixtures import GEOJSON, MODIS_CSV, VIIRS_CSV

client = TestClient(app)


# ---------- harmonizer ----------
def test_confidence_mapping_modis():
    assert harmonize_confidence("MODIS", 10)[1] == 0
    assert harmonize_confidence("MODIS", 29)[1] == 0
    assert harmonize_confidence("MODIS", 30)[1] == 1
    assert harmonize_confidence("MODIS", 79)[1] == 1
    assert harmonize_confidence("MODIS", 80)[1] == 2
    assert harmonize_confidence("MODIS", 100)[1] == 2


def test_confidence_mapping_viirs():
    assert harmonize_confidence("VIIRS", "l")[1] == 0
    assert harmonize_confidence("VIIRS", "n")[1] == 1
    assert harmonize_confidence("VIIRS", "h")[1] == 2


def test_acq_time_parsing():
    assert parse_acq_datetime("2025-03-10", 530).strftime("%H:%M") == "05:30"
    assert parse_acq_datetime("2025-03-10", 45).strftime("%H:%M") == "00:45"
    assert parse_acq_datetime("2025-03-10", "0530").strftime("%H:%M") == "05:30"
    assert parse_acq_datetime("2025-03-10", 0).strftime("%H:%M") == "00:00"
    assert parse_acq_datetime("2025-03-10", 1935).strftime("%H:%M") == "19:35"


# ---------- ingestion ----------
def test_ingest_csv_fixtures():
    recs = ingestion.load_csv_bytes(MODIS_CSV.encode())
    recs += ingestion.load_csv_bytes(VIIRS_CSV.encode())
    assert len(recs) == 5
    sensors = sorted(r["sensor"] for r in recs)
    assert sensors == ["MODIS", "VIIRS", "VIIRS", "VIIRS", "VIIRS"]
    modis = [r for r in recs if r["sensor"] == "MODIS"][0]
    assert modis["confidence_harmonized"] == 2  # 85% -> high
    assert json.loads(modis["raw_json"])["brightness"] == "310.5"


def test_ingest_geojson_fixture():
    recs = ingestion.load_geojson_bytes(GEOJSON.encode())
    assert len(recs) == 2
    viirs = [r for r in recs if r["sensor"] == "VIIRS"][0]
    assert viirs["latitude"] == 21.0 and viirs["longitude"] == 81.0
    assert viirs["confidence_harmonized"] == 2  # 'h' -> high
    modis = [r for r in recs if r["sensor"] == "MODIS"][0]
    assert modis["confidence_harmonized"] == 1  # 42% -> nominal
    assert modis["observed_at"] == "2025-03-10T05:30:00Z"


def test_detect_sensor_archive_download_shape():
    # Regression test from a real FIRMS Archive Download file (request
    # 846644): its VIIRS rows carry instrument='SNPP', satellite='SNPP' and
    # MODIS-style brightness/bright_t31 columns — no bright_ti4 anywhere.
    # These rows were initially misclassified as MODIS.
    from app.services.harmonizer import detect_sensor
    assert detect_sensor({"instrument": "SNPP", "satellite": "SNPP",
                          "brightness": "305.0", "bright_t31": "290.0"}) \
        == "VIIRS"
    assert detect_sensor({"instrument": "MODIS", "satellite": "Terra"}) \
        == "MODIS"
    assert detect_sensor({"instrument": "VIIRS", "satellite": "N"}) \
        == "VIIRS"
    assert detect_sensor({"satellite": "Aqua"}) == "MODIS"


# ---------- matcher ----------
def test_haversine_known_distance():
    # 1 degree of latitude is ~111.19 km
    assert abs(haversine_km(21.0, 81.0, 22.0, 81.0) - 111.19) < 0.5


def _load_fixtures_into_db():
    conn = get_conn()
    recs = ingestion.load_csv_bytes(MODIS_CSV.encode())
    recs += ingestion.load_csv_bytes(VIIRS_CSV.encode())
    ingestion.insert_observations(conn, recs)
    return conn


def test_matcher_window():
    conn = _load_fixtures_into_db()
    # The single MODIS point is within 1.5 km / 3 h of all three clustered
    # VIIRS points (a 1 km MODIS pixel overlapping several 375 m VIIRS
    # pixels), so exactly 3 candidate links are correct. The far-away
    # VIIRS point gets none.
    assert find_links(conn) == 3
    for row in conn.execute("SELECT * FROM links"):
        assert row["distance_km"] <= 1.5
        assert row["time_diff_min"] == 30.0


# ---------- clustering ----------
def test_dbscan_known_cluster_and_noise():
    conn = _load_fixtures_into_db()
    result = run_clustering(conn)
    assert result["clusters"] == 1
    assert result["isolated"] == 1
    row = conn.execute("SELECT * FROM clusters").fetchone()
    # MODIS point is within eps of two VIIRS points, so cluster is mixed
    assert row["n_obs"] == 4
    assert row["mixed_sensor"] == 1
    assert row["cluster_id"].startswith("20250310-")


# ---------- anomaly explanations ----------
def test_anomaly_explanation_text():
    import numpy as np
    distributions = {
        "obs_count": np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float),
        "mean_frp": np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float),
        "max_frp": np.array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], dtype=float),
        "viirs_share": np.linspace(0, 1, 11),
        "night_share": np.linspace(0, 1, 11),
    }
    cell = {"obs_count": 10, "mean_frp": 5.0, "max_frp": 5.0,
            "viirs_share": 0.5, "night_share": 0.5}
    text = build_explanation(cell, distributions)
    assert "observation count 10 is in the 100th percentile" in text
    assert "not a confirmed fire" in text
    assert "not a prediction" in text


# ---------- API ----------
def test_health_empty_db():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_empty_db_endpoints_do_not_500():
    assert client.get("/api/stats").json()["total_observations"] == 0
    assert client.get("/api/calendar").json() == {"days": []}
    assert client.get("/api/clusters").json() == {"clusters": []}
    assert client.get("/api/anomalies").json()["anomalies"] == []
    assert client.get("/api/insights").json() == {"insights": []}
    assert client.get("/api/observations").json()["count"] == 0


def test_ingest_sample_flow_with_fixtures(tmp_path, monkeypatch):
    (tmp_path / "modis.csv").write_text(MODIS_CSV)
    (tmp_path / "viirs.csv").write_text(VIIRS_CSV)
    (tmp_path / "DATA_PROVENANCE.txt").write_text("test fixture data")
    monkeypatch.setattr(api_module, "SAMPLES_DIR", tmp_path)
    r = client.post("/api/ingest/sample")
    assert r.status_code == 200
    body = r.json()
    assert body["ingested"] == 5
    assert body["links"] == 3
    assert body["clusters"] == 1
    s = client.get("/api/stats").json()
    assert s["total_observations"] == 5 and s["modis"] == 1 and s["viirs"] == 4
    assert s["mixed_sensor_clusters"] == 1
    assert s["provenance"] == "test fixture data"
    cal = client.get("/api/calendar").json()["days"]
    assert cal == [{"date": "2025-03-10", "total": 5, "modis": 1, "viirs": 4}]
    ins = client.get("/api/insights").json()["insights"]
    assert any("5 harmonized" in i for i in ins)


def test_ingest_two_files_append_flow():
    # Regression test: a MODIS file and a VIIRS file uploaded one after
    # another (the real FIRMS Archive Download flow) must COMBINE when the
    # second upload uses ?append=true — not silently replace the first.
    r1 = client.post("/api/ingest/file",
                     files={"file": ("modis.csv", MODIS_CSV.encode(),
                                     "text/csv")})
    assert r1.status_code == 200 and r1.json()["ingested"] == 1
    r2 = client.post("/api/ingest/file?append=true",
                     files={"file": ("viirs.csv", VIIRS_CSV.encode(),
                                     "text/csv")})
    assert r2.status_code == 200 and r2.json()["ingested"] == 4
    s = client.get("/api/stats").json()
    assert s["total_observations"] == 5
    assert s["modis"] == 1 and s["viirs"] == 4
    assert s["candidate_links"] == 3 and s["mixed_sensor_clusters"] == 1
    # Default (no append) still replaces, as documented.
    r3 = client.post("/api/ingest/file",
                     files={"file": ("modis.csv", MODIS_CSV.encode(),
                                     "text/csv")})
    assert r3.status_code == 200
    assert client.get("/api/stats").json()["total_observations"] == 1


def test_ingest_geojson_upload():
    r = client.post("/api/ingest/file",
                    files={"file": ("fires.json", GEOJSON.encode(),
                                    "application/json")})
    assert r.status_code == 200 and r.json()["ingested"] == 2
    obs = client.get("/api/observations").json()["observations"]
    assert len(obs) == 2
    detail = client.get(f"/api/observations/{obs[0]['id']}").json()
    assert "original" in detail and "unified" in detail


def _ingest_both_fixtures(tmp_path, monkeypatch):
    (tmp_path / "modis.csv").write_text(MODIS_CSV)
    (tmp_path / "viirs.csv").write_text(VIIRS_CSV)
    (tmp_path / "DATA_PROVENANCE.txt").write_text("test fixture data")
    monkeypatch.setattr(api_module, "SAMPLES_DIR", tmp_path)
    assert client.post("/api/ingest/sample").status_code == 200


def test_observations_bbox_filter(tmp_path, monkeypatch):
    # AOI filter: the fixture cluster sits near (21.0, 81.0); the far
    # VIIRS point at (24.5, 85.5) must fall outside a tight box.
    _ingest_both_fixtures(tmp_path, monkeypatch)
    box = client.get("/api/observations",
                     params={"west": 80.5, "south": 20.5,
                             "east": 81.5, "north": 21.5}).json()
    assert box["total_matching"] == 4
    allr = client.get("/api/observations").json()
    assert allr["total_matching"] == 5


def test_observations_csv_export_filters(tmp_path, monkeypatch):
    # The downloadable CSV of hotspots from a search must carry the
    # header + exactly the rows matching the filters.
    _ingest_both_fixtures(tmp_path, monkeypatch)
    r = client.get("/api/observations.csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    lines = [ln for ln in r.text.strip().splitlines() if ln]
    assert lines[0].startswith("id,sensor,satellite,latitude,longitude")
    assert len(lines) == 1 + 5
    assert any(",MODIS," in ln for ln in lines)
    r2 = client.get("/api/observations.csv",
                    params={"sensor": "VIIRS", "west": 80.5, "south": 20.5,
                            "east": 81.5, "north": 21.5})
    lines2 = [ln for ln in r2.text.strip().splitlines() if ln]
    assert len(lines2) == 1 + 3
    assert all(",VIIRS," in ln for ln in lines2[1:])
