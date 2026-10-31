"""End-to-end restock: plan -> approve -> shortage -> replan -> approve 2 -> simulated delivery."""

from tests.conftest import idem

RESTOCK = "Weekend ke liye ₹5,000 ke andar stock arrange karo"


def start(client, auth):
    resp = client.post("/api/v1/assistant/message", json={"text": RESTOCK}, headers=auth)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["intent"] == "RESTOCK"
    return body["task"]


def stock(client, auth):
    return {i["sku"]: i["usable_packs"] for i in client.get("/api/v1/inventory", headers=auth).json()}


def test_full_restock_scenario(client, auth):
    before = stock(client, auth)
    task = start(client, auth)
    assert task["state"] == "AWAITING_APPROVAL"
    plan_v1 = task["plans"][0]
    assert plan_v1["total"] == "4650.00" and plan_v1["total_packs"] == 31
    assert {line["supplier_name"] for line in plan_v1["lines"]} == {"Gupta Distributors"}
    approval_1 = task["pending_approval_id"]

    resp = client.post(f"/api/v1/approvals/{approval_1}/confirm", headers={**auth, **idem()})
    assert resp.status_code == 200, resp.text
    task = resp.json()
    assert task["state"] == "AWAITING_APPROVAL"  # shortage triggered a re-plan
    order_a = task["orders"][0]
    assert order_a["status"] == "PARTIALLY_ACCEPTED" and order_a["total"] == "3970.00"
    assert order_a["connector_mode"] == "SIMULATED"
    plan_v2 = task["plans"][-1]
    assert plan_v2["version"] == 2 and plan_v2["total"] == "4850.00" and plan_v2["committed_total"] == "3970.00"
    assert plan_v2["diff"][0]["to_supplier"] == "Metro Wholesale" and plan_v2["diff"][0]["delta"] == "200.00"
    assert task["plans"][0]["status"] == "SUPERSEDED"
    assert stock(client, auth) == before  # ordering never changes inventory

    # old approval cannot be reused
    reuse = client.post(f"/api/v1/approvals/{approval_1}/confirm", headers={**auth, **idem()})
    assert reuse.status_code == 409 and reuse.json()["code"] == "APPROVAL_ALREADY_USED"

    approval_2 = task["pending_approval_id"]
    assert approval_2 and approval_2 != approval_1
    task = client.post(f"/api/v1/approvals/{approval_2}/confirm", headers={**auth, **idem()}).json()
    assert task["state"] == "VERIFYING"
    assert sorted(o["total"] for o in task["orders"]) == ["3970.00", "880.00"]
    assert stock(client, auth) == before

    task = client.post(f"/api/v1/demo/tasks/{task['id']}/simulate-delivery", headers=auth).json()
    assert task["state"] == "COMPLETED"
    assert "₹150.00 under" in task["result_note"]
    after = stock(client, auth)
    assert sum(after.values()) - sum(before.values()) == 31
    assert after == {"ATTA10": 6, "RICE5": 5, "SUGAR1": 20, "TOOR1": 8, "OIL1": 9, "TEA250": 6,
                     "NOODLE12": 14, "HAIROIL": 18, "ATTA5": 6}  # slow movers and the new 5 kg bag untouched
    types = [e["event_type"] for e in task["events"]]
    assert types.count("APPROVAL_CONFIRMED") == 2 and "APPROVAL_SUPERSEDED" not in types


def test_duplicate_confirm_with_same_key_creates_one_order(client, auth):
    task = start(client, auth)
    key = idem()
    first = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **key})
    second = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **key})
    assert first.status_code == 200 and second.status_code == 200
    assert len(client.get("/api/v1/orders", headers=auth).json()) == 1


def test_rejecting_second_approval_completes_partially(client, auth):
    task = start(client, auth)
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).json()
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/reject", headers=auth).json()
    assert task["state"] == "VERIFYING"
    task = client.post(f"/api/v1/demo/tasks/{task['id']}/simulate-delivery", headers=auth).json()
    assert task["state"] == "PARTIALLY_COMPLETED"
    assert "3,970.00" in task["result_note"]


def test_rejecting_first_approval_cancels(client, auth):
    task = start(client, auth)
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/reject", headers=auth).json()
    assert task["state"] == "CANCELLED"
    assert client.get("/api/v1/orders", headers=auth).json() == []


def test_replan_supersedes_pending_approval(client, auth):
    task = start(client, auth)
    old = task["pending_approval_id"]
    task = client.post(f"/api/v1/tasks/{task['id']}/replan", headers=auth).json()
    assert task["pending_approval_id"] != old
    resp = client.post(f"/api/v1/approvals/{old}/confirm", headers={**auth, **idem()})
    assert resp.status_code == 409 and resp.json()["code"] == "APPROVAL_SUPERSEDED"


def test_budget_too_small_returns_explanation_without_task(client, auth):
    body = client.post("/api/v1/assistant/message", json={"text": "₹3,000 mein stock order karo"}, headers=auth).json()
    assert body["task"] is None and "budget" in body["reply"].lower()


def test_spoken_amount_needs_confirmation(client, auth):
    body = client.post("/api/v1/assistant/message", json={"text": "paanch hazaar mein stock arrange karo"},
                       headers=auth).json()
    assert body["task"] is None and body["needs_confirmation"]["value"] == "5000.00"
    body = client.post("/api/v1/assistant/message",
                       json={"text": "paanch hazaar mein stock arrange karo", "confirmed_budget": "5000.00"},
                       headers=auth).json()
    assert body["task"]["plans"][0]["total"] == "4650.00"


def test_expired_approval_is_refused(client, auth):
    from datetime import timedelta

    from app.db import SessionLocal
    from app.models import Approval, utcnow

    task = start(client, auth)
    with SessionLocal() as db:
        approval = db.get(Approval, __import__("uuid").UUID(task["pending_approval_id"]))
        approval.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    resp = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()})
    assert resp.status_code == 409 and resp.json()["code"] == "APPROVAL_EXPIRED"


def test_tampered_plan_fails_hash_check(client, auth):
    import uuid

    from app.db import SessionLocal
    from app.models import Plan

    task = start(client, auth)
    with SessionLocal() as db:
        plan = db.get(Plan, uuid.UUID(task["plans"][0]["id"]))
        lines = [dict(line) for line in plan.payload["lines"]]
        lines[0]["packs"] = 40
        plan.payload = {**plan.payload, "lines": lines}
        db.commit()
    resp = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()})
    assert resp.status_code == 409 and resp.json()["code"] == "HASH_MISMATCH"
    assert client.get("/api/v1/orders", headers=auth).json() == []


def test_missing_idempotency_key_rejected(client, auth):
    task = start(client, auth)
    resp = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers=auth)
    assert resp.status_code == 422
