"""Live feed: what just happened at the counter, for the app, the dashboard and the Soundbox.

Rows in live_events are ordered by id. Clients remember the last id they saw and long-poll for newer ones, so
updates arrive within a second without websockets (works the same through proxies, on phones and in Safari)."""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import LiveEvent

MAX_BATCH = 50


def publish(db: Session, merchant_id: uuid.UUID, kind: str, title: str, body: str = "",
            announce: str | None = None, data: dict | None = None) -> LiveEvent:
    """Added in the caller's transaction: subscribers see the event only if the change itself commits."""
    event = LiveEvent(merchant_id=merchant_id, kind=kind, title=title[:160], body=body[:300],
                      announce=announce[:300] if announce else None, data=data or {})
    db.add(event)
    db.flush()
    return event


def latest_id(merchant_id: uuid.UUID) -> int:
    with SessionLocal() as db:
        return db.scalar(select(LiveEvent.id).where(LiveEvent.merchant_id == merchant_id)
                         .order_by(LiveEvent.id.desc()).limit(1)) or 0


def since(merchant_id: uuid.UUID, after: int) -> list[LiveEvent]:
    # A short session per check, so a waiting client never holds a database connection.
    with SessionLocal() as db:
        return list(db.scalars(select(LiveEvent).where(LiveEvent.merchant_id == merchant_id, LiveEvent.id > after)
                               .order_by(LiveEvent.id).limit(MAX_BATCH)))
