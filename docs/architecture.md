# BLACKCAT Architecture

## Components

| Layer | Technology | Responsibility |
|---|---|---|
| Frontend | React + Vite + Tailwind CSS, React Leaflet, Recharts | Dashboard, fire map, burning activity calendar, harmonization view, intelligence center |
| API | FastAPI (Python) | REST endpoints under `/api/*`, CSV report export |
| Processing | pandas, NumPy, scikit-learn | Harmonization, haversine matching, DBSCAN, Isolation Forest |
| Storage | SQLite (Python stdlib `sqlite3`) | Unified observations, candidate links, clusters, anomalies, provenance meta |
| Data | NASA FIRMS | MODIS C6.1 + VIIRS S-NPP active-fire observations (archive CSV/GeoJSON, optional live API) |

## Data flow

1. **Ingestion** (`services/ingestion.py`) reads FIRMS CSV files or FIRMS
   GeoJSON downloads (auto-detected) — the FIRMS Archive Download tool's
   `.json` output and the open per-country archive CSVs are both supported.
2. **Harmonization** (`services/harmonizer.py`) converts each raw record to
   the unified schema and stores the complete original record in `raw_json`.
   No original observation is ever discarded or overwritten.
3. **Candidate matching** (`services/event_matcher.py`) links MODIS↔VIIRS
   pairs within 1.5 km and 3 hours into the `links` table.
4. **Clustering** (`services/clustering.py`) runs haversine DBSCAN per UTC
   day; results are stored back on each observation and in `clusters`.
5. **Anomaly detection** (`services/anomaly.py`) aggregates observations to
   0.25° grid-cell × day features and flags unusual cell-days with an
   Isolation Forest; a percentile-based explanation is stored per flag.
6. **Insights** (`services/insights.py`) renders templated sentences strictly
   from SQL-computed statistics.
7. The frontend reads everything through the REST API; the API base URL is
   configurable via `VITE_API_BASE` (default `http://localhost:8000`).

## API endpoints

- `GET /api/health`
- `POST /api/ingest/sample` — ingest everything in `backend/data/samples/` and run the ML pipeline
- `POST /api/ingest/file` — upload one CSV/GeoJSON file and run the ML pipeline
- `GET /api/stats` — totals, per-sensor counts, cluster/link/anomaly counts, date range, provenance
- `GET /api/observations` — bbox/date/sensor filters, capped at 5,000 returned points (response says when capped)
- `GET /api/observations/{id}` — unified record + preserved original fields + its candidate links
- `GET /api/harmonization` — per-sensor median FRP and confidence distributions, link and mixed-cluster counts
- `GET /api/calendar` — daily counts overall and per sensor
- `GET /api/clusters`, `GET /api/anomalies`, `GET /api/insights`
- `GET /api/report.csv` — downloadable regional summary

## Security / configuration

- `FIRMS_MAP_KEY` is read only from the backend environment (`.env`, see
  `backend/.env.example`); request URLs containing the key are never logged;
  live-fetch responses are cached under `backend/data/cache/`.
- Without a key, live fetching reports itself unavailable and the app runs
  entirely on locally ingested data.
- Ingestion replaces the working dataset (observations/links/clusters/
  anomalies are rebuilt), so every number in the UI always describes exactly
  one dataset; its provenance label is shown on the Dashboard.
