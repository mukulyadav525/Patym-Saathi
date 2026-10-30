"""Dues collection (prd.txt §5.2). Invoice reaches PAID only through `process_webhook`:
signature -> dedupe -> server-side status fetch -> 4-field check (MID, order ID, amount, status)."""

from datetime import timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.adapters.paytm import SUCCESS, DemoPaytmAdapter, get_adapter
from app.config import get_settings
from app.errors import ApiError
from app.models import Approval, Invoice, Merchant, PaymentEvent, Task, utcnow
from app.services import audit
from app.services.common import canonical_hash, move_invoice, move_task
from app.tools import registry
from app.tools.registry import Caller

COLLECTABLE = ("PENDING", "FAILED", "EXPIRED")


def draft_message(invoice: Invoice, merchant: Merchant) -> str:
    return (
        f"Namaste {invoice.customer_name} ji, {merchant.display_name} ka ₹{invoice.amount:,.0f} ka bill "
        f"({invoice.invoice_number}) pending hai. Is Paytm link se UPI dwara payment kar dijiye. Dhanyavaad!"
    )


def approval_payload(task: Task, invoice: Invoice) -> dict:
    return {
        "merchant_id": str(invoice.merchant_id),
        "task_id": str(task.id),
        "invoice_id": str(invoice.id),
        "action_type": "PAYMENT_LINK",
        "invoice_number": invoice.invoice_number,
        "customer": invoice.customer_name,
        "amount": f"{invoice.amount:.2f}",
        "currency": invoice.currency,
        "message": invoice.draft_message,
        "link_mode": get_adapter_mode(),
    }


def get_adapter_mode() -> str:
    return "STAGING" if get_settings().paytm_env == "staging" else "DEMO"


def start_collect(db: Session, task: Task, invoice: Invoice, merchant: Merchant, actor: str) -> Approval:
    if invoice.status not in COLLECTABLE:
        raise ApiError(409, "INVALID_TRANSITION", f"{invoice.invoice_number} is {invoice.status}; nothing to collect")
    task.invoice_id = invoice.id
    move_task(db, task, "UNDERSTANDING", "saathi", f"Understood: collect {invoice.invoice_number}")
    move_task(db, task, "EVIDENCE_READY", "saathi",
              f"Found {invoice.invoice_number}, {invoice.customer_name}, ₹{invoice.amount:,.2f}, due {invoice.due_date}")
    invoice.draft_message = draft_message(invoice, merchant)
    move_invoice(db, invoice, "DRAFTED", "saathi", "Payment link and message drafted", task_id=task.id)
    move_task(db, task, "PLAN_DRAFTED", "saathi", "Drafted payment link and customer message")
    payload = approval_payload(task, invoice)
    approval = Approval(
        merchant_id=task.merchant_id, task_id=task.id, invoice_id=invoice.id, action_type="PAYMENT_LINK",
        payload_hash=canonical_hash(payload), payload_snapshot=payload, amount=invoice.amount,
        expires_at=utcnow() + timedelta(minutes=get_settings().approval_ttl_minutes), status="PENDING",
    )
    db.add(approval)
    db.flush()
    audit.record(db, task.merchant_id, "saathi", "APPROVAL_REQUESTED", "approval", approval.id,
                 f"Approval needed to send a ₹{invoice.amount:,.2f} payment link", task_id=task.id)
    move_task(db, task, "AWAITING_APPROVAL", "saathi", "Waiting for merchant approval")
    return approval


def recompute_hash(db: Session, approval: Approval) -> str:
    task = db.get(Task, approval.task_id)
    invoice = db.get(Invoice, approval.invoice_id)
    if invoice.status != "DRAFTED":
        raise ApiError(409, "APPROVAL_SUPERSEDED", "Invoice changed since the draft")
    return canonical_hash(approval_payload(task, invoice))


def execute_link(db: Session, task: Task, approval: Approval, actor: str) -> dict:
    invoice = db.get(Invoice, approval.invoice_id)
    move_task(db, task, "APPROVED", actor, f"Merchant approved payment link for ₹{invoice.amount:,.2f}")
    move_task(db, task, "EXECUTING", "saathi", "Creating payment link")
    move_invoice(db, invoice, "APPROVED", actor, "Link approved", task_id=task.id)
    adapter = get_adapter()
    link = adapter.create_link(db, invoice)
    invoice.provider_order_id = link.provider_order_id
    invoice.link_url = link.link_url
    invoice.link_mode = link.mode
    audit.record(db, task.merchant_id, "saathi", "PAYMENT_LINK_CREATED", "invoice", invoice.id,
                 f"{link.mode} payment link created for {invoice.invoice_number}", task_id=task.id,
                 details={"tool": "create_payment_link", "order_id": link.provider_order_id, "mode": link.mode})
    move_invoice(db, invoice, "SENT", "saathi", "Link ready to share with customer", task_id=task.id)
    move_task(db, task, "VERIFYING", "saathi", "Waiting for verified payment")
    return {"link_url": link.link_url, "mode": link.mode}


def reject(db: Session, task: Task, approval: Approval, actor: str) -> None:
    invoice = db.get(Invoice, approval.invoice_id)
    move_invoice(db, invoice, "PENDING", actor, "Draft discarded", task_id=task.id)
    move_task(db, task, "CANCELLED", actor, "Merchant rejected the payment link")


# ---------- verification path (system only) ----------

def _task_for(db: Session, invoice: Invoice) -> Task | None:
    return db.scalars(
        select(Task).where(Task.invoice_id == invoice.id, Task.state == "VERIFYING").order_by(Task.created_at.desc())
    ).first()


def process_webhook(db: Session, headers: dict[str, str], body: bytes) -> dict:
    adapter = get_adapter()
    signature_ok, evt = adapter.parse_webhook({k.lower(): v for k, v in headers.items()}, body)
    if not evt.event_id:
        raise ApiError(400, "BAD_PAYLOAD", "Missing event id")
    if db.scalar(select(PaymentEvent.id).where(PaymentEvent.provider_event_id == evt.event_id)):
        return {"outcome": "DUPLICATE_IGNORED"}

    event = PaymentEvent(provider="PAYTM_" + adapter.mode, provider_event_id=evt.event_id,
                         provider_order_id=evt.provider_order_id, txn_id=evt.txn_id, amount=evt.amount,
                         provider_status=evt.status, signature_verified=signature_ok,
                         raw_payload_redacted=evt.redacted)
    db.add(event)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return {"outcome": "DUPLICATE_IGNORED"}

    invoice = db.scalars(select(Invoice).where(Invoice.provider_order_id == evt.order_ref)).first() if evt.order_ref else None
    if invoice is not None:
        event.merchant_id = invoice.merchant_id
        event.invoice_id = invoice.id
    if not signature_ok:
        event.outcome = "SIGNATURE_INVALID"
        event.processed_at = utcnow()
        if invoice is not None:
            audit.record(db, invoice.merchant_id, "system", "WEBHOOK_REJECTED", "invoice", invoice.id,
                         "Webhook signature invalid; ignored")
        return {"outcome": event.outcome}
    if invoice is None:
        event.outcome = "UNKNOWN_ORDER"
        event.processed_at = utcnow()
        return {"outcome": event.outcome}

    task = _task_for(db, invoice)
    task_id = task.id if task else None
    audit.record(db, invoice.merchant_id, "system", "WEBHOOK_RECEIVED", "invoice", invoice.id,
                 f"Signed payment webhook received for {invoice.invoice_number}", task_id=task_id)
    if invoice.status != "SENT":
        event.outcome = f"IGNORED_{invoice.status}"
        event.processed_at = utcnow()
        return {"outcome": event.outcome}

    registry.authorize("check_txn_status", Caller.VERIFICATION)
    status = adapter.fetch_status(db, invoice.provider_order_id, evt.provider_order_id)
    event.status_api_verified = status is not None
    merchant = db.get(Merchant, invoice.merchant_id)
    checks = {
        "mid": bool(status) and status.mid == merchant.paytm_mid,
        "order_id": bool(status) and status.order_id == invoice.provider_order_id,
        "amount": bool(status) and Decimal(status.amount).quantize(Decimal("0.01")) == invoice.amount,
        "status": bool(status) and status.status == SUCCESS,
    }
    audit.record(db, invoice.merchant_id, "system", "STATUS_CHECKED", "invoice", invoice.id,
                 f"Status API checked: {sum(checks.values())}/4 fields match", task_id=task_id,
                 details={"tool": "check_txn_status", "checks": checks})
    event.processed_at = utcnow()

    if all(checks.values()):
        move_invoice(db, invoice, "VERIFIED", "system", "4 checks passed (MID, order, amount, status)", task_id=task_id)
        mark_paid(db, invoice, task)
        event.outcome = "PAID"
    elif status is not None and status.status != SUCCESS and checks["order_id"]:
        move_invoice(db, invoice, "FAILED", "system", f"Payment {status.status}", task_id=task_id)
        if task:
            move_task(db, task, "FAILED", "system", "Payment failed")
        event.outcome = "FAILED"
    else:
        move_invoice(db, invoice, "RECONCILIATION_REQUIRED", "system",
                     "Payment details did not match; not marked paid", task_id=task_id, details={"checks": checks})
        if task:
            task.result_note = "Reconciliation required: payment details did not match the invoice"
        event.outcome = "RECONCILIATION_REQUIRED"
    return {"outcome": event.outcome, "checks": checks}


def mark_paid(db: Session, invoice: Invoice, task: Task | None) -> None:
    """Tool update_invoice: system-only, after verification."""
    registry.authorize("update_invoice", Caller.VERIFICATION)
    if invoice.status != "VERIFIED":
        raise ApiError(409, "INVALID_TRANSITION", "Invoice must be verified before it is marked paid")
    invoice.paid_at = utcnow()
    move_invoice(db, invoice, "PAID", "system", f"{invoice.invoice_number} marked paid after verification",
                 task_id=task.id if task else None, details={"tool": "update_invoice"})
    if task:
        task.result_note = f"₹{invoice.amount:,.2f} received from {invoice.customer_name} and verified"
        move_task(db, task, "COMPLETED", "system", task.result_note)


def simulate_payment(db: Session, invoice: Invoice, amount: Decimal | None = None) -> dict:
    adapter = get_adapter()
    if not isinstance(adapter, DemoPaytmAdapter):
        raise ApiError(400, "NOT_DEMO", "Payment simulation is only available with the DEMO adapter")
    if invoice.status != "SENT":
        raise ApiError(409, "INVALID_TRANSITION", f"{invoice.invoice_number} has no link awaiting payment")
    body, headers = adapter.simulate_customer_payment(db, invoice, amount if amount is not None else invoice.amount)
    return process_webhook(db, headers, body)
