"""BLACKCAT backend entry point.

Run:  uvicorn app.main:app --host 127.0.0.1 --port 8000
"""
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from .models.database import get_conn, init_db  # noqa: E402
from .routes.api import router  # noqa: E402

app = FastAPI(title="BLACKCAT - Multi-Satellite Fire Intelligence",
              version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # Hackathon demo build: the frontend may be opened from localhost, a
    # LAN address (phone on the same Wi-Fi) or a tunnel URL (phone on a
    # different network), so any origin is allowed. The API holds no
    # credentials, cookies or user accounts. For a production deployment,
    # restrict this list to the real frontend origin.
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.on_event("startup")
def _startup():
    conn = get_conn()
    init_db(conn)
    conn.close()
