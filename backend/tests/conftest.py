import os
import sys
import tempfile
from pathlib import Path

# Isolate tests on their own database file before app modules import.
_TMP = tempfile.mkdtemp(prefix="blackcat_tests_")
os.environ["BLACKCAT_DB"] = str(Path(_TMP) / "test.db")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402

from app.models.database import clear_all, get_conn, init_db  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    conn = get_conn()
    init_db(conn)
    clear_all(conn)
    conn.close()
    yield
