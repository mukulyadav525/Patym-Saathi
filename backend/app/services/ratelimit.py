"""Per-merchant fixed-window rate limits for endpoints that spend Sarvam credits or do heavy work.
Counters live in Postgres so every API instance shares them, and are committed on their own connection
so a request that fails after the paid call still counts."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, text

from app.db import SessionLocal
from app.errors import ApiError
from app.models import RateLimit

# bucket: (max requests, window seconds)
LIMITS: dict[str, tuple[int, int]] = {
    "voice": (120, 3600),         # speech-to-text
    "speech": (120, 3600),        # text-to-speech (brief, read-back)
    "translate": (200, 3600),
    "bill_scan": (40, 3600),      # Document AI jobs
    "assistant": (600, 3600),     # may call the LLM
    "scan": (60, 3600),           # proactive check
    "soundbox": (1500, 3600),     # always-on counter listening: every utterance is transcribed to find "Saathi"
    "qr_pay": (300, 3600),        # DEMO QR payments
}


def check(merchant_id: uuid.UUID, bucket: str) -> None:
    limit, window = LIMITS[bucket]
    now = datetime.now(timezone.utc)
    start = datetime.fromtimestamp(int(now.timestamp()) // window * window, tz=timezone.utc)
    key = f"{bucket}:{merchant_id}"
    with SessionLocal() as db:
        count = db.execute(text(
            "INSERT INTO rate_limits (id, bucket_key, window_start, count) VALUES (:id, :key, :start, 1) "
            "ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = rate_limits.count + 1 RETURNING count"
        ), {"id": uuid.uuid4(), "key": key, "start": start}).scalar_one()
        # Opportunistic cleanup of old windows (cheap, indexed).
        if count == 1:
            db.execute(delete(RateLimit).where(RateLimit.window_start < now - timedelta(days=2)))
        db.commit()
    if count > limit:
        retry = int((start + timedelta(seconds=window) - now).total_seconds()) + 1
        raise ApiError(429, "RATE_LIMITED", "Too many requests right now; please try again a little later",
                       {"retry_after_seconds": retry})
