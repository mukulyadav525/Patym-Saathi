"""Daily brief: up to 3 priorities computed in code from records, each citing its source."""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Invoice, Product, SupplierQuote
from app.services.restock import money
from app.services.restock_flow import inventory_snapshot, sales_summary

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
    sales = sales_summary(db, merchant_id)
    revenue = Decimal("0")
    margin = Decimal("0")
    for product in db.scalars(select(Product).where(Product.merchant_id == merchant_id)):
        weeks = sales.get(str(product.id), {}).get("weeks", [])
        if not weeks:
            continue
        packs = weeks[-1]
        cheapest = db.scalar(select(SupplierQuote.unit_price).where(SupplierQuote.product_id == product.id)
                             .order_by(SupplierQuote.unit_price).limit(1))
        revenue += product.sell_price * packs
        if cheapest is not None:
            margin += (product.sell_price - cheapest) * packs
    return {"revenue": money(revenue), "gross_margin": money(margin)}


def build(db: Session, merchant_id: uuid.UUID, today: date | None = None) -> dict:
    today = today or date.today()
    priorities = []
    overdue = db.scalars(select(Invoice).where(
        Invoice.merchant_id == merchant_id, Invoice.status.in_(("PENDING", "SENT", "DRAFTED")),
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
            "detail": f"{names}{'…' if len(lows) > 3 else ''}. {worst['name']}: {worst['stock']} packs vs ~{worst['avg_weekly']}/week",
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
