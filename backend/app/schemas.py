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
    has_approval_pin: bool = False


class ApprovalPinRequest(BaseModel):
    password: str = Field(min_length=1, max_length=200)
    pin: str | None = Field(default=None, pattern=r"^\d{4}$", description="null clears the PIN")


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
    uplift: str | None = None


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
    festival: str | None = None
    festival_evidence: list[dict[str, Any]] = []
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


class WeekSales(BaseModel):
    week_start: date
    revenue: MoneyStr
    packs: int


class DuesBreakdown(BaseModel):
    paid: MoneyStr
    pending: MoneyStr
    overdue: MoneyStr


class DashboardOut(BaseModel):
    merchant: MerchantOut
    outstanding_dues: MoneyStr
    outstanding_count: int
    low_stock_count: int
    needs_approval: int
    in_progress: int
    last_week_sales: MoneyStr
    last_week_margin: MoneyStr
    weekly_sales: list[WeekSales]
    dues: DuesBreakdown
    brief: Brief
    connections: list[ConnectionOut]
    demo_mode: bool


class ReadbackOut(BaseModel):
    text: str
    voice: Literal["LIVE", "OFF"]
    audio_base64: str | None = None
    mime: str | None = None


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
    open_screen: str | None = None  # festival | offers | khata | cashflow | bills | benchmarks | impact


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


# ---------- growth features ----------

class FestivalItem(BaseModel):
    name: str
    uplift: str
    last_year_packs: int
    normal_weekly: str


class FestivalOut(BaseModel):
    code: str
    name: str
    name_hi: str
    date: date
    days_left: int
    top_items: list[FestivalItem]
    suggested_prompt: str
    source: str


class ImpactOut(BaseModel):
    restocks_completed: int
    under_budget: MoneyStr
    supplier_savings: MoneyStr
    collected_via_links: MoneyStr
    payments_collected: int
    offers_drafted: int
    avg_seconds_to_plan: float | None
    minutes_saved_estimate: int
    assumptions: list[str]


class SlowMoverOut(BaseModel):
    product_id: str
    name: str
    name_hi: str
    pack_label: str
    stock: int
    weekly_sales: list[int]
    avg_weekly: str
    last_week: int
    weeks_of_cover: str | None
    stock_value: MoneyStr
    cash_tied_up: MoneyStr
    sell_price: MoneyStr
    unit_cost: MoneyStr | None
    suggested_discount: int
    offer_price: MoneyStr
    reason: str


class OfferRequest(BaseModel):
    product_id: str = Field(max_length=40)
    discount_pct: int = Field(ge=5, le=30)


class OfferOut(BaseModel):
    id: str
    product_id: str
    product_name: str
    discount_pct: int
    offer_price: MoneyStr
    sell_price: MoneyStr
    message: str
    language: str
    status: str
    created_at: datetime


class TranslateRequest(BaseModel):
    kind: Literal["OFFER", "INVOICE", "KHATA"]
    ref: str = Field(min_length=1, max_length=120, description="Offer id, invoice id, or customer name")
    target: str = Field(pattern=r"^[a-z]{2}-IN$")


class TranslateOut(BaseModel):
    text: str
    language: str
    engine: str


class LanguageOut(BaseModel):
    code: str
    name: str


class KhataHistory(BaseModel):
    date: date
    kind: str
    amount: MoneyStr
    note: str


class KhataCustomer(BaseModel):
    customer_name: str
    phone_masked: str
    outstanding: MoneyStr
    oldest_open_days: int | None
    avg_days_to_pay: float | None
    late_payments: int
    payments: int
    credit_90d: MoneyStr
    label: str
    suggested_limit: MoneyStr
    open_invoice_id: str | None
    open_invoice_number: str | None
    reminder: str | None
    history: list[KhataHistory]


class KhataOut(BaseModel):
    total_outstanding: MoneyStr
    customers: list[KhataCustomer]
    rules: list[str]
    source: str


class CashEvent(BaseModel):
    label: str
    amount: MoneyStr


class CashPoint(BaseModel):
    date: date
    balance: MoneyStr
    events: list[CashEvent]


class CashflowOut(BaseModel):
    opening: MoneyStr
    cash_on_hand_at: datetime | None
    weekly_expenses: MoneyStr
    days: int
    series: list[CashPoint]
    lowest_balance: MoneyStr
    lowest_on: date
    shortfall: MoneyStr
    first_negative_on: date | None
    daily_sales: MoneyStr
    daily_purchases: MoneyStr
    pending_plan: MoneyStr | None
    assumptions: list[str]
    missing: list[str]


class BusinessSettingsRequest(BaseModel):
    cash_on_hand: str | None = Field(default=None, max_length=14)
    weekly_expenses: str | None = Field(default=None, max_length=14)
    default_restock_budget: str | None = Field(default=None, max_length=14)


class BusinessSettingsOut(BaseModel):
    cash_on_hand: MoneyStr | None
    cash_on_hand_at: datetime | None
    weekly_expenses: MoneyStr | None
    default_restock_budget: MoneyStr | None


class BenchmarkItem(BaseModel):
    product_id: str
    name: str
    yours: str
    peers: str
    diff_pct: int
    ran_low: bool


class BenchmarkInsight(BaseModel):
    name: str
    diff_pct: int
    text: str


class BenchmarksOut(BaseModel):
    locality: str | None
    peer_count: int
    period: str
    items: list[BenchmarkItem]
    insights: list[BenchmarkInsight]
    privacy: str
    source: str


class SpeechOut(BaseModel):
    text: str
    language: str
    voice: Literal["LIVE", "OFF"]
    audio_base64: str | None = None
    mime: str | None = None


class ScanCreated(BaseModel):
    task_id: str
    type: str
    title: str
    amount: MoneyStr


class ScanOut(BaseModel):
    created: list[ScanCreated]
    notes: list[str]
    checked_at: datetime


class GrowthOverview(BaseModel):
    festival: FestivalOut | None
    impact: ImpactOut
    slow_movers: int
    slow_cash_tied_up: MoneyStr
    khata_outstanding: MoneyStr
    khata_late_customers: int
    cash_shortfall: MoneyStr
    cash_first_negative_on: date | None
    benchmark_insight: BenchmarkInsight | None
    proactive_tasks: int


class ReceiptLine(BaseModel):
    product_id: str
    name: str
    pack_label: str
    packs: int
    unit_price: MoneyStr | None
    line_total: MoneyStr | None
    source_text: str | None = None


class ReceiptOut(BaseModel):
    id: str
    status: str
    source: str
    supplier_name: str
    lines: list[ReceiptLine]
    total: MoneyStr
    created_at: datetime
    confirmed_at: datetime | None
    unmatched: list[str] = []
    bill_total: MoneyStr | None = None


class ReceiptTextRequest(BaseModel):
    text: str = Field(min_length=3, max_length=5000)
    supplier_name: str | None = Field(default=None, max_length=120)


class ReceiptLineIn(BaseModel):
    product_id: str = Field(max_length=40)
    packs: int = Field(ge=1, le=1000)
    unit_price: str | None = Field(default=None, max_length=12)


class ConfirmReceiptRequest(BaseModel):
    lines: list[ReceiptLineIn] = Field(min_length=1, max_length=60)
    supplier_name: str | None = Field(default=None, max_length=120)
