"""Regression tests for bugs found in the production-readiness review."""

from datetime import timedelta

import pytest

from app.db import SessionLocal
from app.models import SupplierQuote, utcnow
from tests.conftest import idem

RESTOCK = "Weekend ke liye ₹5,000 ke andar stock arrange karo"


def ask(client, auth, text):
    return client.post("/api/v1/assistant/message", json={"text": text}, headers=auth).json()


def confirm(client, auth, approval_id, key=None):
    return client.post(f"/api/v1/approvals/{approval_id}/confirm", headers={**auth, "Idempotency-Key": key or idem()["Idempotency-Key"]})


def test_reject_revised_plan_after_delivery_completes_task(client, auth):
    """Was stuck in VERIFYING forever: goods arrived while approval 2 was pending, then approval 2 rejected."""
    task = ask(client, auth, RESTOCK)["task"]
    task = confirm(client, auth, task["pending_approval_id"]).json()
    order_a = next(o for o in task["orders"] if o["status"] == "PARTIALLY_ACCEPTED")
    assert client.post(f"/api/v1/demo/simulate-delivery/{order_a['id']}", headers=auth).status_code == 200
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/reject", headers=auth).json()
    assert task["state"] == "PARTIALLY_COMPLETED"
    assert "₹3,970.00" in task["result_note"] and "under the ₹5,000.00 limit" in task["result_note"]


def test_retry_with_same_key_returns_success_not_already_used(client, auth):
    task = ask(client, auth, RESTOCK)["task"]
    first = confirm(client, auth, task["pending_approval_id"], key="tap-1")
    again = confirm(client, auth, task["pending_approval_id"], key="tap-1")
    assert first.status_code == again.status_code == 200 and again.json()["id"] == task["id"]
    assert len(again.json()["orders"]) == 1


def test_stale_quote_gets_fresh_plan_on_renew(client, auth):
    task = ask(client, auth, RESTOCK)["task"]
    with SessionLocal() as db:
        for q in db.query(SupplierQuote).all():
            q.valid_until = utcnow() - timedelta(minutes=1)
        db.commit()
    res = confirm(client, auth, task["pending_approval_id"])
    assert res.status_code == 409 and res.json()["code"] == "QUOTE_CHANGED"
    renewed = client.post(f"/api/v1/tasks/{task['id']}/renew-approval", headers=auth).json()
    assert renewed["plans"][-1]["version"] == 2 and renewed["plans"][-1]["total"] == "4650.00"
    assert renewed["pending_approval_id"] != task["pending_approval_id"]
    done = confirm(client, auth, renewed["pending_approval_id"]).json()
    assert done["plans"][-1]["total"] == "4850.00"  # carries on into the oil shortage as usual


def _sent_link(client, auth):
    task = ask(client, auth, "Aman Stores ka pending payment collect karo")["task"]
    task = confirm(client, auth, task["pending_approval_id"]).json()
    return task, task["invoice"]["id"]


def test_reconciliation_is_counted_and_can_be_resolved(client, auth):
    task, inv = _sent_link(client, auth)
    res = client.post(f"/api/v1/demo/simulate-payment/{inv}", json={"amount": "1000"}, headers=auth).json()
    assert res["outcome"] == "RECONCILIATION_REQUIRED"
    dash = client.get("/api/v1/dashboard", headers=auth).json()
    assert dash["outstanding_dues"] == "1850.00"  # still owed while being checked
    again = client.post(f"/api/v1/invoices/{inv}/recheck", headers=auth).json()
    assert again["outcome"] == "RECONCILIATION_REQUIRED" and again["ok"] is False
    assert client.post(f"/api/v1/invoices/{inv}/not-received", headers=auth).status_code == 200
    t = client.get(f"/api/v1/tasks/{task['id']}", headers=auth).json()
    assert t["state"] == "FAILED" and t["invoice"]["status"] == "FAILED"
    # collectable again with a brand-new link
    again_task, _ = _sent_link(client, auth)
    assert again_task["invoice"]["status"] == "SENT" and again_task["id"] != task["id"]


def test_withdraw_unpaid_link_then_new_link(client, auth):
    task, inv = _sent_link(client, auth)
    assert client.post(f"/api/v1/invoices/{inv}/withdraw-link", headers=auth).json()["outcome"] == "EXPIRED"
    t = client.get(f"/api/v1/tasks/{task['id']}", headers=auth).json()
    assert t["state"] == "FAILED"
    assert client.post(f"/api/v1/invoices/{inv}/withdraw-link", headers=auth).status_code == 409
    new_task, _ = _sent_link(client, auth)
    assert new_task["invoice"]["status"] == "SENT"
    # a late payment for the withdrawn link's order is ignored, never marks paid
    assert client.get("/api/v1/dashboard", headers=auth).json()["outstanding_dues"] == "1850.00"


def test_recheck_sent_link_in_demo_reports_no_payment(client, auth):
    _, inv = _sent_link(client, auth)
    res = client.post(f"/api/v1/invoices/{inv}/recheck", headers=auth).json()
    assert res["ok"] is False and res["outcome"] == "WAITING"
    inv_now = next(i for i in client.get("/api/v1/invoices", headers=auth).json() if i["id"] == inv)
    assert inv_now["status"] == "SENT"  # unchanged: no payment yet is not a mismatch
    paid = client.post(f"/api/v1/demo/simulate-payment/{inv}", headers=auth).json()
    assert paid["outcome"] == "PAID"


@pytest.mark.parametrize("field,value,needle", [
    ("jwt_secret", "short", "JWT_SECRET"),
    ("demo_password", "saathi-demo-2026", "DEMO_PASSWORD"),
    ("cors_origins", "*", "CORS_ORIGINS"),
])
def test_production_guard(monkeypatch, field, value, needle):
    import app.main as main
    s = main._settings
    monkeypatch.setattr(s, "app_env", "production")
    monkeypatch.setattr(s, "jwt_secret", "x" * 40)
    monkeypatch.setattr(s, "demo_webhook_key", "y" * 30)
    monkeypatch.setattr(s, "demo_password", "a-long-unique-password")
    monkeypatch.setattr(s, "cors_origins", "https://dash.example.com")
    main._check_production_settings()  # all good
    monkeypatch.setattr(s, field, value)
    with pytest.raises(RuntimeError, match=needle):
        main._check_production_settings()


def test_login_locks_after_five_wrong_passwords(client):
    from app.config import get_settings
    email = "mukul24360@iiitd.ac.in"
    for _ in range(4):
        assert client.post("/api/v1/auth/login", json={"email": email, "password": "wrong"}).status_code == 401
    ok = client.post("/api/v1/auth/login", json={"email": email, "password": get_settings().demo_password})
    assert ok.status_code == 200  # a success resets the counter
    for _ in range(5):
        client.post("/api/v1/auth/login", json={"email": email, "password": "wrong"})
    locked = client.post("/api/v1/auth/login", json={"email": email, "password": get_settings().demo_password})
    assert locked.status_code == 429 and locked.json()["code"] == "LOGIN_LOCKED"
    unknown = client.post("/api/v1/auth/login", json={"email": "nobody@x.in", "password": "x"})
    assert unknown.status_code == 401 and unknown.json()["code"] == "BAD_CREDENTIALS"


def test_cors_allows_pin_header(client):
    res = client.options("/api/v1/approvals/x/confirm", headers={
        "Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "authorization,idempotency-key,x-approval-pin"})
    assert res.status_code == 200 and "x-approval-pin" in res.headers["access-control-allow-headers"].lower()


@pytest.mark.parametrize("bad", ["NaN", "Infinity", "-inf", "abc", "1e99"])
def test_non_finite_amounts_are_422_not_500(client, auth, bad):
    assert client.post("/api/v1/settings/business", json={"cash_on_hand": bad}, headers=auth).status_code == 422
    r = client.post("/api/v1/assistant/message",
                    json={"text": "Weekend ke liye stock arrange karo", "confirmed_budget": bad}, headers=auth)
    assert r.status_code == 422 and r.json()["code"] in ("BAD_AMOUNT", "BAD_BUDGET")


@pytest.mark.parametrize("cursor", ["nan", "inf", "-1", "x"])
def test_bad_audit_cursor_is_400(client, auth, cursor):
    assert client.get(f"/api/v1/audit?cursor={cursor}", headers=auth).status_code == 400


def test_bad_bill_price_is_422(client, auth):
    r = client.post("/api/v1/bills/text", json={"text": "Atta 10kg 2 380 760"}, headers=auth).json()
    line = r["lines"][0]
    res = client.post(f"/api/v1/bills/{r['id']}/confirm",
                      json={"lines": [{"product_id": line["product_id"], "packs": 2, "unit_price": "NaN"}]}, headers=auth)
    assert res.status_code == 422


def test_foreign_signed_token_rejected(client):
    import jwt
    forged = jwt.encode({"email": "mukul24360@iiitd.ac.in", "aud": "authenticated"}, "some-supabase-project-secret-of-32-chars-plus", algorithm="HS256")
    assert client.get("/api/v1/me", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_unexpected_error_is_json_500_with_cors(client, auth, monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    from app.services import views

    def boom(*a, **k):
        raise RuntimeError("boom")

    monkeypatch.setattr(views, "dashboard", boom)
    c = TestClient(app, raise_server_exceptions=False)
    r = c.get("/api/v1/dashboard", headers={**auth, "Origin": "http://localhost:3000"})
    assert r.status_code == 500 and r.json()["code"] == "INTERNAL" and "correlation_id" in r.json()["details"]
    assert r.headers.get("access-control-allow-origin") == "http://localhost:3000"
