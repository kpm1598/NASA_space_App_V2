# BLACKCAT — AI-Powered Multi-Satellite Fire Intelligence Platform

**Team BlackCat · NASA Space Apps Challenge 2026 · Dayananda Sagar University, Bengaluru**
**Challenge: "Harmonization of MODIS and VIIRS Hot Spots"**

## The challenge

> Understanding how burning activity is distributed across our planet over time,
> including wildfires and agricultural burns intense enough to be detected by
> satellite sensors, enables us to anticipate critical periods, guide monitoring
> efforts, and improve fire response. Satellites have tracked active fire
> hotspots for more than two decades, but the record is split across sensors
> whose data cannot be compared directly, leaving fire managers without a
> consistent picture of when and where burning has occurred. Your challenge is
> to build a web application that harmonizes these records into a burning
> activity calendar based on active fire hotspots, enabling early warning and
> emergency responders, scientists, and land managers to examine historical
> fire patterns, unusual conditions, and critical periods within a selected
> area of interest.

## What BLACKCAT does

BLACKCAT ingests NASA FIRMS active-fire observations from **MODIS** (Terra +
Aqua, ~1 km) and **VIIRS** (Suomi NPP, 375 m), harmonizes them into **one
unified database** (original records always preserved), and layers real
machine learning on top:

1. **Harmonization engine** — common schema, UTC datetimes, a documented
   confidence mapping, sensor differences preserved rather than hidden.
2. **Cross-sensor candidate links** — MODIS↔VIIRS observation pairs within
   1.5 km and 3 hours are linked as *candidates* for co-detection.
3. **DBSCAN clustering** — per-day haversine DBSCAN groups related
   observations into *candidate activity clusters* (906 of the 2,944 clusters
   in the bundled dataset contain both sensors).
4. **Isolation Forest anomaly detection** — on aggregated 0.25° grid-cell ×
   day features, with a plain-language percentile explanation for every flag.
5. **Burning activity calendar** + historical analysis + insights generated
   strictly from computed numbers (no generative AI, no invented statistics).

**Bundled demo data (real, not simulated):** NASA FIRMS archived observations
for a selected area of interest in the Chhattisgarh–Odisha fire belt
(lon 80.5–83.5 E, lat 20–23 N), 2025-02-01 → 2025-04-30 —
30,951 observations (MODIS 2,440 · VIIRS 28,511). See
`backend/data/samples/DATA_PROVENANCE.txt`.

## Honesty notes (read before judging the numbers)

- Satellite hotspots are **detected thermal anomalies**, not confirmed
  ground-truth wildfires.
- A DBSCAN cluster is a group of **candidate related observations**, not one
  confirmed wildfire.
- A candidate link is a **possible** co-detection, not a proven duplicate;
  both original observations are always kept.
- An anomaly is a **statistically unusual grid-cell day** in this dataset —
  not a new fire and **not a prediction**.

## Architecture

```
NASA FIRMS (MODIS + VIIRS, API / CSV / GeoJSON)
        ↓  ingestion (CSV + GeoJSON auto-detected)
Validation + Harmonization (unified schema, raw fields preserved)
        ↓
Unified SQLite database ── candidate links (1.5 km / 3 h)
        ↓
DBSCAN clusters · Isolation Forest anomalies · temporal analysis
        ↓
Templated Fire Intelligence Insights (computed numbers only)
        ↓
FastAPI REST API → React dashboard / map / calendar / reports
```

See `docs/architecture.md` and `docs/methodology.md` for details.

## Run it (Windows, exact commands)

### Backend

```powershell
cd NASA_space_App_V2\backend
py -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

API docs: http://127.0.0.1:8000/docs

### Frontend (second PowerShell window)

```powershell
cd NASA_space_App_V2\frontend
npm install
npm run dev
```

Open http://127.0.0.1:5173 — on the Dashboard, click
**"Load bundled FIRMS dataset"** to ingest the archived data and run the
full ML pipeline (takes a few seconds for ~31k observations).

On the **Fire Map** you can filter by date range and sensor, narrow to an
area of interest by entering longitude/latitude bounds, and download the
hotspot rows matching your search as a CSV ("Download matching hotspots").
The Dashboard also offers a regional summary report as CSV.

### Tests

```powershell
cd NASA_space_App_V2\backend
.venv\Scripts\activate
pip install -r requirements.txt
python -m pytest tests -q
```

(17 tests: harmonizer mappings, HHMM time parsing, matcher window, DBSCAN
fixture, anomaly explanations, CSV + GeoJSON ingestion, API flows, a
two-file upload regression test, and a sensor-detection regression test
based on the real FIRMS Archive Download file shape.
`requirements.txt` includes the test dependencies — pytest and httpx — so a
fresh install can run this suite directly. Verified 2026-11-14: **17 passed**.)

## Using your own FIRMS download (e.g. the FIRMS Archive Download .json)

1. Copy your downloaded files (`.csv` or `.json`/GeoJSON both work) into
   `backend\data\samples\`.
2. Restart the backend, then click **Load bundled FIRMS dataset**, or call
   `POST /api/ingest/sample`. Files can also be uploaded directly via
   `POST /api/ingest/file` — note that a plain upload *replaces* the current
   dataset, so when uploading a MODIS file and a VIIRS file one after
   another, add `?append=true` to the second (and any later) upload to
   combine them. The samples-folder route above loads all files together
   and needs no such care.
3. Update `backend\data\samples\DATA_PROVENANCE.txt` so the UI labels your
   data honestly (source, area, dates).

## Optional: live FIRMS API (MAP_KEY)

1. Get a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/
2. Copy `backend\.env.example` to `backend\.env` and set `FIRMS_MAP_KEY=...`
3. The key is read **only** by the backend from the environment, is never
   logged, never committed (`.env` is git-ignored) and never used by the
   frontend. Without a key the app runs fully on local data.

## Project structure

```
NASA_space_App_V2/
  backend/   FastAPI + pandas + scikit-learn, SQLite via stdlib sqlite3
    app/     main.py, routes/, services/, models/
    data/samples/   bundled archived FIRMS data + provenance note
    tests/   pytest suite
  frontend/  React + Vite + Tailwind + React Leaflet + Recharts
  docs/      architecture.md, methodology.md
```
