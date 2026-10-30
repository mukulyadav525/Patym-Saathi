"""Paytm payment adapters.

DemoPaytmAdapter (default, PAYTM_ENV=demo): issues clearly-labelled DEMO links, signs simulated
webhooks with DEMO_WEBHOOK_KEY (HMAC-SHA256) and answers status lookups from `demo_provider_txns`,
standing in for Paytm's Transaction Status API. No money moves.

StagingPaytmAdapter (PAYTM_ENV=staging): built to the Paytm staging spec (Create Link API,
Transaction Status API v3, CHECKSUMHASH-signed callbacks) using the official `paytmchecksum`
package and PAYTM_MID + PAYTM_MERCHANT_KEY. Tested against recorded mock responses only; it has
not been run against Paytm staging, so it must be described as "built to staging spec".
"""

import hashlib
import hmac
import json
import time
import uuid
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from urllib.parse import parse_qsl

import httpx

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiError
from app.models import DemoProviderTxn, Invoice

SUCCESS = "TXN_SUCCESS"
DEMO_SIGNATURE_HEADER = "x-demo-signature"


@dataclass
class LinkResult:
    provider_order_id: str
    link_url: str
    mode: str


@dataclass
class WebhookEvent:
    """Provider callback normalised to what the verification path needs. Values are untrusted until
    the server-side status check agrees with them."""
    event_id: str
    order_ref: str | None  # our invoice.provider_order_id (DEMO order id, or Paytm linkId)
    provider_order_id: str | None  # the order id Paytm's Status API is queried with
    txn_id: str | None
    amount: Decimal | None
    status: str | None
    payment_mode: str | None
    redacted: dict


def _amount(value: object) -> Decimal | None:
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        return None


def _redact(data: dict) -> dict:
    return {k: v for k, v in data.items() if k in ("ORDERID", "TXNAMOUNT", "STATUS", "PAYMENTMODE", "CURRENCY", "LINKID")}


@dataclass
class StatusResult:
    mid: str
    order_id: str
    amount: Decimal
    status: str
    txn_id: str | None


class DemoPaytmAdapter:
    mode = "DEMO"

    def create_link(self, db: Session, invoice: Invoice) -> LinkResult:
        order_id = f"DEMO-{invoice.invoice_number}-{uuid.uuid4().hex[:6].upper()}"
        return LinkResult(order_id, f"https://demo.saathi.invalid/pay/{order_id}", self.mode)

    def sign(self, body: bytes) -> str:
        return hmac.new(get_settings().demo_webhook_key.encode(), body, hashlib.sha256).hexdigest()

    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        given = headers.get(DEMO_SIGNATURE_HEADER, "")
        return bool(given) and hmac.compare_digest(given, self.sign(body))

    def parse_webhook(self, headers: dict[str, str], body: bytes) -> tuple[bool, WebhookEvent]:
        try:
            data = json.loads(body)
        except ValueError:
            raise ApiError(400, "BAD_PAYLOAD", "Webhook body is not JSON")
        if not isinstance(data, dict):
            raise ApiError(400, "BAD_PAYLOAD", "Webhook body is not an object")
        event = WebhookEvent(
            event_id=str(data.get("eventId") or data.get("TXNID") or ""), order_ref=data.get("ORDERID"),
            provider_order_id=data.get("ORDERID"), txn_id=data.get("TXNID"), amount=_amount(data.get("TXNAMOUNT")),
            status=data.get("STATUS"), payment_mode=data.get("PAYMENTMODE"), redacted=_redact(data),
        )
        return self.verify_webhook(headers, body), event

    def fetch_status(self, db: Session, provider_order_id: str, paytm_order_id: str | None = None) -> StatusResult | None:
        txn = db.scalars(
            select(DemoProviderTxn)
            .where(DemoProviderTxn.provider_order_id == provider_order_id)
            .order_by(DemoProviderTxn.created_at.desc())
        ).first()
        if txn is None:
            return None
        return StatusResult(txn.mid, txn.provider_order_id, txn.amount, txn.status, txn.txn_id)

    def simulate_customer_payment(self, db: Session, invoice: Invoice, amount: Decimal) -> tuple[bytes, dict[str, str]]:
        settings = get_settings()
        txn_id = f"DEMOTXN{uuid.uuid4().hex[:10].upper()}"
        db.add(DemoProviderTxn(
            provider_order_id=invoice.provider_order_id, mid=settings.paytm_mid, txn_id=txn_id,
            amount=amount, status=SUCCESS,
        ))
        db.flush()
        body = json.dumps({
            "eventId": f"evt_{uuid.uuid4().hex}",
            "ORDERID": invoice.provider_order_id,
            "MID": settings.paytm_mid,
            "TXNID": txn_id,
            "TXNAMOUNT": f"{amount:.2f}",
            "CURRENCY": "INR",
            "STATUS": SUCCESS,
            "PAYMENTMODE": "UPI",
        }).encode()
        return body, {DEMO_SIGNATURE_HEADER: self.sign(body)}


class StagingPaytmAdapter:
    mode = "STAGING"

    def __init__(self, client: httpx.Client | None = None) -> None:
        settings = get_settings()
        if not settings.paytm_merchant_key or not settings.paytm_mid:
            raise ApiError(503, "PROVIDER_UNAVAILABLE", "Paytm staging credentials are not configured")
        try:
            from paytmchecksum import generateSignature, verifySignature
        except ImportError as exc:
            raise ApiError(503, "PROVIDER_UNAVAILABLE", "paytmchecksum package not installed") from exc
        self._generate, self._verify = generateSignature, verifySignature
        self.mid = settings.paytm_mid
        self.key = settings.paytm_merchant_key
        self.settings = settings
        self.client = client or httpx.Client(timeout=settings.paytm_timeout_s)

    def _post(self, url: str, body: dict) -> dict:
        # The signature covers the exact body string that is sent.
        body_str = json.dumps(body, separators=(",", ":"))
        signature = self._generate(body_str, self.key)
        payload = '{"body":' + body_str + ',"head":' + json.dumps(
            {"tokenType": "AES", "signature": signature, "timestamp": str(int(time.time()))}, separators=(",", ":")) + "}"
        try:
            res = self.client.post(url, content=payload, headers={"Content-Type": "application/json"})
            res.raise_for_status()
            data = res.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise ApiError(502, "PROVIDER_UNAVAILABLE", "Paytm staging did not respond correctly") from exc
        if not isinstance(data, dict) or not isinstance(data.get("body"), dict):
            raise ApiError(502, "PROVIDER_UNAVAILABLE", "Unexpected Paytm response")
        return data["body"]

    def create_link(self, db: Session, invoice: Invoice) -> LinkResult:
        body = self._post(f"{self.settings.paytm_link_host}/link/create", {
            "mid": self.mid,
            "linkType": "FIXED",
            "linkName": f"Saathi{invoice.invoice_number.replace('-', '')}"[:64],
            "linkDescription": f"Payment for {invoice.invoice_number}"[:30],
            "amount": f"{invoice.amount:.2f}",
            "bindLinkIdMobile": False,
            "partialPayment": False,
            "sendSms": False,
            "sendEmail": False,
        })
        result = body.get("resultInfo") or {}
        link_id, short_url = body.get("linkId"), body.get("shortUrl")
        if result.get("resultStatus") != "SUCCESS" or not link_id or not short_url:
            raise ApiError(502, "PROVIDER_UNAVAILABLE", f"Paytm Create Link failed: {result.get('resultMessage', 'no reason given')}")
        # shortUrl is the customer-facing link; longUrl must not be shared (Paytm docs).
        return LinkResult(str(link_id), short_url, self.mode)

    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        return self.parse_webhook(headers, body)[0]

    def parse_webhook(self, headers: dict[str, str], body: bytes) -> tuple[bool, WebhookEvent]:
        text = body.decode("utf-8", errors="replace")
        if text.lstrip().startswith("{"):
            try:
                data = json.loads(text)
            except ValueError:
                raise ApiError(400, "BAD_PAYLOAD", "Webhook body is not JSON")
        else:
            data = dict(parse_qsl(text, keep_blank_values=True))
        if not isinstance(data, dict):
            raise ApiError(400, "BAD_PAYLOAD", "Webhook body is not an object")
        checksum = str(data.pop("CHECKSUMHASH", "") or "")
        params = {k: str(v) for k, v in data.items()}
        try:
            ok = bool(checksum) and bool(self._verify(params, self.key, checksum))
        except Exception:  # malformed checksum must never pass
            ok = False
        order_id = data.get("ORDERID")
        # Link payments carry the link id; it is what we stored when the link was created.
        link_ref = data.get("LINKID") or data.get("linkId") or data.get("MERC_UNQ_REF")
        event = WebhookEvent(
            event_id=str(data.get("TXNID") or ""), order_ref=link_ref or order_id, provider_order_id=order_id,
            txn_id=data.get("TXNID"), amount=_amount(data.get("TXNAMOUNT")), status=data.get("STATUS"),
            payment_mode=data.get("PAYMENTMODE"), redacted=_redact(data),
        )
        return ok, event

    def fetch_status(self, db: Session, provider_order_id: str, paytm_order_id: str | None = None) -> StatusResult | None:
        if not paytm_order_id:
            return None
        body = self._post(f"{self.settings.paytm_status_host}/v3/order/status", {"mid": self.mid, "orderId": paytm_order_id})
        result = body.get("resultInfo") or {}
        if result.get("resultStatus") == "NO_RECORD_FOUND" or body.get("orderId") != paytm_order_id:
            return None
        amount = _amount(body.get("txnAmount"))
        if amount is None:
            return None
        # The status response is for Paytm's order id; it belongs to our link only because the signed
        # callback said so and the order id round-tripped, so report it against our stored reference.
        return StatusResult(body.get("mid", ""), provider_order_id, amount, result.get("resultStatus", ""), body.get("txnId"))


def get_adapter() -> DemoPaytmAdapter | StagingPaytmAdapter:
    return StagingPaytmAdapter() if get_settings().paytm_env == "staging" else DemoPaytmAdapter()
