from datetime import timedelta

from app.db import SessionLocal
from app.models import Approval, utcnow
from tests.conftest import idem


def restock(client, auth):
    return client.post("/api/v1/assistant/message", json={"text": "Weekend ke liye ₹5,000 ke andar stock arrange karo"},
                       headers=auth).json()["task"]


def expire(approval_id):
    with SessionLocal() as db:
        a = db.get(Approval, approval_id)
        a.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()


def test_expired_approval_can_be_renewed_for_same_payload(client, auth):
    task = restock(client, auth)
    old = task["pending_approval_id"]
    expire(old)
    assert client.post(f"/api/v1/approvals/{old}/confirm", headers={**auth, **idem()}).json()["code"] == "APPROVAL_EXPIRED"
    renewed = client.post(f"/api/v1/tasks/{task['id']}/renew-approval", headers=auth).json()
    new = renewed["pending_approval_id"]
    assert new and new != old
    olds = {a["id"]: a for a in renewed["approvals"]}
    assert olds[old]["status"] == "EXPIRED" and olds[new]["amount"] == olds[old]["amount"]
    done = client.post(f"/api/v1/approvals/{new}/confirm", headers={**auth, **idem()}).json()
    assert done["plans"][-1]["total"] == "4850.00"  # continues into the deterministic shortage re-plan
    # The expired approval stays dead.
    assert client.post(f"/api/v1/approvals/{old}/confirm", headers={**auth, **idem()}).status_code == 409


def test_renew_after_shortage_keeps_revised_plan(client, auth):
    task = restock(client, auth)
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).json()
    expire(task["pending_approval_id"])
    renewed = client.post(f"/api/v1/tasks/{task['id']}/renew-approval", headers=auth).json()
    pending = next(a for a in renewed["approvals"] if a["id"] == renewed["pending_approval_id"])
    assert pending["amount"] == "4850.00" and renewed["plans"][-1]["total"] == "4850.00"


def test_renew_needs_waiting_task(client, auth):
    task = restock(client, auth)
    client.post(f"/api/v1/approvals/{task['pending_approval_id']}/reject", headers=auth)
    assert client.post(f"/api/v1/tasks/{task['id']}/renew-approval", headers=auth).status_code == 409
