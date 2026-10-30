"""Auth: password hashing, JWT issue/verify, and the merchant-scoped request context."""

import base64
import hashlib
import hmac
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Merchant, MerchantMembership, User

PBKDF2_ROUNDS = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return f"pbkdf2${PBKDF2_ROUNDS}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt_b64, digest_b64 = stored.split("$")
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), base64.b64decode(salt_b64), int(rounds))
        return hmac.compare_digest(digest, base64.b64decode(digest_b64))
    except ValueError:
        return False


def issue_token(user: User, merchant_id: uuid.UUID) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    claims = {
        "sub": str(user.id),
        "email": user.email,
        "mid": str(merchant_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_ttl_minutes)).timestamp()),
        "iss": "paytm-saathi",
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def _decode(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"], issuer="paytm-saathi")
    except jwt.ExpiredSignatureError as exc:
        raise ApiError(401, "SESSION_EXPIRED", "Session expired, please sign in again") from exc
    except jwt.InvalidTokenError:
        if settings.supabase_jwt_secret:
            try:
                return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
            except jwt.InvalidTokenError:
                pass
        raise ApiError(401, "UNAUTHENTICATED", "Invalid session token")


@dataclass
class Ctx:
    user: User
    merchant: Merchant
    role: str

    @property
    def merchant_id(self) -> uuid.UUID:
        return self.merchant.id

    @property
    def actor(self) -> str:
        return str(self.user.id)


def current_ctx(authorization: str | None = Header(default=None), db: Session = Depends(get_db)) -> Ctx:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "UNAUTHENTICATED", "Sign in required")
    claims = _decode(authorization.split(" ", 1)[1])
    user = db.scalar(select(User).where(User.email == claims.get("email")))
    if user is None:
        raise ApiError(401, "UNAUTHENTICATED", "Unknown user")
    query = select(MerchantMembership).where(
        MerchantMembership.user_id == user.id, MerchantMembership.status == "ACTIVE"
    )
    if claims.get("mid"):
        query = query.where(MerchantMembership.merchant_id == uuid.UUID(claims["mid"]))
    membership = db.scalars(query).first()
    if membership is None:
        raise ApiError(403, "FORBIDDEN", "No access to this merchant")
    merchant = db.get(Merchant, membership.merchant_id)
    return Ctx(user=user, merchant=merchant, role=membership.role)
