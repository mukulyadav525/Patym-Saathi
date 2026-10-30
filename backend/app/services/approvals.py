"""Approval confirm/reject: authenticated, bound to payload hash, single-use, idempotent, expiring."""

import hashlib
import uuid
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import Approval, IdempotencyRecord, Task, utcnow
from app.security import Ctx
from app.services import audit, dues_flow, restock_flow
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


def confirm(db: Session, ctx: Ctx, approval_id: uuid.UUID, idempotency_key: str) -> uuid.UUID:
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

    approval = _load(db, ctx, approval_id)  # row lock serialises concurrent confirms
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
    db.commit()
    return task.id
