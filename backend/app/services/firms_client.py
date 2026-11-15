"""NASA FIRMS area-API client.

The MAP_KEY is read ONLY from the FIRMS_MAP_KEY environment variable and is
never written to logs (request URLs containing the key are never logged).
Responses are cached as files under backend/data/cache/. If no key is
configured the client raises FirmsUnavailable - the rest of the application
keeps working on locally ingested data.
"""
import hashlib
import os
from pathlib import Path

import urllib.request
import urllib.error

BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
SOURCES = ("MODIS_NRT", "VIIRS_SNPP_NRT", "VIIRS_SNPP_SP", "MODIS_SP")
CACHE_DIR = Path(__file__).resolve().parents[2] / "data" / "cache"


class FirmsUnavailable(Exception):
    pass


def _key() -> str:
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not key:
        raise FirmsUnavailable(
            "FIRMS_MAP_KEY is not set; live FIRMS fetching is unavailable. "
            "The application continues to work on locally ingested data.")
    return key


def fetch_area_csv(source: str, bbox, day_range: int = 5, date: str = "") -> bytes:
    """bbox = (west, south, east, north). Returns raw CSV bytes (cached)."""
    if source not in SOURCES:
        raise ValueError(f"Unknown FIRMS source: {source}")
    key = _key()
    bbox_s = ",".join(str(x) for x in bbox)
    url = f"{BASE}/{key}/{source}/{bbox_s}/{day_range}"
    if date:
        url += f"/{date}"
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file = CACHE_DIR / (hashlib.sha256(
        f"{source}|{bbox_s}|{day_range}|{date}".encode()).hexdigest() + ".csv")
    if cache_file.exists():
        return cache_file.read_bytes()
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310
            data = resp.read()
    except (urllib.error.URLError, TimeoutError) as e:
        # NOTE: the URL (which embeds the key) is deliberately not included.
        raise FirmsUnavailable(f"FIRMS request failed: {type(e).__name__}") from e
    if data.lstrip().lower().startswith(b"invalid"):
        raise FirmsUnavailable("FIRMS rejected the request (check MAP_KEY).")
    cache_file.write_bytes(data)
    return data
