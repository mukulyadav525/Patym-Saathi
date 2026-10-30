import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditEvent

SENSITIVE_KEYS = {"signature", "checksum", "password", "token", "key", "secret", "phone"}


def redact(details: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in details.items():
        if any(s in key.lower() for s in SENSITIVE_KEYS):
            out[key] = "[redacted]"
        elif isinstance(value, dict):
            out[key] = redact(value)
        else:
            out[key] = value
    return out


def record(
    db: Session,
    merchant_id: uuid.UUID,
    actor: str,
    event_type: str,
    entity_type: str,
    entity_id: Any,
    summary: str,
    task_id: uuid.UUID | None = None,
    details: dict[str, Any] | None = None,
    correlation_id: str | None = None,
) -> AuditEvent:
    event = AuditEvent(
        merchant_id=merchant_id,
        actor=actor,
        task_id=task_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=str(entity_id),
        summary=summary,
        details_redacted=redact(details or {}),
        correlation_id=correlation_id,
    )
    db.add(event)
    db.flush()
    return event
