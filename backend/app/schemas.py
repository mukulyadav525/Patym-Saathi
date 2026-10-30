"""Request/response schemas. Money is serialised as a 2-decimal string to avoid float rounding."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

MoneyStr = str


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict[str, Any] = {}


class LoginRequest(BaseModel):
    email: str = Field(max_length=160)
    password: str = Field(max_length=200)


class MerchantOut(BaseModel):
    id: str
    display_name: str
    owner_name: str
    locality: str


class UserOut(BaseModel):
    id: str
    email: str
    display_name: str
    role: str


class LoginResponse(BaseModel):
    token: str
    user: UserOut
    merchant: MerchantOut
    demo_mode: bool


class Health(BaseModel):
    status: str
    version: str
    database: str
    paytm_mode: str
    voice: str


class InventoryItem(BaseModel):
    product_id: str
    sku: str
    name: str
    name_hi: str
    pack_label: str
    usable_packs: int
    avg_weekly: str
    sell_price: MoneyStr
    low: bool
    source: str
    updated_at: datetime


class InvoiceOut(BaseModel):
    id: str
    invoice_number: str
    customer_name: str
    customer_phone_masked: str
    amount: MoneyStr
    currency: str
    status: str
    due_date: date
    days_overdue: int
    link_url: str | None
    link_mode: str | None
    draft_message: str | None
    paid_at: datetime | None
    open_task_id: str | None


class OrderLineOut(BaseModel):
    product_id: str
    name: str
    pack_label: str
    packs: int
    unit_price: MoneyStr
    line_total: MoneyStr
    line_status: str


class OrderOut(BaseModel):
    id: str
    reference: str
    task_id: str
    supplier_name: str
    status: str
    connector_mode: str
    total: MoneyStr
    created_at: datetime
    lines: list[OrderLineOut]


class PlanLineOut(BaseModel):
    product_id: str
    name: str
    pack_label: str
    sold_per_week: str
    stock: int
    forecast: int
    packs: int
    supplier_name: str
    unit_price: MoneyStr
    line_total: MoneyStr
    status: str


class PlanDiff(BaseModel):
    name: str
    packs: int
    from_supplier: str | None
    from_unit_price: str | None
    to_supplier: str
    to_unit_price: str
    delta: MoneyStr


class PlanOut(BaseModel):
    id: str
    version: int
    status: str
    reason: str
    budget: MoneyStr
    total: MoneyStr
    committed_total: MoneyStr
    remaining_budget: MoneyStr
    total_packs: int
    lines: list[PlanLineOut]
    diff: list[PlanDiff]
    assumptions: list[str]
    sources: list[str]
    missing: list[str]
    created_at: datetime


class ApprovalOut(BaseModel):
    id: str
    task_id: str
    action_type: str
    status: str
    amount: MoneyStr
    currency: str
    expires_at: datetime
    approved_by: str | None
    approved_at: datetime | None
    created_at: datetime
    payload_hash_short: str
    plan_version: int | None
    summary: str


class AuditOut(BaseModel):
    id: str
    actor: str
    event_type: str
    entity_type: str
    entity_id: str
    summary: str
    task_id: str | None
    details: dict[str, Any]
    created_at: datetime


class TaskSummary(BaseModel):
    id: str
    task_type: str
    state: str
    title: str
    input_text: str
    input_channel: str
    result_note: str | None
    amount: MoneyStr | None
    pending_approval_id: str | None
    group: Literal["NEEDS_APPROVAL", "IN_PROGRESS", "DONE"]
    created_at: datetime
    updated_at: datetime


class TaskDetail(TaskSummary):
    parsed_intent: dict[str, Any]
    plans: list[PlanOut]
    approvals: list[ApprovalOut]
    orders: list[OrderOut]
    invoice: InvoiceOut | None
    events: list[AuditOut]
    time_to_plan_seconds: float | None


class BriefAction(BaseModel):
    type: str
    label: str
    invoice_id: str | None = None


class BriefPriority(BaseModel):
    kind: str
    severity: str
    title: str
    detail: str
    action: BriefAction | None
    sources: list[str]


class Brief(BaseModel):
    date: str
    priorities: list[BriefPriority]
    missing: list[str]


class ConnectionOut(BaseModel):
    source: str
    mode: str
    description: str
    status: str
    consent_granted_at: datetime | None
    last_sync_at: datetime | None


class DashboardOut(BaseModel):
    merchant: MerchantOut
    outstanding_dues: MoneyStr
    outstanding_count: int
    low_stock_count: int
    needs_approval: int
    in_progress: int
    last_week_sales: MoneyStr
    last_week_margin: MoneyStr
    brief: Brief
    connections: list[ConnectionOut]
    demo_mode: bool


class AssistantRequest(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    confirmed_budget: str | None = Field(default=None, max_length=12)


class AssistantResponse(BaseModel):
    reply: str
    intent: str
    transcript: str | None = None
    task: TaskDetail | None = None
    brief: Brief | None = None
    needs_confirmation: dict[str, Any] | None = None
    suggestions: list[str] = []


class SimulatePaymentRequest(BaseModel):
    amount: str | None = Field(default=None, max_length=12, description="Demo-only override to test mismatches")


class SimpleResult(BaseModel):
    ok: bool
    message: str
    outcome: str | None = None
    task_id: str | None = None


class ToolOut(BaseModel):
    name: str
    does: str
    source: str
    side_effect: str
    approval: str
    llm_callable: bool


class Page(BaseModel):
    items: list[AuditOut]
    next_cursor: str | None
