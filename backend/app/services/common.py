"""Shared helpers: canonical hashing and audited state changes."""

import hashlib
import json
import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models import Invoice, Order, Task, utcnow
from app.services import audit, states


def _default(value: Any) -> str:
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, uuid.UUID):
        return str(value)
    raise TypeError(f"Cannot hash {type(value)}")


def canonical_hash(payload: dict[str, Any]) -> str:
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=_default, ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


def new_correlation_id() -> str:
    return uuid.uuid4().hex[:16]


def move_task(db: Session, task: Task, target: str, actor: str, summary: str, details: dict | None = None) -> None:
    states.check(states.TASK, task.state, target, "Task")
    previous = task.state
    task.state = target
    task.updated_at = utcnow()
    audit.record(
        db, task.merchant_id, actor, "TASK_STATE", "task", task.id, summary, task_id=task.id,
        details={"from": previous, "to": target, **(details or {})}, correlation_id=task.correlation_id,
    )


def move_order(db: Session, order: Order, target: str, actor: str, summary: str, details: dict | None = None) -> None:
    states.check(states.ORDER, order.status, target, "Order")
    previous = order.status
    order.status = target
    order.updated_at = utcnow()
    audit.record(
        db, order.merchant_id, actor, "ORDER_STATE", "order", order.id, summary, task_id=order.task_id,
        details={"from": previous, "to": target, "reference": order.reference, **(details or {})},
    )


def move_invoice(
    db: Session, invoice: Invoice, target: str, actor: str, summary: str,
    task_id: uuid.UUID | None = None, details: dict | None = None,
) -> None:
    states.check(states.INVOICE, invoice.status, target, "Invoice")
    previous = invoice.status
    invoice.status = target
    invoice.updated_at = utcnow()
    audit.record(
        db, invoice.merchant_id, actor, "INVOICE_STATE", "invoice", invoice.id, summary, task_id=task_id,
        details={"from": previous, "to": target, "invoice": invoice.invoice_number, **(details or {})},
    )
