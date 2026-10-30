"""Allowed state transitions (trd.txt §5). Every change goes through `transition`."""

from app.errors import ApiError

TASK = {
    "NEW": {"UNDERSTANDING", "FAILED"},
    "UNDERSTANDING": {"EVIDENCE_READY", "FAILED", "CANCELLED"},
    "EVIDENCE_READY": {"PLAN_DRAFTED", "COMPLETED", "FAILED"},
    "PLAN_DRAFTED": {"AWAITING_APPROVAL", "FAILED"},
    "AWAITING_APPROVAL": {"APPROVED", "CANCELLED", "VERIFYING", "PLAN_DRAFTED", "FAILED"},
    "APPROVED": {"EXECUTING", "FAILED"},
    "EXECUTING": {"EXCEPTION", "VERIFYING", "FAILED"},
    "EXCEPTION": {"PLAN_DRAFTED", "VERIFYING", "FAILED"},
    "VERIFYING": {"COMPLETED", "PARTIALLY_COMPLETED", "FAILED"},
    "COMPLETED": set(),
    "PARTIALLY_COMPLETED": set(),
    "CANCELLED": set(),
    "FAILED": set(),
}

ORDER = {
    "DRAFT": {"AWAITING_APPROVAL", "CANCELLED"},
    "AWAITING_APPROVAL": {"APPROVED", "CANCELLED"},
    "APPROVED": {"SUBMITTED", "FAILED"},
    "SUBMITTED": {"ACCEPTED", "PARTIALLY_ACCEPTED", "FAILED", "CANCELLED"},
    "ACCEPTED": {"GOODS_RECEIVED", "CANCELLED"},
    "PARTIALLY_ACCEPTED": {"GOODS_RECEIVED", "CANCELLED"},
    "GOODS_RECEIVED": set(),
    "CANCELLED": set(),
    "FAILED": set(),
}

INVOICE = {
    "PENDING": {"DRAFTED", "CANCELLED"},
    "DRAFTED": {"APPROVED", "PENDING", "CANCELLED"},
    "APPROVED": {"SENT", "FAILED"},
    "SENT": {"VERIFIED", "FAILED", "EXPIRED", "RECONCILIATION_REQUIRED", "CANCELLED"},
    "VERIFIED": {"PAID"},
    "PAID": {"REFUNDED"},
    "FAILED": {"DRAFTED"},
    "EXPIRED": {"DRAFTED"},
    "RECONCILIATION_REQUIRED": {"VERIFIED", "FAILED"},
    "CANCELLED": set(),
    "REFUNDED": set(),
}

# Money still owed by the customer: everything except PAID / VERIFIED / CANCELLED / REFUNDED.
UNPAID = ("PENDING", "DRAFTED", "APPROVED", "SENT", "FAILED", "EXPIRED", "RECONCILIATION_REQUIRED")

TERMINAL_TASK = {"COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "FAILED"}


def check(machine: dict[str, set[str]], current: str, target: str, kind: str) -> None:
    if target not in machine.get(current, set()):
        raise ApiError(409, "INVALID_TRANSITION", f"{kind} cannot move from {current} to {target}")
