"""Database models. Money is NUMERIC(12,2) / Decimal everywhere; timestamps are UTC."""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

Money = Numeric(12, 2)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


IST = timezone(timedelta(hours=5, minutes=30))


def today_ist() -> date:
    """The merchant's calendar date. Servers run in UTC; Indian shops close their day in IST."""
    return datetime.now(IST).date()


def pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


def fk(target: str, nullable: bool = False) -> Mapped:
    return mapped_column(UUID(as_uuid=True), ForeignKey(target), nullable=nullable, index=True)


def ts(nullable: bool = False) -> Mapped:
    if nullable:
        return mapped_column(DateTime(timezone=True), nullable=True)
    return mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Merchant(Base):
    __tablename__ = "merchants"
    id: Mapped[uuid.UUID] = pk()
    display_name: Mapped[str] = mapped_column(String(120))
    owner_name: Mapped[str] = mapped_column(String(120))
    locality: Mapped[str] = mapped_column(String(120), default="")
    paytm_mid: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    # Merchant-entered figures for the cash-flow forecast and Saathi's proactive restock.
    cash_on_hand: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    cash_on_hand_at: Mapped[datetime | None] = ts(nullable=True)
    weekly_expenses: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    default_restock_budget: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    created_at: Mapped[datetime] = ts()


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = pk()
    email: Mapped[str] = mapped_column(String(160), unique=True)
    display_name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    # Optional 4-digit approval PIN (PBKDF2 hash). When set, every approval needs it.
    approval_pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pin_failed_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    pin_locked_until: Mapped[datetime | None] = ts(nullable=True)
    # Password guessing protection: 5 wrong passwords lock sign-in for 15 minutes.
    login_failed_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    login_locked_until: Mapped[datetime | None] = ts(nullable=True)
    created_at: Mapped[datetime] = ts()


class MerchantMembership(Base):
    __tablename__ = "merchant_memberships"
    __table_args__ = (UniqueConstraint("user_id", "merchant_id"),)
    id: Mapped[uuid.UUID] = pk()
    user_id: Mapped[uuid.UUID] = fk("users.id")
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    role: Mapped[str] = mapped_column(String(20))  # OWNER | DEMO_ADMIN
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")
    created_at: Mapped[datetime] = ts()


class Product(Base):
    __tablename__ = "products"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    sku: Mapped[str] = mapped_column(String(40))
    name: Mapped[str] = mapped_column(String(120))
    name_hi: Mapped[str] = mapped_column(String(120))
    pack_label: Mapped[str] = mapped_column(String(40))
    pack_size: Mapped[int] = mapped_column(Integer, default=1)
    sell_price: Mapped[Decimal] = mapped_column(Money)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (UniqueConstraint("merchant_id", "product_id"),)
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    on_hand_packs: Mapped[int] = mapped_column(Integer)
    reserved_packs: Mapped[int] = mapped_column(Integer, default=0)
    source: Mapped[str] = mapped_column(String(20))  # SAMPLE | POS | MANUAL
    source_updated_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = ts()

    @property
    def usable_packs(self) -> int:
        return max(0, self.on_hand_packs - self.reserved_packs)


class SalesWeekly(Base):
    __tablename__ = "sales_weekly"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    week_start: Mapped[date] = mapped_column(Date)
    packs_sold: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(20))  # SAMPLE | POS
    imported_at: Mapped[datetime] = ts()


class Supplier(Base):
    __tablename__ = "suppliers"
    id: Mapped[uuid.UUID] = pk()
    code: Mapped[str] = mapped_column(String(10), unique=True)
    name: Mapped[str] = mapped_column(String(120))
    connector_mode: Mapped[str] = mapped_column(String(20))  # SIMULATED | REAL
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE")


class SupplierQuote(Base):
    __tablename__ = "supplier_quotes"
    id: Mapped[uuid.UUID] = pk()
    supplier_id: Mapped[uuid.UUID] = fk("suppliers.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    unit_price: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    available_packs: Mapped[int] = mapped_column(Integer)
    min_order_packs: Mapped[int] = mapped_column(Integer, default=1)
    eta: Mapped[str] = mapped_column(String(40), default="Next day")
    valid_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    fetched_at: Mapped[datetime] = ts()


class DataConnection(Base):
    __tablename__ = "data_connections"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    source: Mapped[str] = mapped_column(String(20))  # PAYTM|POS|INVENTORY|SUPPLIER|SARVAM
    mode: Mapped[str] = mapped_column(String(20))  # DEMO|STAGING|LIVE|SAMPLE|SIMULATED|OFF
    description: Mapped[str] = mapped_column(String(200), default="")
    consent_granted_at: Mapped[datetime | None] = ts(nullable=True)
    last_sync_at: Mapped[datetime | None] = ts(nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="CONNECTED")


class Task(Base):
    __tablename__ = "tasks"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    task_type: Mapped[str] = mapped_column(String(20))  # RESTOCK | COLLECT_DUE | BRIEF
    state: Mapped[str] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200))
    input_text: Mapped[str] = mapped_column(Text, default="")
    input_channel: Mapped[str] = mapped_column(String(10), default="TEXT")
    parsed_intent: Mapped[dict] = mapped_column(JSONB, default=dict)
    result_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    invoice_id: Mapped[uuid.UUID | None] = fk("invoices.id", nullable=True)
    created_by: Mapped[uuid.UUID] = fk("users.id")
    correlation_id: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = ts()


class Plan(Base):
    __tablename__ = "plans"
    __table_args__ = (UniqueConstraint("task_id", "version"),)
    id: Mapped[uuid.UUID] = pk()
    task_id: Mapped[uuid.UUID] = fk("tasks.id")
    version: Mapped[int] = mapped_column(Integer)
    budget: Mapped[Decimal] = mapped_column(Money)
    total: Mapped[Decimal] = mapped_column(Money)
    committed_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    payload: Mapped[dict] = mapped_column(JSONB)
    payload_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20))  # ACTIVE | SUPERSEDED | REJECTED
    reason: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = ts()


class Order(Base):
    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("merchant_id", "reference", name="uq_orders_merchant_reference"),)
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    task_id: Mapped[uuid.UUID] = fk("tasks.id")
    plan_id: Mapped[uuid.UUID] = fk("plans.id")
    supplier_id: Mapped[uuid.UUID] = fk("suppliers.id")
    reference: Mapped[str] = mapped_column(String(30))
    status: Mapped[str] = mapped_column(String(30))
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    total: Mapped[Decimal] = mapped_column(Money)
    idempotency_key: Mapped[str] = mapped_column(String(120), unique=True)
    connector_mode: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = ts()


class OrderLine(Base):
    __tablename__ = "order_lines"
    id: Mapped[uuid.UUID] = pk()
    order_id: Mapped[uuid.UUID] = fk("orders.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    packs: Mapped[int] = mapped_column(Integer)
    unit_price: Mapped[Decimal] = mapped_column(Money)
    line_total: Mapped[Decimal] = mapped_column(Money)
    quote_id: Mapped[uuid.UUID] = fk("supplier_quotes.id")
    line_status: Mapped[str] = mapped_column(String(20), default="PENDING")


class Approval(Base):
    __tablename__ = "approvals"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    task_id: Mapped[uuid.UUID] = fk("tasks.id")
    plan_id: Mapped[uuid.UUID | None] = fk("plans.id", nullable=True)
    invoice_id: Mapped[uuid.UUID | None] = fk("invoices.id", nullable=True)
    action_type: Mapped[str] = mapped_column(String(20))  # SUPPLIER_ORDER | PAYMENT_LINK
    payload_hash: Mapped[str] = mapped_column(String(64))
    payload_snapshot: Mapped[dict] = mapped_column(JSONB)
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20))  # PENDING|CONSUMED|REJECTED|EXPIRED|SUPERSEDED
    approved_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    approved_at: Mapped[datetime | None] = ts(nullable=True)
    consumed_at: Mapped[datetime | None] = ts(nullable=True)
    created_at: Mapped[datetime] = ts()


class Invoice(Base):
    __tablename__ = "invoices"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    customer_name: Mapped[str] = mapped_column(String(120))
    customer_phone_masked: Mapped[str] = mapped_column(String(20))
    invoice_number: Mapped[str] = mapped_column(String(30))
    amount: Mapped[Decimal] = mapped_column(Money)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    status: Mapped[str] = mapped_column(String(30))
    due_date: Mapped[date] = mapped_column(Date)
    provider_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    link_url: Mapped[str | None] = mapped_column(String(300), nullable=True)
    link_mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    draft_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    paid_at: Mapped[datetime | None] = ts(nullable=True)
    created_at: Mapped[datetime] = ts()
    updated_at: Mapped[datetime] = ts()


class PaymentEvent(Base):
    __tablename__ = "payment_events"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID | None] = fk("merchants.id", nullable=True)
    invoice_id: Mapped[uuid.UUID | None] = fk("invoices.id", nullable=True)
    provider: Mapped[str] = mapped_column(String(20))
    provider_event_id: Mapped[str] = mapped_column(String(80), unique=True)
    provider_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    txn_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Money, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    provider_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    signature_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    status_api_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    outcome: Mapped[str | None] = mapped_column(String(40), nullable=True)
    received_at: Mapped[datetime] = ts()
    processed_at: Mapped[datetime | None] = ts(nullable=True)
    raw_payload_redacted: Mapped[dict] = mapped_column(JSONB, default=dict)


class DemoProviderTxn(Base):
    """What the DEMO Paytm adapter's 'server' knows. Stands in for Paytm's Transaction Status API."""

    __tablename__ = "demo_provider_txns"
    id: Mapped[uuid.UUID] = pk()
    provider_order_id: Mapped[str] = mapped_column(String(64), index=True)
    mid: Mapped[str] = mapped_column(String(64))
    txn_id: Mapped[str] = mapped_column(String(80))
    amount: Mapped[Decimal] = mapped_column(Money)
    status: Mapped[str] = mapped_column(String(30))
    created_at: Mapped[datetime] = ts()


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    actor: Mapped[str] = mapped_column(String(80))
    task_id: Mapped[uuid.UUID | None] = fk("tasks.id", nullable=True)
    event_type: Mapped[str] = mapped_column(String(60))
    entity_type: Mapped[str] = mapped_column(String(30))
    entity_id: Mapped[str] = mapped_column(String(60))
    summary: Mapped[str] = mapped_column(Text)
    details_redacted: Mapped[dict] = mapped_column(JSONB, default=dict)
    correlation_id: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = ts()


class IdempotencyRecord(Base):
    __tablename__ = "idempotency_records"
    __table_args__ = (UniqueConstraint("merchant_id", "operation", "key"),)
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    operation: Mapped[str] = mapped_column(String(40))
    key: Mapped[str] = mapped_column(String(120))
    request_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(20))
    result_ref: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = ts()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class SalesEvent(Base):
    """Item sales in a past festival week vs the normal weeks before it (festival demand evidence)."""
    __tablename__ = "sales_events"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    event_code: Mapped[str] = mapped_column(String(20))  # DIWALI
    event_name: Mapped[str] = mapped_column(String(60))
    event_date: Mapped[date] = mapped_column(Date)
    event_week_packs: Mapped[int] = mapped_column(Integer)
    baseline_weekly_packs: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    source: Mapped[str] = mapped_column(String(20))  # SAMPLE | POS


class KhataEntry(Base):
    """Customer credit ledger (udhaar given / payment received). Separate from Paytm payment data."""
    __tablename__ = "khata_entries"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    customer_name: Mapped[str] = mapped_column(String(120))
    customer_phone_masked: Mapped[str] = mapped_column(String(32))
    entry_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(10))  # CREDIT | PAYMENT
    amount: Mapped[Decimal] = mapped_column(Money)
    note: Mapped[str] = mapped_column(String(200), default="")
    source: Mapped[str] = mapped_column(String(20))  # SAMPLE | MANUAL


class PeerBenchmark(Base):
    """Aggregated, anonymised weekly sales of similar stores nearby (minimum peer count enforced in code)."""
    __tablename__ = "peer_benchmarks"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    locality: Mapped[str] = mapped_column(String(120))
    peer_median_weekly: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    peer_count: Mapped[int] = mapped_column(Integer)
    period_label: Mapped[str] = mapped_column(String(60))
    source: Mapped[str] = mapped_column(String(20))  # SAMPLE | PAYTM_AGG


class Offer(Base):
    """A customer offer drafted for a slow-moving item. The merchant shares it; Saathi never sends."""
    __tablename__ = "offers"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    product_id: Mapped[uuid.UUID] = fk("products.id")
    discount_pct: Mapped[int] = mapped_column(Integer)
    offer_price: Mapped[Decimal] = mapped_column(Money)
    message: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(10), default="hi-IN")
    status: Mapped[str] = mapped_column(String(20), default="DRAFTED")  # DRAFTED | SHARED
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    created_at: Mapped[datetime] = ts()


class GoodsReceipt(Base):
    """Supplier bill read from a photo or typed by the merchant. Stock changes only on CONFIRMED."""
    __tablename__ = "goods_receipts"
    id: Mapped[uuid.UUID] = pk()
    merchant_id: Mapped[uuid.UUID] = fk("merchants.id")
    source: Mapped[str] = mapped_column(String(20))  # PHOTO | TEXT
    supplier_name: Mapped[str] = mapped_column(String(120), default="")
    raw_text: Mapped[str] = mapped_column(Text, default="")
    lines: Mapped[list] = mapped_column(JSONB, default=list)
    total: Mapped[Decimal] = mapped_column(Money, default=0)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT")  # DRAFT | CONFIRMED | DISCARDED
    created_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    confirmed_by: Mapped[uuid.UUID | None] = fk("users.id", nullable=True)
    created_at: Mapped[datetime] = ts()
    confirmed_at: Mapped[datetime | None] = ts(nullable=True)
