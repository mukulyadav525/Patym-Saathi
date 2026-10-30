"""Deterministic seed / demo reset. Run: `uv run python -m app.seed`."""

import uuid
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import seed_data as fx
from app.adapters import sarvam
from app.config import get_settings
from app.db import Base, SessionLocal
from app.models import (
    today_ist,
    DataConnection,
    Inventory,
    Invoice,
    KhataEntry,
    Merchant,
    MerchantMembership,
    PeerBenchmark,
    Product,
    SalesEvent,
    SalesWeekly,
    Supplier,
    SupplierQuote,
    User,
    utcnow,
)
from app.security import hash_password

SEED_NS = uuid.UUID("6f2f8f8e-5a1e-4c1b-9d55-7a5a7e0c0001")


def _merchant(db: Session, spec: dict, role: str) -> Merchant:
    settings = get_settings()
    # Stable IDs so sessions survive a demo reset.
    merchant = Merchant(id=uuid.uuid5(SEED_NS, "merchant:" + spec["email"]), display_name=spec["display_name"], owner_name=spec["owner_name"], locality=spec["locality"],
                        paytm_mid=settings.paytm_mid)
    user = User(id=uuid.uuid5(SEED_NS, "user:" + spec["email"]), email=spec["email"], display_name=spec["owner_name"], password_hash=hash_password(settings.demo_password))
    db.add_all([merchant, user])
    db.flush()
    db.add(MerchantMembership(user_id=user.id, merchant_id=merchant.id, role=role))
    return merchant


def reset(db: Session, today: date | None = None) -> None:
    today = today or today_ist()
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    db.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    db.expunge_all()
    settings = get_settings()
    now = utcnow()

    merchant = _merchant(db, fx.MERCHANT, "DEMO_ADMIN")
    other = _merchant(db, fx.OTHER_MERCHANT, "OWNER")
    merchant.cash_on_hand, merchant.cash_on_hand_at = fx.CASH_ON_HAND, now
    merchant.weekly_expenses, merchant.default_restock_budget = fx.WEEKLY_EXPENSES, fx.DEFAULT_RESTOCK_BUDGET

    suppliers = {s["code"]: Supplier(code=s["code"], name=s["name"], connector_mode="SIMULATED") for s in fx.SUPPLIERS}
    db.add_all(suppliers.values())
    db.flush()

    this_monday = today - timedelta(days=today.weekday())
    week_starts = [this_monday - timedelta(weeks=n) for n in (4, 3, 2, 1)]
    for order, (sku, name, name_hi, pack, stock, sales, price_a, price_b, sell) in enumerate(fx.PRODUCTS):
        for owner in (merchant, other):
            product = Product(merchant_id=owner.id, sku=sku, name=name, name_hi=name_hi, pack_label=pack, pack_size=1,
                              sell_price=Decimal(sell), sort_order=order)
            db.add(product)
            db.flush()
            db.add(Inventory(merchant_id=owner.id, product_id=product.id, on_hand_packs=stock, source="SAMPLE"))
            for week_start, sold in zip(week_starts, sales, strict=True):
                db.add(SalesWeekly(merchant_id=owner.id, product_id=product.id, week_start=week_start,
                                   packs_sold=sold, source="SAMPLE"))
            event_packs, baseline = fx.FESTIVAL_SALES[sku]
            db.add(SalesEvent(merchant_id=owner.id, product_id=product.id, event_code=fx.FESTIVAL["code"],
                              event_name=fx.FESTIVAL["name"], event_date=date.fromisoformat(fx.FESTIVAL["last_date"]),
                              event_week_packs=event_packs, baseline_weekly_packs=Decimal(baseline), source="SAMPLE"))
            db.add(PeerBenchmark(merchant_id=owner.id, product_id=product.id, locality=fx.PEER_LOCALITY,
                                 peer_median_weekly=Decimal(fx.PEER_MEDIANS[sku]), peer_count=fx.PEER_COUNT,
                                 period_label="Last 4 weeks", source="SAMPLE"))
            for code, price, avail in (
                ("A", price_a, fx.AVAILABLE_A),
                ("B", price_b, fx.AVAILABLE_B.get(sku, fx.AVAILABLE_B_DEFAULT)),
            ):
                db.add(SupplierQuote(supplier_id=suppliers[code].id, product_id=product.id, unit_price=Decimal(price),
                                     available_packs=avail, valid_until=now + timedelta(hours=12)))

    for number, customer, phone, amount, due_offset, status in fx.INVOICES:
        db.add(Invoice(merchant_id=merchant.id, customer_name=customer, customer_phone_masked=phone,
                       invoice_number=number, amount=Decimal(amount), status=status,
                       due_date=today + timedelta(days=due_offset),
                       paid_at=now if status == "PAID" else None))
    db.add(Invoice(merchant_id=other.id, customer_name="Other Customer", customer_phone_masked="+91 90000 0X999",
                   invoice_number="INV-9001", amount=Decimal("500"), status="PENDING", due_date=today))

    for customer, phone, entries in fx.KHATA:
        for offset, kind, amount, note in entries:
            db.add(KhataEntry(merchant_id=merchant.id, customer_name=customer, customer_phone_masked=phone,
                              entry_date=today + timedelta(days=offset), kind=kind, amount=Decimal(amount),
                              note=note, source="SAMPLE"))

    paytm_mode = "STAGING" if settings.paytm_env == "staging" else "DEMO"
    for owner in (merchant, other):
        db.add_all([
            DataConnection(merchant_id=owner.id, source="PAYTM", mode=paytm_mode,
                           description="Payment links + verified status", consent_granted_at=now, last_sync_at=now),
            DataConnection(merchant_id=owner.id, source="POS", mode="SAMPLE",
                           description="4 weeks of item-level sales", consent_granted_at=now, last_sync_at=now),
            DataConnection(merchant_id=owner.id, source="INVENTORY", mode="SAMPLE",
                           description="Stock levels", consent_granted_at=now, last_sync_at=now),
            DataConnection(merchant_id=owner.id, source="SUPPLIER", mode="SIMULATED",
                           description="Gupta Distributors, Metro Wholesale", consent_granted_at=now, last_sync_at=now),
            DataConnection(merchant_id=owner.id, source="KHATA", mode="SAMPLE",
                           description="Customer credit ledger (udhaar)", consent_granted_at=now, last_sync_at=now),
            DataConnection(merchant_id=owner.id, source="PEERS", mode="SAMPLE",
                           description=f"Aggregated sales of {fx.PEER_COUNT} nearby stores (anonymised)",
                           consent_granted_at=now, last_sync_at=now),
            DataConnection(merchant_id=owner.id, source="SARVAM", mode="LIVE" if sarvam.enabled() else "OFF",
                           description="Voice + language (text fallback when off)",
                           consent_granted_at=now if sarvam.enabled() else None,
                           status="CONNECTED" if sarvam.enabled() else "NOT_CONFIGURED"),
        ])
    db.commit()


if __name__ == "__main__":
    import sys

    with SessionLocal() as session:
        # --if-empty: used on boot in deployed demo environments, so a restart never wipes real data.
        if "--if-empty" in sys.argv and session.query(Merchant.id).first() is not None:
            print("Database already has data; seed skipped.")
        else:
            reset(session)
            print("Seeded demo data.")
