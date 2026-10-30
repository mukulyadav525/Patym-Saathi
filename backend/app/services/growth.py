"""Merchant-growth features. Every number here is computed in code from stored records; text for customers
is drafted from templates (optionally translated by Sarvam). Nothing here moves money or contacts anyone."""

import uuid
from collections import defaultdict
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import seed_data as fx
from app.errors import ApiError
from app.models import (
    Invoice,
    KhataEntry,
    Merchant,
    Offer,
    Order,
    PeerBenchmark,
    Plan,
    Product,
    SalesEvent,
    SupplierQuote,
    Task,
    utcnow,
)
from app.services import audit, brief as brief_service
from app.services.restock import festival_uplift, money
from app.services.restock_flow import inventory_snapshot, sales_summary

ONE = Decimal("1")
OPEN_TASK_STATES = ("NEW", "UNDERSTANDING", "EVIDENCE_READY", "PLAN_DRAFTED", "AWAITING_APPROVAL", "APPROVED",
                    "EXECUTING", "VERIFYING", "EXCEPTION")
# Labelled assumptions for "time saved" (minutes of manual work a merchant reports per task).
MINUTES_PER_RESTOCK = 25
MINUTES_PER_COLLECTION = 8
MIN_PEERS = 10
CREDIT_TERMS_DAYS = 7


def _r(x: Decimal) -> str:
    return f"₹{x:,.0f}"


def _avg_weekly(weeks: list[int]) -> Decimal:
    recent = weeks[-4:]
    return (Decimal(sum(recent)) / len(recent)) if recent else Decimal("0")


def _cheapest_quotes(db: Session, merchant_id: uuid.UUID) -> dict[str, Decimal]:
    rows = db.execute(select(SupplierQuote.product_id, func.min(SupplierQuote.unit_price))
                      .join(Product, Product.id == SupplierQuote.product_id)
                      .where(Product.merchant_id == merchant_id).group_by(SupplierQuote.product_id)).all()
    return {str(pid): price for pid, price in rows}


# ---------- 1. festival nudge ----------

def upcoming_festival(db: Session, merchant_id: uuid.UUID, today: date | None = None) -> dict | None:
    today = today or date.today()
    festival_day = date.fromisoformat(fx.FESTIVAL["date"])
    days = (festival_day - today).days
    if days < 0 or days > 30:
        return None
    rows = db.execute(select(SalesEvent, Product).join(Product, Product.id == SalesEvent.product_id)
                      .where(SalesEvent.merchant_id == merchant_id, SalesEvent.event_code == fx.FESTIVAL["code"])).all()
    if not rows:
        return None
    items = sorted(({"name": p.name, "uplift": f"{festival_uplift(e.event_week_packs, e.baseline_weekly_packs)}",
                     "last_year_packs": e.event_week_packs, "normal_weekly": f"{e.baseline_weekly_packs}"}
                    for e, p in rows), key=lambda i: Decimal(i["uplift"]), reverse=True)
    return {
        "code": fx.FESTIVAL["code"], "name": fx.FESTIVAL["name"], "name_hi": fx.FESTIVAL["name_hi"],
        "date": festival_day.isoformat(), "days_left": days, "top_items": items[:4],
        "suggested_prompt": "Diwali ke liye ₹10,000 ke andar stock arrange karo",
        "source": f"Your sales in last {fx.FESTIVAL['name']} week ({rows[0][0].event_date:%d %b %Y}) vs the weeks before (SAMPLE)",
    }


# ---------- 4. impact ----------

def impact(db: Session, merchant_id: uuid.UUID) -> dict:
    tasks = db.scalars(select(Task).where(Task.merchant_id == merchant_id)).all()
    restocks = [t for t in tasks if t.task_type == "RESTOCK" and t.state in ("COMPLETED", "PARTIALLY_COMPLETED")]
    under_budget = Decimal("0")
    supplier_savings = Decimal("0")
    plan_seconds: list[float] = []
    for task in tasks:
        plans = db.scalars(select(Plan).where(Plan.task_id == task.id).order_by(Plan.version)).all()
        if plans and task.task_type == "RESTOCK":
            plan_seconds.append((plans[0].created_at - task.created_at).total_seconds())
        if task not in restocks or not plans:
            continue
        final = plans[-1]
        spend = db.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(
            Order.task_id == task.id, Order.status.in_(("ACCEPTED", "PARTIALLY_ACCEPTED", "GOODS_RECEIVED")))) or Decimal("0")
        under_budget += max(Decimal("0"), final.budget - Decimal(spend))
        # Savings from choosing the cheapest valid quote vs the costliest quote seen for the same item.
        quotes = defaultdict(list)
        for q in final.payload.get("evidence", {}).get("quotes", []):
            quotes[q["product_id"]].append(Decimal(q["unit_price"]))
        for line in final.payload.get("lines", []):
            prices = quotes.get(line["product_id"])
            if prices:
                supplier_savings += max(Decimal("0"), (max(prices) - Decimal(line["unit_price"])) * line["packs"])
    paid_links = db.scalars(select(Invoice).where(Invoice.merchant_id == merchant_id, Invoice.status == "PAID",
                                                  Invoice.link_url.is_not(None))).all()
    collected = sum((i.amount for i in paid_links), Decimal("0"))
    offers = db.scalar(select(func.count()).select_from(Offer).where(Offer.merchant_id == merchant_id)) or 0
    minutes = len(restocks) * MINUTES_PER_RESTOCK + len(paid_links) * MINUTES_PER_COLLECTION
    return {
        "restocks_completed": len(restocks),
        "under_budget": f"{money(under_budget)}",
        "supplier_savings": f"{money(supplier_savings)}",
        "collected_via_links": f"{money(collected)}",
        "payments_collected": len(paid_links),
        "offers_drafted": offers,
        "avg_seconds_to_plan": round(sum(plan_seconds) / len(plan_seconds), 1) if plan_seconds else None,
        "minutes_saved_estimate": minutes,
        "assumptions": [f"Time saved assumes {MINUTES_PER_RESTOCK} min per manual restock and "
                        f"{MINUTES_PER_COLLECTION} min per manual payment follow-up (merchant-reported estimate).",
                        "Supplier savings = costliest quote minus the chosen quote, per pack ordered."],
    }


# ---------- 3. slow movers + offers ----------

def slow_movers(db: Session, merchant_id: uuid.UUID) -> list[dict]:
    sales = sales_summary(db, merchant_id)
    cost = _cheapest_quotes(db, merchant_id)
    out = []
    for product, inv in inventory_snapshot(db, merchant_id):
        weeks = sales.get(str(product.id), {}).get("weeks", [])
        if not weeks:
            continue
        avg = _avg_weekly(weeks)
        last = weeks[-1]
        cover = (Decimal(inv.usable_packs) / avg) if avg > 0 else None
        falling = avg > 0 and Decimal(last) <= avg / 2
        if not ((cover is not None and cover >= 4) or (falling and inv.usable_packs >= avg * 2)):
            continue
        unit_cost = cost.get(str(product.id))
        weeks_cover = cover if cover is not None else Decimal("99")
        discount = 15 if weeks_cover >= 8 else 10
        offer_price = _offer_price(product.sell_price, discount, unit_cost)
        out.append({
            "product_id": str(product.id), "name": product.name, "name_hi": product.name_hi,
            "pack_label": product.pack_label, "stock": inv.usable_packs, "weekly_sales": weeks[-4:],
            "avg_weekly": f"{avg:.1f}", "last_week": last,
            "weeks_of_cover": f"{weeks_cover:.1f}" if cover is not None else None,
            "stock_value": f"{money(product.sell_price * inv.usable_packs)}",
            "cash_tied_up": f"{money((unit_cost or product.sell_price) * inv.usable_packs)}",
            "sell_price": f"{product.sell_price:.2f}", "unit_cost": f"{unit_cost:.2f}" if unit_cost else None,
            "suggested_discount": discount, "offer_price": f"{offer_price:.2f}",
            "reason": (f"Sales fell from {weeks[-4]} to {last} packs/week; {inv.usable_packs} in stock "
                       f"(~{weeks_cover:.0f} weeks)" if falling else f"{inv.usable_packs} in stock, ~{weeks_cover:.0f} weeks of sales"),
        })
    return sorted(out, key=lambda i: Decimal(i["cash_tied_up"]), reverse=True)


def _offer_price(sell: Decimal, discount: int, unit_cost: Decimal | None) -> Decimal:
    price = (sell * (100 - discount) / 100).quantize(ONE, rounding=ROUND_HALF_UP)
    if unit_cost is not None:  # never below cost + 5%
        floor = (unit_cost * Decimal("1.05")).quantize(ONE, rounding=ROUND_HALF_UP)
        price = max(price, floor)
    return money(price)


def offer_message(merchant: Merchant, product: Product, price: Decimal, discount: int, lang: str) -> str:
    if lang == "en-IN":
        return (f"Namaste! This week at {merchant.display_name}: {product.name} ({product.pack_label}) for just "
                f"₹{price:,.0f} (regular ₹{product.sell_price:,.0f}, {discount}% off). Limited stock, visit today!")
    return (f"Namaste! {merchant.display_name} par is hafte {product.name} ({product.pack_label}) sirf ₹{price:,.0f} "
            f"mein (pehle ₹{product.sell_price:,.0f}, {discount}% chhoot). Stock seemit hai, aaj hi aaiye!")


def draft_offer(db: Session, merchant: Merchant, user_id: uuid.UUID, actor: str, product_id: uuid.UUID,
                discount: int) -> Offer:
    if not 5 <= discount <= 30:
        raise ApiError(422, "BAD_DISCOUNT", "Discount must be between 5% and 30%")
    product = db.scalars(select(Product).where(Product.id == product_id, Product.merchant_id == merchant.id)).first()
    if product is None:
        raise ApiError(404, "NOT_FOUND", "Item not found")
    unit_cost = _cheapest_quotes(db, merchant.id).get(str(product.id))
    price = _offer_price(product.sell_price, discount, unit_cost)
    offer = Offer(merchant_id=merchant.id, product_id=product.id, discount_pct=discount, offer_price=price,
                  message=offer_message(merchant, product, price, discount, "hi-IN"), language="hi-IN",
                  created_by=user_id)
    db.add(offer)
    db.flush()
    audit.record(db, merchant.id, actor, "OFFER_DRAFTED", "offer", offer.id,
                 f"Offer drafted: {product.name} at ₹{price:,.0f} ({discount}% off). Not sent; merchant shares it.")
    return offer


# ---------- 7. khata insights ----------

def khata_insights(db: Session, merchant_id: uuid.UUID, today: date | None = None) -> dict:
    today = today or date.today()
    entries = db.scalars(select(KhataEntry).where(KhataEntry.merchant_id == merchant_id)
                         .order_by(KhataEntry.entry_date, KhataEntry.id)).all()
    open_invoices = {i.customer_name: i for i in db.scalars(select(Invoice).where(
        Invoice.merchant_id == merchant_id, Invoice.status.in_(("PENDING", "DRAFTED", "SENT", "FAILED", "EXPIRED"))))}
    by_customer: dict[str, list[KhataEntry]] = defaultdict(list)
    for e in entries:
        by_customer[e.customer_name].append(e)
    customers = []
    for name, rows in by_customer.items():
        credits = [[e.entry_date, e.amount] for e in rows if e.kind == "CREDIT"]
        days_to_pay: list[int] = []
        queue = [c[:] for c in credits]
        for e in rows:
            if e.kind != "PAYMENT":
                continue
            remaining = e.amount
            while remaining > 0 and queue:
                credit = queue[0]
                take = min(remaining, credit[1])
                credit[1] -= take
                remaining -= take
                if credit[1] == 0:
                    days_to_pay.append((e.entry_date - credit[0]).days)
                    queue.pop(0)
        outstanding = sum((c[1] for c in queue), Decimal("0"))
        oldest_open = queue[0][0] if queue else None
        avg_days = round(sum(days_to_pay) / len(days_to_pay), 1) if days_to_pay else None
        late = sum(1 for d in days_to_pay if d > CREDIT_TERMS_DAYS * 2)
        total_credit_90 = sum((e.amount for e in rows if e.kind == "CREDIT" and (today - e.entry_date).days <= 90),
                              Decimal("0"))
        if avg_days is None:
            label, factor = "New customer", Decimal("0.5")
        elif avg_days <= 10:
            label, factor = "Pays on time", Decimal("1.0")
        elif avg_days <= 20:
            label, factor = "Sometimes late", Decimal("0.6")
        else:
            label, factor = "Pays late", Decimal("0.4")
        monthly = total_credit_90 / 3
        limit = (monthly * factor / 100).quantize(ONE, rounding=ROUND_HALF_UP) * 100
        invoice = open_invoices.get(name)
        customers.append({
            "customer_name": name, "phone_masked": rows[0].customer_phone_masked, "outstanding": f"{money(outstanding)}",
            "oldest_open_days": (today - oldest_open).days if oldest_open else None,
            "avg_days_to_pay": avg_days, "late_payments": late, "payments": len(days_to_pay),
            "credit_90d": f"{money(total_credit_90)}", "label": label, "suggested_limit": f"{money(limit)}",
            "open_invoice_id": str(invoice.id) if invoice else None,
            "open_invoice_number": invoice.invoice_number if invoice else None,
            "reminder_en": (f"Hello {name}, ₹{outstanding:,.0f} of credit is pending in your account at our shop. "
                            "Please pay when convenient. Thank you!") if outstanding > 0 else None,
            "reminder": (f"Namaste {name} ji, aapka ₹{outstanding:,.0f} ka udhaar baaki hai. "
                         f"Suvidha anusaar jaldi chuka dijiye. Dhanyavaad!") if outstanding > 0 else None,
            "history": [{"date": e.entry_date.isoformat(), "kind": e.kind, "amount": f"{e.amount:.2f}", "note": e.note}
                        for e in rows],
        })
    customers.sort(key=lambda c: Decimal(c["outstanding"]), reverse=True)
    total = sum((Decimal(c["outstanding"]) for c in customers), Decimal("0"))
    return {
        "total_outstanding": f"{money(total)}", "customers": customers,
        "rules": [f"Days to pay are matched oldest credit first; late = more than {CREDIT_TERMS_DAYS * 2} days.",
                  "Suggested limit = average monthly credit (last 90 days) x 1.0 on time / 0.6 sometimes late / "
                  "0.4 late / 0.5 new, rounded to ₹100. A suggestion only; Saathi does not lend or block credit."],
        "source": "Khata ledger (SAMPLE)",
    }


# ---------- 6. cash flow ----------

def cashflow(db: Session, merchant: Merchant, today: date | None = None, days: int = 14,
             include_pending: bool = True) -> dict:
    today = today or date.today()
    sales = sales_summary(db, merchant.id)
    cost = _cheapest_quotes(db, merchant.id)
    weekly_revenue = Decimal("0")
    weekly_purchases = Decimal("0")
    for product in db.scalars(select(Product).where(Product.merchant_id == merchant.id)):
        avg = _avg_weekly(sales.get(str(product.id), {}).get("weeks", []))
        weekly_revenue += product.sell_price * avg
        weekly_purchases += cost.get(str(product.id), product.sell_price) * avg
    expenses = merchant.weekly_expenses or Decimal("0")
    opening = merchant.cash_on_hand
    missing = []
    if opening is None:
        missing.append("Cash in hand not entered; forecast starts from ₹0.")
        opening = Decimal("0")
    if merchant.weekly_expenses is None:
        missing.append("Weekly expenses (rent, salary) not entered.")

    events: dict[int, list[dict]] = defaultdict(list)
    for inv in db.scalars(select(Invoice).where(Invoice.merchant_id == merchant.id,
                                                Invoice.status.in_(("PENDING", "DRAFTED", "SENT")))):
        offset = (inv.due_date - today).days
        if offset < 0:
            continue  # overdue: not counted until it is actually paid
        if offset < days:
            events[offset].append({"label": f"{inv.customer_name} due ({inv.invoice_number})", "amount": f"{inv.amount:.2f}"})
    payable = db.scalar(select(func.coalesce(func.sum(Order.total), 0)).where(
        Order.merchant_id == merchant.id, Order.status.in_(("ACCEPTED", "PARTIALLY_ACCEPTED")))) or Decimal("0")
    payable = Decimal(payable)
    if payable > 0:
        events[1].append({"label": "Supplier orders, pay on delivery", "amount": f"-{payable:.2f}"})
    pending_plan = None
    if include_pending:
        for task in db.scalars(select(Task).where(Task.merchant_id == merchant.id, Task.task_type == "RESTOCK",
                                                  Task.state == "AWAITING_APPROVAL")):
            plan = db.scalars(select(Plan).where(Plan.task_id == task.id, Plan.status == "ACTIVE")).first()
            if plan:
                new_spend = plan.total - plan.committed_total
                pending_plan = (pending_plan or Decimal("0")) + new_spend
        if pending_plan:
            events[1].append({"label": "Restock plan awaiting your approval", "amount": f"-{pending_plan:.2f}"})
    # Routine purchases are replaced by known orders/plans in the first week.
    covered_week = payable > 0 or bool(pending_plan)

    daily_in = weekly_revenue / 7
    daily_routine_out = weekly_purchases / 7
    daily_expenses = expenses / 7
    balance = opening
    series = []
    low_point = (opening, today)
    for d in range(days):
        day = today + timedelta(days=d)
        purchases = Decimal("0") if (covered_week and d < 7) else daily_routine_out
        one_offs = sum((Decimal(e["amount"]) for e in events.get(d, [])), Decimal("0"))
        balance += daily_in - purchases - daily_expenses + one_offs
        series.append({"date": day.isoformat(), "balance": f"{money(balance)}", "events": events.get(d, [])})
        if balance < low_point[0]:
            low_point = (balance, day)
    shortfall = money(-low_point[0]) if low_point[0] < 0 else Decimal("0")
    first_negative = next((p["date"] for p in series if Decimal(p["balance"]) < 0), None)
    return {
        "opening": f"{money(opening)}", "cash_on_hand_at": merchant.cash_on_hand_at,
        "weekly_expenses": f"{money(expenses)}", "days": days, "series": series,
        "lowest_balance": f"{money(low_point[0])}", "lowest_on": low_point[1].isoformat(),
        "shortfall": f"{shortfall}", "first_negative_on": first_negative,
        "daily_sales": f"{money(daily_in)}", "daily_purchases": f"{money(daily_routine_out)}",
        "pending_plan": f"{money(pending_plan)}" if pending_plan else None,
        "assumptions": ["Daily sales = 4-week average weekly sales / 7 (POS, SAMPLE).",
                        "Routine purchases = replacing what you sell at the cheapest supplier quote; replaced by known "
                        "orders and plans in the first week.",
                        "Customer dues counted on their due date; overdue dues are not counted until paid.",
                        "An estimate to plan with, not a bank balance."],
        "missing": missing,
    }


def update_cash_settings(db: Session, merchant: Merchant, actor: str, cash_on_hand: Decimal | None,
                         weekly_expenses: Decimal | None, default_restock_budget: Decimal | None) -> None:
    for value in (cash_on_hand, weekly_expenses, default_restock_budget):
        if value is not None and not Decimal("0") <= value <= Decimal("10000000"):
            raise ApiError(422, "BAD_AMOUNT", "Amounts must be between ₹0 and ₹1 crore")
    if cash_on_hand is not None:
        merchant.cash_on_hand, merchant.cash_on_hand_at = money(cash_on_hand), utcnow()
    if weekly_expenses is not None:
        merchant.weekly_expenses = money(weekly_expenses)
    if default_restock_budget is not None:
        if default_restock_budget < Decimal("100"):
            raise ApiError(422, "BAD_AMOUNT", "Restock budget must be at least ₹100")
        merchant.default_restock_budget = money(default_restock_budget)
    audit.record(db, merchant.id, actor, "SETTINGS_UPDATED", "merchant", merchant.id, "Business figures updated")


# ---------- 10. benchmarks ----------

def benchmarks(db: Session, merchant_id: uuid.UUID) -> dict:
    sales = sales_summary(db, merchant_id)
    stock = {str(p.id): inv.usable_packs for p, inv in inventory_snapshot(db, merchant_id)}
    rows = db.execute(select(PeerBenchmark, Product).join(Product, Product.id == PeerBenchmark.product_id)
                      .where(PeerBenchmark.merchant_id == merchant_id).order_by(Product.sort_order)).all()
    items, insights = [], []
    locality, peers = None, 0
    for bench, product in rows:
        if bench.peer_count < MIN_PEERS:
            continue  # too few stores to stay anonymous
        locality, peers = bench.locality, bench.peer_count
        mine = _avg_weekly(sales.get(str(product.id), {}).get("weeks", []))
        peer = bench.peer_median_weekly
        diff = int(((mine - peer) / peer * 100).quantize(ONE, rounding=ROUND_HALF_UP)) if peer > 0 else 0
        ran_low = stock.get(str(product.id), 0) < mine
        items.append({"product_id": str(product.id), "name": product.name, "yours": f"{mine:.1f}",
                      "peers": f"{peer:.1f}", "diff_pct": diff, "ran_low": ran_low})
        if diff <= -20:
            if ran_low:
                tip = f"you are low on stock ({stock.get(str(product.id), 0)} packs), which may be limiting sales"
            elif sales.get(str(product.id), {}).get("weeks", [0])[-1] == 0:
                tip = "your sales stopped last week while nearby stores kept selling; check price and shelf placement"
            else:
                tip = "consider stocking more or making it more visible"
            insights.append({"name": product.name, "diff_pct": diff,
                             "text": f"Stores near you sell {abs(diff)}% more {product.name.lower()} each week; {tip}."})
        elif diff >= 20:
            insights.append({"name": product.name, "diff_pct": diff,
                             "text": f"You sell {diff}% more {product.name.lower()} than nearby stores. Keep it stocked."})
    return {"locality": locality, "peer_count": peers, "period": "Last 4 weeks", "items": items,
            "insights": sorted(insights, key=lambda i: i["diff_pct"]),
            "privacy": f"Aggregated from at least {MIN_PEERS} stores; no single store can be identified.",
            "source": "Nearby-store aggregate (SAMPLE)"}


# ---------- 2. Hindi voice brief ----------

def brief_speech(db: Session, merchant: Merchant, lang: str = "hi-IN", today: date | None = None) -> str:
    today = today or date.today()
    data = brief_service.build(db, merchant.id, today)
    first = merchant.owner_name.split(" ")[0]
    lines: list[str] = []
    overdue = db.scalars(select(Invoice).where(Invoice.merchant_id == merchant.id,
                                               Invoice.status.in_(("PENDING", "SENT", "DRAFTED")),
                                               Invoice.due_date < today).order_by(Invoice.due_date)).first()
    lows = brief_service.low_stock(db, merchant.id)
    week = brief_service.last_week_sales(db, merchant.id)
    festival = upcoming_festival(db, merchant.id, today)
    hi = lang.startswith("hi")
    if hi:
        lines.append(f"Namaste {first} ji. Aaj ke {len(data['priorities'])} zaroori kaam.")
        if overdue:
            lines.append(f"{overdue.customer_name} ka {_r(overdue.amount)} {(today - overdue.due_date).days} din se baaki hai.")
        if lows:
            lines.append(f"{len(lows)} cheezein kam hain, jaise {', '.join(i['name'] for i in lows[:3])}.")
        lines.append(f"Pichhle hafte ki bikri {_r(week['revenue'])} rahi, munafa lagbhag {_r(week['gross_margin'])}.")
        if festival:
            lines.append(f"{festival['name']} mein {festival['days_left']} din baaki hain. Tyohar ka stock abhi plan kar lijiye.")
        lines.append("Kuch bhi karne se pehle Saathi aapki manzoori lega.")
    else:
        lines.append(f"Good morning {first}. Here are today's {len(data['priorities'])} priorities.")
        if overdue:
            lines.append(f"{overdue.customer_name} owes {_r(overdue.amount)}, {(today - overdue.due_date).days} days overdue.")
        if lows:
            lines.append(f"{len(lows)} items are running low, including {', '.join(i['name'] for i in lows[:3])}.")
        lines.append(f"Last week's sales were {_r(week['revenue'])}, with about {_r(week['gross_margin'])} margin.")
        if festival:
            lines.append(f"{festival['name']} is {festival['days_left']} days away. Plan festival stock now.")
        lines.append("Saathi will ask for your approval before doing anything.")
    return " ".join(lines)


# ---------- 5. proactive scan ----------

def proactive_scan(db: Session, ctx, today: date | None = None) -> dict:
    """Saathi checks the shop and prepares work. It only drafts: every action still needs approval."""
    from app.services import assistant, dues_flow, restock_flow  # local import: avoid cycles

    today = today or date.today()
    merchant = ctx.merchant
    created: list[dict] = []
    notes: list[str] = []
    open_restock = db.scalars(select(Task).where(Task.merchant_id == merchant.id, Task.task_type == "RESTOCK",
                                                 Task.state.in_(OPEN_TASK_STATES))).first()
    lows = brief_service.low_stock(db, merchant.id)
    if lows and open_restock is None:
        budget = merchant.default_restock_budget or Decimal("5000")
        task = assistant.new_task(db, ctx, "RESTOCK", f"Saathi prepared: restock within ₹{budget:,.0f}",
                                  f"Saathi noticed {len(lows)} items running low", "PROACTIVE",
                                  {"intent": "RESTOCK", "budget": f"{budget:.2f}", "horizon_days": 7, "proactive": True})
        try:
            plan = restock_flow.start_restock(db, task, "saathi", budget)
            created.append({"task_id": str(task.id), "type": "RESTOCK", "title": task.title, "amount": f"{plan.total:.2f}"})
        except ApiError as exc:
            if exc.code != "BUDGET_EXCEEDED":
                raise
            db.rollback()
            notes.append(f"Low stock found, but the full restock is above your ₹{budget:,.0f} default budget.")
    elif lows:
        notes.append("Low stock found; a restock task is already open.")
    for inv in db.scalars(select(Invoice).where(Invoice.merchant_id == merchant.id, Invoice.status == "PENDING",
                                                Invoice.due_date < today).order_by(Invoice.due_date)):
        if db.scalar(select(Task.id).where(Task.invoice_id == inv.id, Task.state.in_(OPEN_TASK_STATES))):
            continue
        task = assistant.new_task(db, ctx, "COLLECT_DUE", f"Saathi prepared: collect {inv.invoice_number} from {inv.customer_name}",
                                  f"Saathi noticed {inv.invoice_number} is overdue", "PROACTIVE",
                                  {"intent": "COLLECT_DUE", "customer": inv.customer_name, "proactive": True})
        dues_flow.start_collect(db, task, inv, merchant, "saathi")
        created.append({"task_id": str(task.id), "type": "COLLECT_DUE", "title": task.title, "amount": f"{inv.amount:.2f}"})
    festival = upcoming_festival(db, merchant.id, today)
    if festival:
        notes.append(f"{festival['name']} in {festival['days_left']} days: ask Saathi for a festival plan.")
    slow = slow_movers(db, merchant.id)
    if slow:
        notes.append(f"{len(slow)} slow-moving items; an offer could free up {_r(sum(Decimal(s['cash_tied_up']) for s in slow))}.")
    audit.record(db, merchant.id, "saathi", "PROACTIVE_SCAN", "merchant", merchant.id,
                 f"Saathi checked the shop: prepared {len(created)} task(s) for approval",
                 details={"created": [c["task_id"] for c in created]})
    db.commit()
    return {"created": created, "notes": notes, "checked_at": utcnow().isoformat()}


def scheduled_scan_all() -> int:
    """Background job: run the proactive check for every active merchant as its owner. Returns tasks created."""
    from app.db import SessionLocal  # local import: keep this module importable without a DB
    from app.models import MerchantMembership, User
    from app.security import Ctx

    created = 0
    with SessionLocal() as db:
        rows = db.execute(select(MerchantMembership, Merchant, User)
                          .join(Merchant, Merchant.id == MerchantMembership.merchant_id)
                          .join(User, User.id == MerchantMembership.user_id)
                          .where(Merchant.status == "ACTIVE", MerchantMembership.status == "ACTIVE",
                                 MerchantMembership.role.in_(("OWNER", "DEMO_ADMIN")))).all()
        seen: set[uuid.UUID] = set()
        for membership, merchant, user in rows:
            if merchant.id in seen:
                continue
            seen.add(merchant.id)
            try:
                created += len(proactive_scan(db, Ctx(user=user, merchant=merchant, role=membership.role))["created"])
            except Exception:  # noqa: BLE001 - one merchant's failure must not stop the others
                db.rollback()
    return created
