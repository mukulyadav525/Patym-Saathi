"""Production safety: rate limits on paid calls, concurrent scans, non-blocking uploads."""

import threading
import time

from app.services import ratelimit
from tests.conftest import login


def test_rate_limit_returns_429_with_retry_after(client, auth, monkeypatch):
    monkeypatch.setitem(ratelimit.LIMITS, "scan", (2, 3600))
    assert client.post("/api/v1/agent/scan", headers=auth).status_code == 200
    assert client.post("/api/v1/agent/scan", headers=auth).status_code == 200
    r = client.post("/api/v1/agent/scan", headers=auth)
    assert r.status_code == 429 and r.json()["code"] == "RATE_LIMITED"
    assert r.json()["details"]["retry_after_seconds"] > 0
    # limits are per merchant
    assert client.post("/api/v1/agent/scan", headers=login(client, "owner@storeb.demo")).status_code == 200


def test_concurrent_scans_do_not_duplicate_tasks(client, auth):
    results = []

    def run():
        results.append(client.post("/api/v1/agent/scan", headers=auth).json())

    threads = [threading.Thread(target=run) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    created = [c for r in results for c in r["created"]]
    assert sorted(c["type"] for c in created) == ["COLLECT_DUE", "RESTOCK"]


def test_slow_upload_does_not_block_other_requests(client, auth, monkeypatch):
    from app.adapters import sarvam

    def slow_parse(*_a, **_k):
        time.sleep(1.5)
        return "Atta 10kg x 2 @ 380 = 760"

    monkeypatch.setattr(sarvam, "parse_document", slow_parse)
    started = threading.Event()
    out = {}

    def upload():
        started.set()
        out["r"] = client.post("/api/v1/bills/scan", files={"file": ("b.jpg", b"\\xff\\xd8x", "image/jpeg")}, headers=auth)

    t = threading.Thread(target=upload)
    t.start()
    started.wait()
    time.sleep(0.2)
    t0 = time.monotonic()
    assert client.get("/health").status_code == 200
    assert time.monotonic() - t0 < 1.0
    t.join()
    assert out["r"].status_code == 200 and out["r"].json()["lines"][0]["packs"] == 2


def test_startup_refuses_outdated_schema():
    import pytest
    from sqlalchemy import text

    from app.db import engine
    from app.main import check_schema

    check_schema()  # migrated test DB: fine
    with engine.begin() as conn:
        head = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
        conn.execute(text("UPDATE alembic_version SET version_num = 'ba27487435b3'"))
    try:
        with pytest.raises(RuntimeError, match="alembic upgrade head"):
            check_schema()
    finally:
        with engine.begin() as conn:
            conn.execute(text("UPDATE alembic_version SET version_num = :h"), {"h": head})
