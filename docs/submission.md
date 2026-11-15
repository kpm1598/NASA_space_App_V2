# Team BlackCat — NASA Space Apps Project Submission Page Content

*Ready-to-paste content for the official Project Submission page. All fields in English.*

---

## (a) Project Name

**MODIS–VIIRS Hotspot Harmonization Platform**

Team: BlackCat — Dayananda Sagar University, Bengaluru
Challenge: **Harmonization of MODIS and VIIRS Hot Spots**

---

## (b) High-Level Project Summary

Our project, built by Team BlackCat, is a web application that harmonizes active-fire hotspot records from two NASA satellite sensors — MODIS and VIIRS — into one unified, analyzable record of burning activity. The two sensors differ in spatial resolution, confidence reporting, and overpass times, so their data cannot be compared directly. Our platform ingests NASA FIRMS observations from both sensors, preserves every original record, and maps them into a common schema. It then links candidate cross-sensor detections of the same burning, groups related observations into candidate clusters with DBSCAN, flags statistically unusual activity with Isolation Forest, and presents the result as an interactive burning activity calendar, fire map, and intelligence dashboard. By turning fragmented sensor records into a consistent historical picture, the platform helps early warning and emergency responders, scientists, land managers, and firefighters examine fire patterns, unusual conditions, and critical periods within a selected area of interest.

---

## (c) Detailed Project Description

### What it does

The platform takes active-fire hotspot observations recorded by two different NASA satellite instruments — MODIS (aboard Terra and Aqua) and VIIRS (aboard Suomi NPP) — and harmonizes them into a single, consistent burning activity picture. Instead of being just another map of raw hotspots, its core is an intelligence pipeline that finds relationships between the two sensors' records, groups related observations, and identifies statistically unusual burning activity, all presented through a burning activity calendar, an interactive fire map, and an intelligence dashboard.

### How it works

1. **Ingestion** — NASA FIRMS observations are loaded from archive files (CSV or GeoJSON) or, by design, from the FIRMS area API. Every original record and its sensor-specific fields are preserved.
2. **Validation and harmonization** — Records are normalized into one unified schema: latitude/longitude, UTC observation datetime, sensor, satellite, fire radiative power (FRP), day/night flag, and a documented harmonized confidence scale that maps MODIS percentage confidence and VIIRS low/nominal/high categories onto a common ordinal scale without hiding the original values or the sensors' differences.
3. **Cross-sensor candidate matching** — A MODIS and a VIIRS observation within 1.5 km and 3 hours of each other are recorded as a *candidate link*: a possible co-detection of the same burning. Both original observations are always kept; nothing is merged away or deleted.
4. **DBSCAN clustering** — Observations are grouped per UTC day using DBSCAN with a haversine distance metric (eps 2.5 km, min_samples 3), producing candidate activity clusters. Clusters that contain observations from both sensors are highlighted — they are the strongest evidence that the harmonization is working.
5. **Isolation Forest anomaly detection** — Observations are aggregated to 0.25° grid cells per day (observation count, mean and maximum FRP, VIIRS share, night share). An Isolation Forest model flags statistically unusual grid-days, and every flag carries a plain-language, percentile-based explanation (for example, "observation count is in the 99th percentile for this dataset").
6. **Burning activity calendar and insights** — Daily, per-sensor activity is shown as a calendar heatmap and charts, and a set of insights is generated from the computed results only — totals, mixed-sensor cluster counts, peak activity day, and unusual periods.
7. **Area selection and export** — On the fire map, users filter by date range, sensor, and a latitude/longitude area of interest, and can download the hotspot rows matching their search as a CSV file (in addition to a regional summary report).

### Demonstrated results (bundled demo dataset)

Our submitted demo runs on **real archived NASA FIRMS data** — not simulated data — for a selected area of interest in the Chhattisgarh–Odisha fire belt, India (longitude 80.5–83.5 E, latitude 20–23 N), covering 2025-02-01 to 2025-04-30:

- 30,951 harmonized observations (MODIS 2,440 · VIIRS S-NPP 28,511)
- 3,262 cross-sensor candidate links
- 2,944 candidate clusters, of which **906 contain observations from both sensors**
- 301 anomalous grid-days flagged with explanations
- Peak activity day: 2025-03-06, with 2,061 observations

### Benefits and what we hope to achieve

Fire managers today must work with fragmented records that cannot be compared directly across sensors. Our platform gives early warning and emergency responders, scientists, land managers, and firefighters one consistent historical record for a selected area of interest, so they can examine historical fire patterns, unusual conditions, and critical periods — for example, spotting the days and places where burning activity was statistically exceptional during a fire season. This matters now because MODIS, aboard Terra and Aqua, is approaching the end of its operational life after more than two decades of observations, while VIIRS provides the continuing record at finer spatial resolution — a harmonized series is the only way the long MODIS archive and the VIIRS era can be read as one consistent history. We hope to show that scientifically careful multi-sensor harmonization, combined with transparent machine learning, can turn two incompatible satellite archives into a single trustworthy picture of burning activity, and that this approach can be extended to more regions, more seasons, and live data.

### Tools, languages and software used

- **Frontend:** React, Vite, Tailwind CSS, React Leaflet (Leaflet / OpenStreetMap), Recharts
- **Backend:** Python, FastAPI, pandas, NumPy, scikit-learn (DBSCAN, Isolation Forest)
- **Database:** SQLite
- **Data formats:** CSV, GeoJSON
- **Development:** Git/GitHub, VS Code, pytest automated tests (17 backend tests)

### Scientific honesty — the limits we state openly

- Satellite hotspots are **detected thermal anomalies**, not confirmed ground-truth wildfires.
- A DBSCAN cluster is a group of **candidate related observations**, not one confirmed wildfire, and a candidate link is a *possible* co-detection, not a proven duplicate.
- An anomaly is a **statistically unusual grid-cell day within this dataset** — it is not a new fire and **not a prediction** of future fires.
- MODIS and VIIRS have different spatial resolutions and sensor characteristics; we preserve and surface those differences rather than pretending the datasets are identical.

---

## (d) NASA Data

- **NASA FIRMS (Fire Information for Resource Management System) active fire data** — our primary and only fire data source:
  - **MODIS Collection 6.1** active fire observations (Terra + Aqua, ~1 km)
  - **VIIRS S-NPP 375 m** active fire observations (Collection 2)
  - Accessed via the **FIRMS Archive Download** service (historical observations: India, 2025-02-01 to 2025-04-30) and, in the application's design, the **FIRMS area API** for recent-data queries, using the team's FIRMS MAP_KEY held in backend environment variables only.
  - Resources: FIRMS map and data portal (https://firms.modaps.eosdis.nasa.gov/map/), FIRMS area API documentation (https://firms.modaps.eosdis.nasa.gov/api/area/), FIRMS data availability (https://firms.modaps.eosdis.nasa.gov/api/data_availability/)

---

## (e) Space Agency Partner Data and Other References

No additional space agency partner datasets were used. The following open tools, libraries and data services were used and are gratefully acknowledged:

- **OpenStreetMap** — basemap tiles for the interactive fire map (© OpenStreetMap contributors)
- **Leaflet / React Leaflet** — interactive mapping
- **React, Vite, Tailwind CSS, Recharts** — frontend framework, build tooling, styling and charts
- **FastAPI, pandas, NumPy, scikit-learn** — backend API, data processing and machine learning (DBSCAN, Isolation Forest)

---

## (f) Use of Super Intelligence (SI) — Disclosure

Our team used AI (Super Intelligence) tools during this project, and we disclose that use here as required:

- We used **AI coding assistants — GitHub Copilot in VS Code, and an AI assistant for planning, code generation and code review** — to accelerate development of the application code within our 36-hour build window.
- The machine-learning methods inside the product itself are **classical algorithms — DBSCAN clustering and Isolation Forest anomaly detection (scikit-learn) — run on real NASA FIRMS data**. No generative AI produces any data, statistic or insight in the application; every insight sentence is generated from computed numbers.
- **No NASA logos, branding or insignia were generated or used** in our project, deck or application.
- All AI-assisted code was **tested and verified by our team**: an automated test suite of **17 backend tests** (harmonization mappings, candidate matching, clustering, anomaly explanations, ingestion of both CSV and GeoJSON, area-of-interest filtering, hotspot CSV export, and API behaviour) passes, and the full pipeline was verified against real archived FIRMS data, producing the results reported above (30,951 observations, 906 mixed-sensor clusters, and the 2025-03-06 peak day).

---

## (g) Links

- **Final Project Link:** https://github.com/kpm1598/NASA_space_App_V2
- **Project Demo Link:** https://docs.google.com/presentation/d/1C7sBOhTQmYf1cS_nGXWj2aMbLoAfEn9v/edit?usp=sharing&ouid=102769715929841328697&rtpof=true&sd=true
  *(Verified 2026-11-15: opens publicly, view-only, no sign-in required. Deck: 7 slides.)*

---

## (h) Pre-Submit Checklist

- [ ] Every field on the Project page is filled in **English**
- [ ] Project Demo is a **maximum of 7 slides including the title slide** (or a video of 30 seconds or less) — our deck has exactly 7
- [ ] Final Project link and Demo link are **public and tested in a private/incognito window** (no login required to open them)
- [ ] NASA Data section lists at least one NASA resource (FIRMS MODIS + VIIRS)
- [ ] Use of SI disclosure is included, and AI use is acknowledged in the project text/metadata
- [ ] All **team members are confirmed at the same Local Event**
- [ ] **Submit for Judging before Sunday, November 15, 11:59 pm local event time** (only the last saved submission is judged — resubmission is allowed until the deadline)
