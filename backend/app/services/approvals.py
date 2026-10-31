"""Approval confirm/reject: authenticated, bound to payload hash, single-use, idempotent, expiring."""

import hashlib
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.errors import ApiError
from app.models import Approval, IdempotencyRecord, Plan, Task, User, utcnow
from app.security import Ctx, verify_password
from app.services import audit, dues_flow, live, restock_flow
from app.tools import registry

OPERATION = "approval_confirm"


def _load(db: Session, ctx: Ctx, approval_id: uuid.UUID, lock: bool = True) -> Approval:
    query = select(Approval).where(Approval.id == approval_id, Approval.merchant_id == ctx.merchant_id)
    if lock:
        query = query.with_for_update()
    approval = db.scalars(query).first()
    if approval is None:
        raise ApiError(404, "NOT_FOUND", "Approval not found")
    return approval


def _check_usable(db: Session, approval: Approval) -> None:
    if approval.status == "CONSUMED":
        raise ApiError(409, "APPROVAL_ALREADY_USED", "This approval was already used")
    if approval.status == "SUPERSEDED":
        raise ApiError(409, "APPROVAL_SUPERSEDED", "The plan changed; review and approve the new plan")
    if approval.status == "REJECTED":
        raise ApiError(409, "APPROVAL_REJECTED", "This approval was rejected")
    if approval.status == "EXPIRED" or approval.expires_at <= utcnow():
        approval.status = "EXPIRED"
        db.commit()
        raise ApiError(409, "APPROVAL_EXPIRED", "Approval expired; please review again")


PIN_MAX_TRIES = 5
PIN_LOCK = timedelta(minutes=10)


def check_pin(db: Session, ctx: Ctx, pin: str | None) -> None:
    """Optional approval PIN. Wrong tries are counted and committed even though the request fails."""
    user = db.get(User, ctx.user.id, with_for_update=True)
    if not user.approval_pin_hash:
        return
    now = utcnow()
    if user.pin_locked_until and user.pin_locked_until > now:
        raise ApiError(423, "PIN_LOCKED", "Too many wrong PINs. Try again in a few minutes")
    if not pin:
        raise ApiError(403, "PIN_REQUIRED", "Enter your approval PIN")
    if verify_password(pin, user.approval_pin_hash):
        user.pin_failed_count = 0
        return
    user.pin_failed_count += 1
    if user.pin_failed_count >= PIN_MAX_TRIES:
        user.pin_failed_count, user.pin_locked_until = 0, now + PIN_LOCK
        audit.record(db, ctx.merchant_id, ctx.actor, "APPROVAL_PIN_LOCKED", "user", user.id,
                     "Approval PIN locked after repeated wrong attempts")
    db.commit()
    raise ApiError(403, "PIN_INVALID", "Wrong approval PIN")


def _completed_record(db: Session, ctx: Ctx, key: str, request_hash: str) -> uuid.UUID | None:
    rec = db.scalars(select(IdempotencyRecord).where(
        IdempotencyRecord.merchant_id == ctx.merchant_id, IdempotencyRecord.operation == OPERATION,
        IdempotencyRecord.key == key)).first()
    if rec is None:
        return None
    if rec.request_hash != request_hash:
        raise ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key already used for another request")
    return uuid.UUID(rec.result_ref) if rec.status == "COMPLETED" and rec.result_ref else None


def confirm(db: Session, ctx: Ctx, approval_id: uuid.UUID, idempotency_key: str, pin: str | None = None) -> uuid.UUID:
    if not idempotency_key or len(idempotency_key) > 120:
        raise ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required")
    request_hash = hashlib.sha256(f"{approval_id}".encode()).hexdigest()
    existing = db.scalars(select(IdempotencyRecord).where(
        IdempotencyRecord.merchant_id == ctx.merchant_id, IdempotencyRecord.operation == OPERATION,
        IdempotencyRecord.key == idempotency_key)).first()
    if existing:
        if existing.request_hash != request_hash:
            raise ApiError(409, "IDEMPOTENCY_KEY_REUSED", "Idempotency key already used for another request")
        if existing.status == "COMPLETED":
            return uuid.UUID(existing.result_ref)

    check_pin(db, ctx, pin)
    approval = _load(db, ctx, approval_id)  # row lock serialises concurrent confirms
    # A retry of the same tap may have waited on the lock while the first request completed: answer it with
    # the same result instead of "already used".
    done = _completed_record(db, ctx, idempotency_key, request_hash)
    if done is not None:
        return done
    _check_usable(db, approval)
    if approval.action_type == "SUPPLIER_ORDER":
        current_hash = restock_flow.recompute_hash(db, approval)
    else:
        current_hash = dues_flow.recompute_hash(db, approval)
    if current_hash != approval.payload_hash:
        approval.status = "SUPERSEDED"
        db.commit()
        raise ApiError(409, "HASH_MISMATCH", "What you approved no longer matches the current plan")

    now = utcnow()
    approval.status = "CONSUMED"
    approval.approved_by = ctx.user.id
    approval.approved_at = now
    approval.consumed_at = now
    task = db.get(Task, approval.task_id)
    audit.record(db, ctx.merchant_id, ctx.actor, "APPROVAL_CONFIRMED", "approval", approval.id,
                 f"{ctx.user.display_name} approved ₹{approval.amount:,.2f}", task_id=task.id,
                 details={"payload_hash": approval.payload_hash[:12], "action": approval.action_type})

    tool = "create_supplier_order" if approval.action_type == "SUPPLIER_ORDER" else "create_payment_link"
    registry.invoke(db, tool, caller=registry.Caller.APPROVED_EXECUTION, approval=approval, task=task, actor=ctx.actor)
    done = ("order supplier ko bhej diya" if approval.action_type == "SUPPLIER_ORDER" else "payment link taiyar hai")
    live.publish(db, ctx.merchant_id, "APPROVED", f"Approved: {task.title}", f"₹{approval.amount:,.0f} · by {ctx.user.display_name}",
                 announce=f"{task.title}: {approval.amount:,.0f} rupaye ka approval mil gaya, {done}.",
                 data={"task_id": str(task.id), "amount": f"{approval.amount:.2f}"})

    db.add(IdempotencyRecord(merchant_id=ctx.merchant_id, operation=OPERATION, key=idempotency_key,
                             request_hash=request_hash, status="COMPLETED", result_ref=str(task.id),
                             expires_at=now + timedelta(days=1)))
    db.commit()
    return task.id


def reject(db: Session, ctx: Ctx, approval_id: uuid.UUID) -> uuid.UUID:
    approval = _load(db, ctx, approval_id)
    if approval.status != "PENDING":
        _check_usable(db, approval)
    approval.status = "REJECTED"
    task = db.get(Task, approval.task_id)
    audit.record(db, ctx.merchant_id, ctx.actor, "APPROVAL_REJECTED", "approval", approval.id,
                 f"{ctx.user.display_name} rejected ₹{approval.amount:,.2f}", task_id=task.id)
    if approval.action_type == "SUPPLIER_ORDER":
        restock_flow.reject(db, task, approval, ctx.actor)
    else:
        dues_flow.reject(db, task, approval, ctx.actor)
    live.publish(db, ctx.merchant_id, "REJECTED", f"Rejected: {task.title}", f"₹{approval.amount:,.0f} · nothing was ordered or sent",
                 data={"task_id": str(task.id)})
    db.commit()
    return task.id


def renew(db: Session, ctx: Ctx, task_id: uuid.UUID) -> uuid.UUID:
    """Fresh approval window for the same, unchanged action after the old one expired.
    The payload is re-checked first; if anything changed, the old approval is superseded instead."""
    task = db.scalars(select(Task).where(Task.id == task_id, Task.merchant_id == ctx.merchant_id)
                      .with_for_update()).first()
    if task is None:
        raise ApiError(404, "NOT_FOUND", "Task not found")
    old = db.scalars(select(Approval).where(Approval.task_id == task.id, Approval.status.in_(("PENDING", "EXPIRED")))
                     .order_by(Approval.created_at.desc()).with_for_update()).first()
    if task.state != "AWAITING_APPROVAL" or old is None:
        raise ApiError(409, "INVALID_TRANSITION", "Nothing is waiting for approval on this task")
    now = utcnow()
    stale_quotes = False
    if old.action_type == "SUPPLIER_ORDER":
        plan = db.get(Plan, old.plan_id)
        stale_quotes = plan is not None and plan.status == "ACTIVE" and restock_flow.quotes_stale(db, plan)
    if old.status == "PENDING" and old.expires_at > now and not stale_quotes:
        return task.id  # still valid; nothing to renew
    if old.action_type == "SUPPLIER_ORDER":
        plan = db.get(Plan, old.plan_id)
        if plan is not None and plan.status == "ACTIVE" and restock_flow.quotes_stale(db, plan):
            # Same request, but supplier prices moved on: new plan, new approval (old one is superseded).
            restock_flow.refresh_plan(db, task, ctx.actor)
            db.commit()
            return task.id
    current = (restock_flow.recompute_hash(db, old) if old.action_type == "SUPPLIER_ORDER"
               else dues_flow.recompute_hash(db, old))
    if current != old.payload_hash:
        old.status = "SUPERSEDED"
        db.commit()
        raise ApiError(409, "HASH_MISMATCH", "The plan changed since it was drafted; ask Saathi for a fresh plan")
    old.status = "EXPIRED"
    fresh = Approval(
        merchant_id=old.merchant_id, task_id=old.task_id, plan_id=old.plan_id, invoice_id=old.invoice_id,
        action_type=old.action_type, payload_hash=old.payload_hash, payload_snapshot=old.payload_snapshot,
        amount=old.amount, currency=old.currency, status="PENDING",
        expires_at=now + timedelta(minutes=get_settings().approval_ttl_minutes),
    )
    db.add(fresh)
    db.flush()
    audit.record(db, ctx.merchant_id, ctx.actor, "APPROVAL_RENEWED", "approval", fresh.id,
                 f"Approval window renewed for the same ₹{old.amount:,.2f} (unchanged)", task_id=task.id)
    live.approval_needed(db, ctx.merchant_id, task.id, task.title, fresh.amount, fresh.id)
    db.commit()
    return task.id
