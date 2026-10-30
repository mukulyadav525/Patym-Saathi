"""The eight typed tools (deck slide 14). The agent touches data only through these.

- LLM may call: read tools and plan_restock (draft only).
- create_supplier_order / create_payment_link: only with a CONSUMED approval of the matching type.
- check_txn_status / update_invoice: system verification path only.
"""

import enum
from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import Approval


class Caller(str, enum.Enum):
    LLM = "llm"
    WORKFLOW = "workflow"
    APPROVED_EXECUTION = "approved_execution"
    VERIFICATION = "verification"


@dataclass(frozen=True)
class ToolSpec:
    name: str
    does: str
    source: str
    side_effect: str
    approval: str  # No | Yes | After verify
    allowed: frozenset[Caller]
    action_type: str | None = None


READ = frozenset({Caller.LLM, Caller.WORKFLOW})

TOOLS: dict[str, ToolSpec] = {t.name: t for t in [
    ToolSpec("get_sales_summary", "Sales by item and period", "Billing / POS (SAMPLE)", "None", "No", READ),
    ToolSpec("get_inventory", "Current stock levels", "Inventory (SAMPLE)", "None", "No", READ),
    ToolSpec("get_supplier_quotes", "Prices and availability", "Suppliers (SIMULATED)", "None", "No", READ),
    ToolSpec("plan_restock", "Order within the budget", "Tools above", "Draft", "No", READ),
    ToolSpec("create_supplier_order", "Places the approved order", "Suppliers (SIMULATED)", "Spends", "Yes",
             frozenset({Caller.APPROVED_EXECUTION}), "SUPPLIER_ORDER"),
    ToolSpec("create_payment_link", "Paytm link for an invoice", "Paytm Link API (DEMO)", "Sends", "Yes",
             frozenset({Caller.APPROVED_EXECUTION}), "PAYMENT_LINK"),
    ToolSpec("check_txn_status", "Verifies payment status", "Paytm Status API (DEMO)", "None", "No",
             frozenset({Caller.VERIFICATION})),
    ToolSpec("update_invoice", "Marks invoice paid", "Billing", "Writes", "After verify",
             frozenset({Caller.VERIFICATION})),
]}


def authorize(name: str, caller: Caller, approval: Approval | None = None) -> ToolSpec:
    spec = TOOLS.get(name)
    if spec is None:
        raise ApiError(400, "UNKNOWN_TOOL", f"Unknown tool {name}")
    if caller not in spec.allowed:
        raise ApiError(403, "TOOL_FORBIDDEN", f"{caller.value} may not call {name}")
    if spec.approval == "Yes":
        if approval is None or approval.status != "CONSUMED" or approval.consumed_at is None:
            raise ApiError(403, "APPROVAL_REQUIRED", f"{name} needs a confirmed approval")
        if approval.action_type != spec.action_type:
            raise ApiError(403, "APPROVAL_MISMATCH", f"Approval is not for {name}")
    return spec


def invoke(db: Session, name: str, caller: Caller, approval: Approval | None = None, **kwargs: Any) -> Any:
    authorize(name, caller, approval)
    return _IMPL[name](db, approval=approval, **kwargs)


def _create_supplier_order(db: Session, approval: Approval, task, actor: str, **_: Any):
    from app.services import restock_flow

    return restock_flow.execute_order(db, task, approval, actor)


def _create_payment_link(db: Session, approval: Approval, task, actor: str, **_: Any):
    from app.services import dues_flow

    return dues_flow.execute_link(db, task, approval, actor)


def _read(fn_name: str) -> Callable:
    def call(db: Session, merchant_id, approval=None, **_: Any):
        from app.services import restock_flow

        return getattr(restock_flow, fn_name)(db, merchant_id)

    return call


_IMPL: dict[str, Callable] = {
    "get_sales_summary": _read("sales_summary"),
    "get_inventory": _read("inventory_snapshot"),
    "get_supplier_quotes": _read("supplier_quotes"),
    "create_supplier_order": _create_supplier_order,
    "create_payment_link": _create_payment_link,
}


def catalogue() -> list[dict]:
    return [
        {"name": t.name, "does": t.does, "source": t.source, "side_effect": t.side_effect, "approval": t.approval,
         "llm_callable": Caller.LLM in t.allowed}
        for t in TOOLS.values()
    ]
