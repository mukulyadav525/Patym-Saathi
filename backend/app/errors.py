from decimal import Decimal, InvalidOperation
from typing import Any


class ApiError(Exception):
    """Typed API error rendered as {code, message, details}."""

    def __init__(self, status: int, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details or {}


def parse_money(value: object, field: str, minimum: str = "0", maximum: str = "10000000") -> Decimal:
    """Strict rupee parser for anything a client sends: finite, within range, 2 decimals. Raises a 422
    ApiError (never a 500) for NaN, Infinity, words, or out-of-range values."""
    text = str(value).replace(",", "").replace("₹", "").strip()
    try:
        amount = Decimal(text)
    except InvalidOperation as exc:
        raise ApiError(422, "BAD_AMOUNT", f"{field} must be a number") from exc
    if not amount.is_finite():
        raise ApiError(422, "BAD_AMOUNT", f"{field} must be a number")
    if not Decimal(minimum) <= amount <= Decimal(maximum):
        raise ApiError(422, "BAD_AMOUNT", f"{field} must be between ₹{Decimal(minimum):,.0f} and ₹{Decimal(maximum):,.0f}")
    return amount.quantize(Decimal("0.01"))
