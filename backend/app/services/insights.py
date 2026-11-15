"""Fire Intelligence Insights: templated sentences generated STRICTLY from
computed statistics. No number appears in an insight unless it was computed
from the database in this module. No generative AI is used.
"""


def generate_insights(conn):
    total = conn.execute("SELECT COUNT(*) c FROM observations").fetchone()["c"]
    if total == 0:
        return []
    insights = []
    per_sensor = {r["sensor"]: r["c"] for r in conn.execute(
        "SELECT sensor, COUNT(*) c FROM observations GROUP BY sensor")}
    rng = conn.execute(
        "SELECT MIN(obs_date) a, MAX(obs_date) b FROM observations").fetchone()
    insights.append(
        f"The dataset contains {total} harmonized satellite hotspot "
        f"observations from {rng['a']} to {rng['b']}: "
        f"{per_sensor.get('MODIS', 0)} from MODIS and "
        f"{per_sensor.get('VIIRS', 0)} from VIIRS. Hotspots are detected "
        f"thermal anomalies, not confirmed ground-truth wildfires.")

    links = conn.execute("SELECT COUNT(*) c FROM links").fetchone()["c"]
    insights.append(
        f"Cross-sensor harmonization produced {links} candidate links "
        f"between MODIS and VIIRS observations (within 1.5 km and 3 hours). "
        f"Candidate links indicate possible co-detection of related burning; "
        f"both original observations are preserved.")

    cl = conn.execute(
        "SELECT COUNT(*) c, COALESCE(SUM(mixed_sensor),0) m FROM clusters"
    ).fetchone()
    if cl["c"]:
        insights.append(
            f"DBSCAN identified {cl['c']} candidate activity clusters, of "
            f"which {cl['m']} contain observations from both MODIS and "
            f"VIIRS. A cluster is a group of candidate related observations, "
            f"not one confirmed wildfire.")

    peak = conn.execute(
        "SELECT obs_date, COUNT(*) c FROM observations GROUP BY obs_date "
        "ORDER BY c DESC LIMIT 1").fetchone()
    insights.append(
        f"Peak burning-activity day in the selected period was "
        f"{peak['obs_date']} with {peak['c']} observations.")

    # Baseline comparison: last 7 dataset days vs the prior period's mean
    dates = [r["obs_date"] for r in conn.execute(
        "SELECT DISTINCT obs_date FROM observations ORDER BY obs_date")]
    if len(dates) > 7:
        recent_dates = dates[-7:]
        prior_dates = dates[:-7]
        q = ("SELECT COUNT(*) c FROM observations WHERE obs_date IN "
             f"({','.join('?' * len(recent_dates))})")
        recent_total = conn.execute(q, recent_dates).fetchone()["c"]
        q2 = ("SELECT COUNT(*) c FROM observations WHERE obs_date IN "
              f"({','.join('?' * len(prior_dates))})")
        prior_total = conn.execute(q2, prior_dates).fetchone()["c"]
        recent_mean = recent_total / len(recent_dates)
        prior_mean = prior_total / len(prior_dates)
        if prior_mean > 0:
            change = (recent_mean - prior_mean) / prior_mean * 100.0
            direction = "higher" if change >= 0 else "lower"
            insights.append(
                f"Mean daily observations in the final 7 days of the dataset "
                f"({recent_mean:.1f}/day) were {abs(change):.1f}% {direction} "
                f"than the preceding period mean ({prior_mean:.1f}/day).")

    anomalies = conn.execute(
        "SELECT obs_date, obs_count, explanation FROM anomalies "
        "ORDER BY obs_count DESC LIMIT 3").fetchall()
    for a in anomalies:
        insights.append(
            f"Unusual activity flagged on {a['obs_date']} in one grid cell "
            f"with {a['obs_count']} observations. {a['explanation']}")
    return insights
