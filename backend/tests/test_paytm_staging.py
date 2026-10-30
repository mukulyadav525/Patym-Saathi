"""Staging adapter against recorded Paytm responses (field names from the Create Link and
Transaction Status v3 docs). No network: httpx.MockTransport stands in for Paytm."""

import json
from urllib.parse import urlencode

import httpx
import pytest
from paytmchecksum import generateSignature, verifySignature

from app.adapters import paytm
from app.config import get_settings
from app.services import dues_flow
from tests.conftest import idem

KEY = "TESTKEY_16CHARS!"
LINK_ID = "48319847"
PAYTM_ORDER = "PARTNER_LINK_48319847_1"


@pytest.fixture
def staging(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "paytm_env", "staging")
    monkeypatch.setattr(settings, "paytm_merchant_key", KEY)
    calls: list[dict] = []
    state = {"status_amount": "1200.00", "status": "TXN_SUCCESS", "link_ok": True}

    def handler(request: httpx.Request) -> httpx.Response:
        sent = json.loads(request.content)
        body_str = json.dumps(sent["body"], separators=(",", ":"))
        assert sent["head"]["tokenType"] == "AES"
        assert verifySignature(body_str, KEY, sent["head"]["signature"]), "request signature must cover the body"
        calls.append({"url": str(request.url), "body": sent["body"]})
        if request.url.path == "/link/create":
            if not state["link_ok"]:
                return httpx.Response(200, json={"body": {"resultInfo": {"resultStatus": "FAILED", "resultMessage": "Invalid MID"}}})
            return httpx.Response(200, json={"head": {"version": "v1"}, "body": {
                "resultInfo": {"resultStatus": "SUCCESS", "resultCode": "200", "resultMessage": "Process Successful"},
                "linkId": int(LINK_ID), "linkType": "FIXED", "amount": sent["body"]["amount"],
                "shortUrl": "https://paytm.me/Ab-Cd12", "longUrl": "https://securestage.paytmpayments.com/link/x",
            }})
        if request.url.path == "/v3/order/status":
            return httpx.Response(200, json={"head": {"version": "v1"}, "body": {
                "resultInfo": {"resultStatus": state["status"], "resultCode": "01", "resultMsg": "Txn Success"},
                "txnId": "20261030111212800110168", "orderId": sent["body"]["orderId"],
                "txnAmount": state["status_amount"], "mid": settings.paytm_mid, "paymentMode": "UPI",
            }})
        return httpx.Response(404)

    adapter = paytm.StagingPaytmAdapter(client=httpx.Client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(dues_flow, "get_adapter", lambda: adapter)
    return calls, state


def link_sent(client, auth):
    task = client.post("/api/v1/assistant/message", json={"text": "Aman Stores ka pending payment collect karo"},
                       headers=auth).json()["task"]
    return client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()})


def callback(amount="1200.00", tamper=False) -> bytes:
    params = {"MID": get_settings().paytm_mid, "ORDERID": PAYTM_ORDER, "LINKID": LINK_ID, "TXNID": "20261030111212800110168",
              "TXNAMOUNT": amount, "CURRENCY": "INR", "STATUS": "TXN_SUCCESS", "PAYMENTMODE": "UPI"}
    params["CHECKSUMHASH"] = generateSignature(params, "WRONG_KEY_16CHAR" if tamper else KEY)
    return urlencode(params).encode()


def post_callback(client, body: bytes):
    return client.post("/api/v1/webhooks/paytm", content=body, headers={"Content-Type": "application/x-www-form-urlencoded"})


def test_create_link_is_signed_and_uses_short_url(client, auth, staging):
    calls, _ = staging
    task = link_sent(client, auth).json()
    assert task["invoice"]["status"] == "SENT"
    assert task["invoice"]["link_mode"] == "STAGING"
    assert task["invoice"]["link_url"] == "https://paytm.me/Ab-Cd12"  # never the longUrl
    create = calls[0]
    assert create["url"].startswith("https://securestage.paytmpayments.com/link/create")
    assert create["body"]["amount"] == "1200.00" and create["body"]["linkType"] == "FIXED"


def test_signed_callback_plus_status_check_marks_paid(client, auth, staging):
    calls, _ = staging
    task = link_sent(client, auth).json()
    assert post_callback(client, callback()).json()["outcome"] == "PAID"
    status_call = calls[-1]
    assert status_call["url"] == "https://securegw-stage.paytmpayments.in/v3/order/status"
    assert status_call["body"]["orderId"] == PAYTM_ORDER
    task = client.get(f"/api/v1/tasks/{task['id']}", headers=auth).json()
    assert task["invoice"]["status"] == "PAID" and task["state"] == "COMPLETED"
    assert post_callback(client, callback()).json()["outcome"] == "DUPLICATE_IGNORED"


def test_bad_checksum_never_pays(client, auth, staging):
    task = link_sent(client, auth).json()
    assert post_callback(client, callback(tamper=True)).json()["outcome"] == "SIGNATURE_INVALID"
    assert client.get(f"/api/v1/tasks/{task['id']}", headers=auth).json()["invoice"]["status"] == "SENT"


def test_status_amount_mismatch_needs_reconciliation(client, auth, staging):
    _, state = staging
    state["status_amount"] = "1000.00"
    task = link_sent(client, auth).json()
    assert post_callback(client, callback()).json()["outcome"] == "RECONCILIATION_REQUIRED"
    assert client.get(f"/api/v1/tasks/{task['id']}", headers=auth).json()["invoice"]["status"] == "RECONCILIATION_REQUIRED"


def test_create_link_failure_is_reported_not_faked(client, auth, staging):
    _, state = staging
    state["link_ok"] = False
    res = link_sent(client, auth)
    assert res.status_code == 502 and res.json()["code"] == "PROVIDER_UNAVAILABLE"


def test_failed_create_link_leaves_task_retryable(client, auth, staging):
    _, state = staging
    state["link_ok"] = False
    task = client.post("/api/v1/assistant/message", json={"text": "Aman Stores ka pending payment collect karo"},
                       headers=auth).json()["task"]
    assert client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).status_code == 502
    after = client.get(f"/api/v1/tasks/{task['id']}", headers=auth).json()
    assert after["invoice"]["status"] == "DRAFTED" and after["pending_approval_id"] == task["pending_approval_id"]
    state["link_ok"] = True
    done = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).json()
    assert done["invoice"]["status"] == "SENT"
