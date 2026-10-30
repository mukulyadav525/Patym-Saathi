import json

from app.adapters.paytm import DEMO_SIGNATURE_HEADER, DemoPaytmAdapter
from tests.conftest import idem, login


def start_collect(client, auth):
    body = client.post("/api/v1/assistant/message", json={"text": "Aman Stores ka pending payment collect karo"},
                       headers=auth).json()
    assert body["intent"] == "COLLECT_DUE", body
    return body["task"]


def send_link(client, auth):
    task = start_collect(client, auth)
    assert task["invoice"]["invoice_number"] == "INV-1042" and task["invoice"]["status"] == "DRAFTED"
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).json()
    assert task["invoice"]["status"] == "SENT" and task["invoice"]["link_mode"] == "DEMO"
    return task


def test_dues_flow_reaches_paid_only_via_verification(client, auth):
    task = send_link(client, auth)
    invoice_id = task["invoice"]["id"]
    result = client.post(f"/api/v1/demo/simulate-payment/{invoice_id}", headers=auth).json()
    assert result["outcome"] == "PAID"
    task = client.get(f"/api/v1/tasks/{task['id']}", headers=auth).json()
    assert task["state"] == "COMPLETED" and task["invoice"]["status"] == "PAID"
    types = [e["event_type"] for e in task["events"]]
    assert "STATUS_CHECKED" in types and "WEBHOOK_RECEIVED" in types


def test_amount_mismatch_requires_reconciliation(client, auth):
    task = send_link(client, auth)
    result = client.post(f"/api/v1/demo/simulate-payment/{task['invoice']['id']}", json={"amount": "1100"},
                         headers=auth).json()
    assert result["outcome"] == "RECONCILIATION_REQUIRED"
    invoices = {i["invoice_number"]: i for i in client.get("/api/v1/invoices", headers=auth).json()}
    assert invoices["INV-1042"]["status"] == "RECONCILIATION_REQUIRED"


def test_unsigned_or_forged_webhook_cannot_mark_paid(client, auth):
    task = send_link(client, auth)
    order_id = task["invoice"]["link_url"].rsplit("/", 1)[1]
    body = json.dumps({"eventId": "evt_forged", "ORDERID": order_id, "MID": "x", "TXNAMOUNT": "1200.00",
                       "STATUS": "TXN_SUCCESS"}).encode()
    resp = client.post("/api/v1/webhooks/paytm", content=body, headers={DEMO_SIGNATURE_HEADER: "bad"})
    assert resp.json()["outcome"] == "SIGNATURE_INVALID"
    # Correctly signed but no transaction on the provider side -> status check fails
    signed = json.dumps({"eventId": "evt_nostatus", "ORDERID": order_id, "TXNAMOUNT": "1200.00",
                         "STATUS": "TXN_SUCCESS"}).encode()
    resp = client.post("/api/v1/webhooks/paytm", content=signed,
                       headers={DEMO_SIGNATURE_HEADER: DemoPaytmAdapter().sign(signed)})
    assert resp.json()["outcome"] == "RECONCILIATION_REQUIRED"
    invoices = {i["invoice_number"]: i for i in client.get("/api/v1/invoices", headers=auth).json()}
    assert invoices["INV-1042"]["status"] != "PAID"


def test_duplicate_webhook_is_idempotent(client, auth):
    task = send_link(client, auth)
    client.post(f"/api/v1/demo/simulate-payment/{task['invoice']['id']}", headers=auth)
    from app.db import SessionLocal
    from app.models import PaymentEvent

    with SessionLocal() as db:
        event = db.query(PaymentEvent).one()
        body = json.dumps({"eventId": event.provider_event_id, "ORDERID": event.provider_order_id,
                           "TXNAMOUNT": "1200.00", "STATUS": "TXN_SUCCESS"}).encode()
    resp = client.post("/api/v1/webhooks/paytm", content=body,
                       headers={DEMO_SIGNATURE_HEADER: DemoPaytmAdapter().sign(body)})
    assert resp.json()["outcome"] == "DUPLICATE_IGNORED"


def test_merchant_isolation(client, auth):
    task = start_collect(client, auth)
    other = login(client, "owner@storeb.demo")
    assert client.get(f"/api/v1/tasks/{task['id']}", headers=other).status_code == 404
    resp = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**other, **idem()})
    assert resp.status_code == 404
    other_invoices = client.get("/api/v1/invoices", headers=other).json()
    assert [i["invoice_number"] for i in other_invoices] == ["INV-9001"]
    assert client.post("/api/v1/demo/reset", headers=other).status_code == 403


def test_requires_auth(client):
    assert client.get("/api/v1/dashboard").status_code == 401
    assert client.get("/api/v1/dashboard", headers={"Authorization": "Bearer nope"}).status_code == 401


def test_llm_cannot_call_write_tools():
    import pytest

    from app.errors import ApiError
    from app.tools.registry import Caller, authorize

    for tool in ("create_supplier_order", "create_payment_link", "check_txn_status", "update_invoice"):
        with pytest.raises(ApiError):
            authorize(tool, Caller.LLM)
    authorize("get_inventory", Caller.LLM)


def test_brief_cites_records(client, auth):
    body = client.post("/api/v1/assistant/message", json={"text": "Aaj mere business mein kya important hai?"},
                       headers=auth).json()
    assert body["intent"] == "BRIEF"
    priorities = body["brief"]["priorities"]
    assert len(priorities) == 3 and all(p["sources"] for p in priorities)
    assert "Aman Stores" in priorities[0]["title"]


def test_reset_restores_fixture(client, auth):
    send_link(client, auth)
    assert client.post("/api/v1/demo/reset", headers=auth).status_code == 200
    invoices = {i["invoice_number"]: i["status"] for i in client.get("/api/v1/invoices", headers=auth).json()}
    assert invoices == {"INV-1035": "PAID", "INV-1042": "PENDING", "INV-1038": "PENDING"}
    assert client.get("/api/v1/tasks", headers=auth).json() == []


def test_audit_log_is_append_only():
    import pytest
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    from app.db import SessionLocal

    with SessionLocal() as db:
        db.execute(text("INSERT INTO audit_events (id, merchant_id, actor, event_type, entity_type, entity_id, summary,"
                        " details_redacted, created_at) SELECT gen_random_uuid(), id, 'x', 'T', 't', '1', 's', '{}',"
                        " now() FROM merchants LIMIT 1"))
        db.commit()
        with pytest.raises(DBAPIError):
            db.execute(text("UPDATE audit_events SET summary = 'tampered'"))
