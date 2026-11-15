"""Cross-sensor candidate matching.

A candidate link is created between a MODIS observation and a VIIRS
observation when they are within 1.5 km (haversine) AND within 3 hours.
Links are CANDIDATES for co-detection of related burning - they are not
confirmed duplicates, and both original observations are always kept.
The 1.5 km window reflects MODIS's ~1 km pixel footprint (see methodology).
"""
from datetime import datetime, timezone

import numpy as np

EARTH_R_KM = 6371.0088
MAX_DIST_KM = 1.5
MAX_TIME_MIN = 180.0


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = np.radians(lat2 - lat1)
    dl = np.radians(lon2 - lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _ts(iso: str) -> float:
    return datetime.strptime(iso, "%Y-%m-%dT%H:%M:%SZ").replace(
        tzinfo=timezone.utc).timestamp()


def find_links(conn) -> int:
    """Compute and store candidate links. Returns count inserted."""
    conn.execute("DELETE FROM links")
    rows = conn.execute(
        "SELECT id, latitude, longitude, observed_at, sensor FROM observations"
    ).fetchall()
    modis = [r for r in rows if r["sensor"] == "MODIS"]
    viirs = [r for r in rows if r["sensor"] == "VIIRS"]
    if not modis or not viirs:
        conn.commit()
        return 0
    v_lat = np.array([r["latitude"] for r in viirs])
    v_lon = np.array([r["longitude"] for r in viirs])
    v_ts = np.array([_ts(r["observed_at"]) for r in viirs])
    links = []
    # ~0.02 deg box is a safe pre-filter for 1.5 km at Indian latitudes
    for m in modis:
        cand = np.where(
            (np.abs(v_lat - m["latitude"]) < 0.03)
            & (np.abs(v_lon - m["longitude"]) < 0.03)
        )[0]
        if len(cand) == 0:
            continue
        m_ts = _ts(m["observed_at"])
        dists = haversine_km(m["latitude"], m["longitude"],
                             v_lat[cand], v_lon[cand])
        for j, d in zip(cand, dists):
            dt_min = abs(m_ts - v_ts[j]) / 60.0
            if d <= MAX_DIST_KM and dt_min <= MAX_TIME_MIN:
                links.append((m["id"], viirs[j]["id"], float(d), float(dt_min)))
    conn.executemany(
        "INSERT INTO links(obs_id_a, obs_id_b, distance_km, time_diff_min) "
        "VALUES (?,?,?,?)", links)
    conn.commit()
    return len(links)
