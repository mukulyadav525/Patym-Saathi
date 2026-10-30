"""Paytm payment adapters.

DemoPaytmAdapter (default, PAYTM_ENV=demo): issues clearly-labelled DEMO links, signs simulated
webhooks with DEMO_WEBHOOK_KEY (HMAC-SHA256) and answers status lookups from `demo_provider_txns`,
standing in for Paytm's Transaction Status API. No money moves.

StagingPaytmAdapter (PAYTM_ENV=staging): requires PAYTM_MID, PAYTM_MERCHANT_KEY and the official
`paytmchecksum` package. Not exercised without credentials; it refuses to run rather than pretend.
"""

import hashlib
import hmac
import json
import uuid
from dataclasses import dataclass
from decimal import Decimal

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

    def fetch_status(self, db: Session, provider_order_id: str) -> StatusResult | None:
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

    def __init__(self) -> None:
        settings = get_settings()
        if not settings.paytm_merchant_key or not settings.paytm_mid:
            raise ApiError(503, "PROVIDER_UNAVAILABLE", "Paytm staging credentials are not configured")
        try:
            import paytmchecksum  # noqa: F401
        except ImportError as exc:
            raise ApiError(503, "PROVIDER_UNAVAILABLE", "paytmchecksum package not installed") from exc

    def create_link(self, db: Session, invoice: Invoice) -> LinkResult:
        raise ApiError(503, "PROVIDER_UNAVAILABLE", "Paytm staging Create Link is not enabled in this build")

    def verify_webhook(self, headers: dict[str, str], body: bytes) -> bool:
        return False

    def fetch_status(self, db: Session, provider_order_id: str) -> StatusResult | None:
        raise ApiError(503, "PROVIDER_UNAVAILABLE", "Paytm staging Status API is not enabled in this build")


def get_adapter() -> DemoPaytmAdapter | StagingPaytmAdapter:
    return StagingPaytmAdapter() if get_settings().paytm_env == "staging" else DemoPaytmAdapter()
