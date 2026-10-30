from tests.conftest import idem
from app.config import get_settings


def plan(client, auth):
    return client.post("/api/v1/assistant/message", json={"text": "Weekend ke liye ₹5,000 ke andar stock arrange karo"},
                       headers=auth).json()["task"]


def set_pin(client, auth, pin):
    return client.post("/api/v1/me/approval-pin", json={"password": get_settings().demo_password, "pin": pin}, headers=auth)


def confirm(client, auth, approval_id, pin=None, key=None):
    headers = {**auth, "Idempotency-Key": key or idem()["Idempotency-Key"]}
    if pin:
        headers["X-Approval-Pin"] = pin
    return client.post(f"/api/v1/approvals/{approval_id}/confirm", headers=headers)


def test_no_pin_set_means_tap_is_enough(client, auth):
    assert client.get("/api/v1/me", headers=auth).json()["user"]["has_approval_pin"] is False
    assert confirm(client, auth, plan(client, auth)["pending_approval_id"]).status_code == 200


def test_pin_required_and_checked_once_set(client, auth):
    assert set_pin(client, auth, "4821").status_code == 200
    assert client.get("/api/v1/me", headers=auth).json()["user"]["has_approval_pin"] is True
    approval = plan(client, auth)["pending_approval_id"]
    assert confirm(client, auth, approval).json()["code"] == "PIN_REQUIRED"
    assert confirm(client, auth, approval, "0000").json()["code"] == "PIN_INVALID"
    # A failed PIN must not consume the approval.
    assert confirm(client, auth, approval, "4821").status_code == 200


def test_pin_locks_after_five_wrong_tries(client, auth):
    set_pin(client, auth, "4821")
    approval = plan(client, auth)["pending_approval_id"]
    for _ in range(5):
        assert confirm(client, auth, approval, "1111").status_code == 403
    res = confirm(client, auth, approval, "4821")
    assert res.status_code == 423 and res.json()["code"] == "PIN_LOCKED"


def test_setting_pin_needs_password_and_four_digits(client, auth):
    assert client.post("/api/v1/me/approval-pin", json={"password": "wrong", "pin": "1234"}, headers=auth).status_code == 401
    assert set_pin(client, auth, "12a4").status_code == 422
    set_pin(client, auth, "1234")
    assert set_pin(client, auth, None).status_code == 200
    assert client.get("/api/v1/me", headers=auth).json()["user"]["has_approval_pin"] is False


def test_retry_after_wrong_pin_with_same_idempotency_key(client, auth):
    set_pin(client, auth, "4821")
    approval = plan(client, auth)["pending_approval_id"]
    assert confirm(client, auth, approval, "9999", key="same-tap").status_code == 403
    assert confirm(client, auth, approval, "4821", key="same-tap").status_code == 200
