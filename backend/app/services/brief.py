"""Daily brief: up to 3 priorities computed in code from records, each citing its source."""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Invoice, Product, SalesWeekly, today_ist
from app.services import profit
from app.services.restock import money
from app.services.states import UNPAID
from app.services.restock_flow import inventory_snapshot, sales_summary, sales_window

LOW_STOCK_RATIO = Decimal("0.5")  # less than half a week of average demand


def low_stock(db: Session, merchant_id: uuid.UUID) -> list[dict]:
    sales = sales_summary(db, merchant_id)
    out = []
    for product, inv in inventory_snapshot(db, merchant_id):
        weeks = sales.get(str(product.id), {}).get("weeks", [])[-4:]
        if not weeks:
            continue
        avg = Decimal(sum(weeks)) / len(weeks)
        if Decimal(inv.usable_packs) < avg * LOW_STOCK_RATIO:
            out.append({"product_id": str(product.id), "name": product.name, "stock": inv.usable_packs,
                        "avg_weekly": f"{avg:.0f}", "pack_label": product.pack_label})
    return out


def last_week_sales(db: Session, merchant_id: uuid.UUID) -> dict:
    key = ("last_week_sales", merchant_id)
    if key in db.info:
        return db.info[key]
    costs = profit.unit_costs(db, merchant_id)
    revenue = Decimal("0")
    margin = Decimal("0")
    last_week = sales_window()[-1]
    for product_id, packs, price in db.execute(
            select(SalesWeekly.product_id, SalesWeekly.packs_sold, profit.SOLD_AT).join(Product, Product.id == SalesWeekly.product_id)
            .where(SalesWeekly.merchant_id == merchant_id, SalesWeekly.week_start == last_week)).all():
        revenue += price * packs
        if str(product_id) in costs:
            margin += (price - costs[str(product_id)][0]) * packs
    db.info[key] = {"revenue": money(revenue), "gross_margin": money(margin)}
    return db.info[key]


def weekly_sales(db: Session, merchant_id: uuid.UUID) -> list[dict]:
    """Revenue per week (price sold at x packs sold) for the last 4 completed weeks, oldest first; 0 for a week with
    no records. Same window as every other sales figure."""
    window = sales_window()
    rows = db.execute(
        select(SalesWeekly.week_start, func.sum(SalesWeekly.packs_sold * profit.SOLD_AT), func.sum(SalesWeekly.packs_sold))
        .join(Product, Product.id == SalesWeekly.product_id)
        .where(SalesWeekly.merchant_id == merchant_id, SalesWeekly.week_start >= window[0],
               SalesWeekly.week_start <= window[-1])
        .group_by(SalesWeekly.week_start)
    ).all()
    by_week = {w: (r, p) for w, r, p in rows}
    return [{"week_start": w, "revenue": money(Decimal(by_week.get(w, (0, 0))[0] or 0)),
             "packs": int(by_week.get(w, (0, 0))[1] or 0)} for w in window]


def build(db: Session, merchant_id: uuid.UUID, today: date | None = None) -> dict:
    today = today or today_ist()
    priorities = []
    overdue = db.scalars(select(Invoice).where(
        Invoice.merchant_id == merchant_id, Invoice.status.in_(UNPAID),
        Invoice.due_date < today).order_by(Invoice.due_date)).all()
    if overdue:
        inv = overdue[0]
        priorities.append({
            "kind": "DUES", "severity": "high",
            "title": f"{inv.customer_name} owes ₹{inv.amount:,.0f}",
            "detail": f"{inv.invoice_number} is {(today - inv.due_date).days} days overdue",
            "action": {"type": "COLLECT", "invoice_id": str(inv.id), "label": "Collect"},
            "sources": [f"Invoice {inv.invoice_number}"],
        })
    lows = low_stock(db, merchant_id)
    if lows:
        names = ", ".join(item["name"] for item in lows[:3])
        worst = min(lows, key=lambda i: i["stock"] / max(1, int(i["avg_weekly"])))
        priorities.append({
            "kind": "STOCK", "severity": "medium",
            "title": f"{len(lows)} items low before the weekend",
            "detail": f"{names}{' and more' if len(lows) > 3 else ''} — {worst['name']}: {worst['stock']} packs vs ~{worst['avg_weekly']}/week",
            "action": {"type": "RESTOCK", "label": "Plan restock"},
            "sources": ["Inventory records (SAMPLE)", "4-week POS sales (SAMPLE)"],
        })
    week = last_week_sales(db, merchant_id)
    priorities.append({
        "kind": "SALES", "severity": "info",
        "title": f"Last week: ₹{week['revenue']:,.0f} sales",
        "detail": f"Estimated gross margin ₹{week['gross_margin']:,.0f} (sell price minus best supplier quote)",
        "action": None,
        "sources": ["Weekly POS sales (SAMPLE)", "Product sell prices", "Supplier quotes (SIMULATED)"],
    })
    return {
        "date": today.isoformat(),
        "priorities": priorities[:3],
        "missing": ["Daily sales and payment-by-payment data are not connected; figures are weekly."],
    }
