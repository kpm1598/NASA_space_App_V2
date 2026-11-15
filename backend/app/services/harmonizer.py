"""Harmonization: convert raw MODIS / VIIRS FIRMS records into the unified
observation schema while preserving every original field in raw_json.

Documented mappings (see docs/methodology.md):
  Confidence harmonization to an ordinal scale 0=low, 1=nominal, 2=high:
    MODIS (numeric percent): 0-29 -> 0, 30-79 -> 1, 80-100 -> 2
    VIIRS (categorical):     'l' -> 0, 'n' -> 1, 'h' -> 2
  Time: FIRMS acq_time is an HHMM integer (e.g. 530 means 05:30 UTC,
        45 means 00:45 UTC). Combined with acq_date to form observed_at (UTC).
"""
import json
from datetime import datetime, timezone


def parse_acq_datetime(acq_date, acq_time) -> datetime:
    """Build a UTC datetime from FIRMS acq_date ('YYYY-MM-DD') and acq_time (HHMM)."""
    if acq_time is None or (isinstance(acq_time, str) and acq_time.strip() == ""):
        t_int = 0
    elif isinstance(acq_time, float):  # pandas may hand us 530.0
        t_int = int(acq_time)
    elif isinstance(acq_time, int):
        t_int = acq_time
    else:
        s = str(acq_time).strip()
        # Accept 'HH:MM' too
        if ":" in s:
            hh, mm = s.split(":", 1)
            return datetime(
                int(str(acq_date)[:4]), int(str(acq_date)[5:7]), int(str(acq_date)[8:10]),
                int(hh), int(mm), tzinfo=timezone.utc,
            )
        t_int = int(float(s))
    hh, mm = t_int // 100, t_int % 100
    d = str(acq_date)[:10]
    return datetime(
        int(d[:4]), int(d[5:7]), int(d[8:10]), hh, mm, tzinfo=timezone.utc
    )


def harmonize_confidence(sensor: str, raw):
    """Return (confidence_raw_str, confidence_harmonized 0/1/2 or None)."""
    if raw is None:
        return None, None
    raw_str = str(raw).strip()
    if sensor == "MODIS":
        try:
            pct = float(raw_str)
        except ValueError:
            return raw_str, None
        if pct < 30:
            return raw_str, 0
        if pct < 80:
            return raw_str, 1
        return raw_str, 2
    # VIIRS categorical
    m = {"l": 0, "n": 1, "h": 2}
    return raw_str, m.get(raw_str.lower()[:1])


def detect_sensor(row: dict) -> str:
    """Identify the sensor from whichever FIRMS fields are present.

    FIRMS products do not label rows uniformly: the near-real-time CSVs use
    instrument='VIIRS' with bright_ti4/bright_ti5 columns, while the FIRMS
    Archive Download VIIRS files use instrument='SNPP', satellite='SNPP'
    and MODIS-style brightness/bright_t31 columns. Relying on any single
    field misclassifies one of these real products, so check them all.
    """
    inst = str(row.get("instrument", "")).strip().upper()
    if inst == "VIIRS":
        return "VIIRS"
    if inst == "MODIS":
        return "MODIS"
    sat = str(row.get("satellite", "")).strip().upper()
    if sat in ("SNPP", "SUOMI NPP", "SUOMI-NPP", "N", "NOAA-20", "NOAA20",
               "N20", "NOAA-21", "NOAA21", "N21"):
        return "VIIRS"
    if sat in ("TERRA", "AQUA"):
        return "MODIS"
    if "bright_ti4" in row or "bright_ti5" in row:
        return "VIIRS"
    return "MODIS"


def _f(row, *keys):
    for k in keys:
        v = row.get(k)
        if v is not None and str(v) != "nan" and str(v) != "":
            try:
                return float(v)
            except (TypeError, ValueError):
                continue
    return None


def harmonize_record(row: dict, lat=None, lon=None) -> dict:
    """row: raw FIRMS fields (strings/numbers). lat/lon override for GeoJSON
    geometry. Returns a unified observation dict ready for insertion."""
    sensor = detect_sensor(row)
    latitude = lat if lat is not None else _f(row, "latitude", "lat")
    longitude = lon if lon is not None else _f(row, "longitude", "lon", "lng")
    dt = parse_acq_datetime(row.get("acq_date"), row.get("acq_time"))
    conf_raw, conf_h = harmonize_confidence(sensor, row.get("confidence"))
    brightness = _f(row, "brightness", "bright_ti4")
    brightness_bg = _f(row, "bright_t31", "bright_ti5")
    return {
        "latitude": latitude,
        "longitude": longitude,
        "observed_at": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "obs_date": dt.strftime("%Y-%m-%d"),
        "sensor": sensor,
        "satellite": (str(row.get("satellite")).strip()
                      if row.get("satellite") is not None else None),
        "confidence_raw": conf_raw,
        "confidence_harmonized": conf_h,
        "frp": _f(row, "frp"),
        "brightness": brightness,
        "brightness_bg": brightness_bg,
        "daynight": (str(row.get("daynight")).strip()
                     if row.get("daynight") is not None else None),
        "source_product": sensor,
        "cluster_id": None,
        "raw_json": json.dumps({k: (None if v is None else str(v))
                                for k, v in row.items()}),
    }
