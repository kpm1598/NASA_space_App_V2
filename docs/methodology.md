# BLACKCAT Methodology

## Unified observation schema

Each observation stores: latitude, longitude, `observed_at` (UTC), sensor
(MODIS/VIIRS), satellite, `confidence_raw` (as delivered), 
`confidence_harmonized` (ordinal, below), FRP (MW), brightness and background
brightness (MODIS `brightness`/`bright_t31`, VIIRS `bright_ti4`/`bright_ti5`),
day/night flag, its cluster id, and `raw_json` — the complete original FIRMS
record. Harmonization adds a common structure; it never deletes information.

**Time parsing:** FIRMS gives `acq_date` plus `acq_time` as an HHMM integer
in UTC (`530` = 05:30, `45` = 00:45). BLACKCAT parses this explicitly —
treating it as a decimal hour or a duration would silently corrupt times.

## Confidence harmonization

MODIS and VIIRS confidence are not the same quantity, so they are mapped to a
shared **ordinal** scale (ordering only — a harmonized "nominal" MODIS
observation is not claimed to be numerically equal to a VIIRS "nominal"):

| Harmonized | Meaning | MODIS (percent) | VIIRS (category) |
|---|---|---|---|
| 0 | low | 0–29 | `l` |
| 1 | nominal | 30–79 | `n` |
| 2 | high | 80–100 | `h` |

The raw value is always kept alongside (`confidence_raw`).

## Cross-sensor candidate matching

A candidate link requires **haversine distance ≤ 1.5 km** and
**|Δtime| ≤ 3 hours** between a MODIS and a VIIRS observation.

- *Distance:* a MODIS pixel is ~1 km; two detections of the same burning area
  can legitimately be offset by roughly a pixel width plus geolocation error.
  1.5 km is a conservative envelope around that.
- *Time:* Terra/Aqua and Suomi NPP overpasses can be a few hours apart while
  the same fire is still burning; 3 hours covers the realistic overpass gaps
  without linking unrelated morning/evening activity.
- Links are **candidates**. Both observations stay in the database; nothing
  is deduplicated away.

## DBSCAN clustering

- Run **per UTC day** (time enters by day-binning; a multi-day fire appears
  as a chain of daily clusters, which the calendar view makes visible).
- Coordinates in radians, **haversine metric**, **eps = 2.5 km**
  (2.5 / 6371.0088 rad), **min_samples = 3**.
- *Justification:* 2.5 km joins detections along a fire front (adjacent
  375 m–1 km pixels and small gaps) without merging separate villages'
  agricultural burns several km apart; min_samples 3 requires a genuine
  group, so isolated single pixels remain "isolated observations" (DBSCAN
  noise, stored as no cluster).
- A cluster is a **candidate** group of related observations — never
  presented as one confirmed wildfire. Clusters containing both sensors are
  reported separately ("mixed-sensor clusters") as harmonization evidence.

## Isolation Forest anomaly detection

- Features are computed per **0.25° grid cell × UTC day**: observation count,
  mean FRP, max FRP, VIIRS share, night share.
- Features are standardized; `IsolationForest(contamination=0.05,
  random_state=42)` flags the ~5% most unusual cell-days *relative to this
  dataset's own distribution*.
- **Explanations:** for each flagged cell-day, every feature is compared with
  its percentile across all cell-days; features at/above the 90th (or at/below
  the 10th) percentile are named in plain language, e.g. "observation count
  184 is in the 100th percentile of all grid-cell days in this dataset".
- An anomaly means "statistically unusual burning-activity pattern here" —
  it is **not** a confirmed fire, not a new fire, and **not a prediction**.

## Historical / temporal analysis

Daily counts (overall and per sensor) drive the burning activity calendar.
Insights compare the final 7 dataset days' mean daily count against the
preceding period's mean — a baseline comparison computed from the loaded
data, labelled with its exact numbers.

## Limitations (stated honestly)

- The bundled dataset is one area of interest and one fire season
  (Feb–Apr 2025); seasonal claims beyond that window would need more data.
- VIIRS detects far more small thermal anomalies than MODIS (375 m vs ~1 km);
  raw count comparisons between sensors reflect instrument sensitivity, and
  BLACKCAT's per-sensor views keep this visible instead of hiding it.
- FRP values from different sensors are not perfectly comparable; medians are
  reported per sensor, never blended into a single "true" value.
- DBSCAN day-binning cannot follow a single fire across midnight boundaries;
  clusters are per-day candidates by design.
- No ground-truth fire perimeter data is used, so no accuracy/precision
  claims are made for clusters, links, or anomalies.
