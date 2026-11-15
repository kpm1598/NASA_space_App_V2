"""DBSCAN candidate clustering, run per UTC day.

Coordinates are converted to radians and DBSCAN uses the haversine metric
with eps = 2.5 km / 6371.0088 rad, min_samples = 3. Clusters are groups of
candidate related observations - they are NOT confirmed wildfires.
Points labelled -1 by DBSCAN are stored with cluster_id NULL and counted
as isolated observations.
"""
import numpy as np
from sklearn.cluster import DBSCAN

EARTH_R_KM = 6371.0088
EPS_KM = 2.5
MIN_SAMPLES = 3


def run_clustering(conn) -> dict:
    conn.execute("DELETE FROM clusters")
    conn.execute("UPDATE observations SET cluster_id = NULL")
    dates = [r["obs_date"] for r in conn.execute(
        "SELECT DISTINCT obs_date FROM observations ORDER BY obs_date")]
    total_clusters = 0
    isolated = 0
    for date in dates:
        rows = conn.execute(
            "SELECT id, latitude, longitude, sensor, frp FROM observations "
            "WHERE obs_date = ?", (date,)).fetchall()
        if len(rows) < MIN_SAMPLES:
            isolated += len(rows)
            continue
        coords = np.radians([[r["latitude"], r["longitude"]] for r in rows])
        labels = DBSCAN(
            eps=EPS_KM / EARTH_R_KM, min_samples=MIN_SAMPLES,
            metric="haversine").fit_predict(coords)
        groups = {}
        for r, lab in zip(rows, labels):
            if lab == -1:
                isolated += 1
            else:
                groups.setdefault(int(lab), []).append(r)
        for i, (lab, members) in enumerate(sorted(groups.items()), start=1):
            cid = f"{date.replace('-', '')}-{i:03d}"
            frps = [m["frp"] for m in members if m["frp"] is not None]
            n_modis = sum(1 for m in members if m["sensor"] == "MODIS")
            n_viirs = sum(1 for m in members if m["sensor"] == "VIIRS")
            conn.execute(
                "INSERT INTO clusters(cluster_id, obs_date, n_obs, n_modis, "
                "n_viirs, mixed_sensor, centroid_lat, centroid_lon, max_frp, "
                "mean_frp) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (cid, date, len(members), n_modis, n_viirs,
                 1 if (n_modis > 0 and n_viirs > 0) else 0,
                 float(np.mean([m["latitude"] for m in members])),
                 float(np.mean([m["longitude"] for m in members])),
                 max(frps) if frps else None,
                 float(np.mean(frps)) if frps else None))
            conn.executemany(
                "UPDATE observations SET cluster_id = ? WHERE id = ?",
                [(cid, m["id"]) for m in members])
            total_clusters += 1
    conn.commit()
    return {"clusters": total_clusters, "isolated": isolated}
