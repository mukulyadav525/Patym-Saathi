"""Cost price and profit (gross profit: what an item sold for minus what it cost to buy).

Every pack bought becomes a stock lot with its cost price: a supplier order when its goods arrive, a supplier
bill when it is confirmed. A counter sale uses up the oldest lots first (FIFO) and keeps that cost on the bill
line, so the profit on a sale is its selling price minus what those packs cost. Stock that no purchase record
covers (counted in by hand, or sold beyond the records) is costed at the latest purchase price, or the supplier
price of the brand stocked, and marked estimated.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import IST, CounterSale, Product, SalesWeekly, StockLot, SupplierQuote, today_ist
from app.services import restock_flow
from app.services.restock import money


# What a week's POS sales sold for: the price recorded with them (today's price only for records without one),
# so changing a selling price never rewrites past revenue.
SOLD_AT = func.coalesce(SalesWeekly.unit_price, Product.sell_price)


@dataclass
class Costed:
    cost: Decimal | None  # None: nothing is known about what these packs cost
    estimated: bool = False
    moves: list[dict] = field(default_factory=list)  # {"lot_id", "delta"} applied to packs_left; undo reverses


def _changed(db: Session, merchant_id: uuid.UUID) -> None:
    for key in ("unit_costs", "profit_report"):
        db.info.pop((key, merchant_id), None)


def add_lot(db: Session, merchant_id: uuid.UUID, product_id: uuid.UUID, packs: int, unit_cost: Decimal, source: str, *,
            supplier_name: str = "", brand: str = "", order_id: uuid.UUID | None = None,
            receipt_id: uuid.UUID | None = None) -> StockLot:
    lot = StockLot(merchant_id=merchant_id, product_id=product_id, source=source, supplier_name=supplier_name[:120],
                   brand=brand[:80], unit_cost=money(unit_cost), packs_in=packs, packs_left=packs, order_id=order_id,
                   receipt_id=receipt_id)
    db.add(lot)
    db.flush()
    _changed(db, merchant_id)
    return lot


def fallback_cost(db: Session, merchant_id: uuid.UUID, product: Product) -> Decimal | None:
    """Latest purchase price, else the cheapest supplier price for the brand stocked."""
    last = db.scalar(select(StockLot.unit_cost).where(StockLot.merchant_id == merchant_id, StockLot.product_id == product.id)
                     .order_by(StockLot.received_at.desc()).limit(1))
    if last is not None:
        return last
    q = select(func.min(SupplierQuote.unit_price)).where(SupplierQuote.product_id == product.id)
    if product.brand:
        q = q.where(SupplierQuote.brand == product.brand)
    return db.scalar(q)


def take(db: Session, merchant_id: uuid.UUID, product: Product, packs: int) -> Costed:
    """Sell `packs`: use up the oldest lots first and return what they cost."""
    lots = db.scalars(select(StockLot).where(StockLot.merchant_id == merchant_id, StockLot.product_id == product.id,
                                             StockLot.packs_left > 0)
                      .order_by(StockLot.received_at, StockLot.id).with_for_update()).all()
    _changed(db, merchant_id)
    left, cost, moves = packs, Decimal("0"), []
    for lot in lots:
        if left == 0:
            break
        n = min(left, lot.packs_left)
        lot.packs_left -= n
        left -= n
        cost += lot.unit_cost * n
        moves.append({"lot_id": str(lot.id), "delta": -n})
    if left == 0:
        return Costed(money(cost), False, moves)
    unit = fallback_cost(db, merchant_id, product)
    return Costed(money(cost + unit * left) if unit is not None else None, True, moves)


def put_back(db: Session, merchant_id: uuid.UUID, product: Product, packs: int) -> Costed:
    """A customer return goes back into the newest lot, at that lot's cost."""
    lot = db.scalars(select(StockLot).where(StockLot.merchant_id == merchant_id, StockLot.product_id == product.id)
                     .order_by(StockLot.received_at.desc(), StockLot.id.desc()).limit(1).with_for_update()).first()
    if lot is None:
        unit = fallback_cost(db, merchant_id, product)
        if unit is None:
            return Costed(None, True)
        lot = add_lot(db, merchant_id, product.id, 0, unit, "RETURN", brand=product.brand)
    lot.packs_left += packs
    _changed(db, merchant_id)
    return Costed(money(lot.unit_cost * packs), False, [{"lot_id": str(lot.id), "delta": packs}])


def revert(db: Session, merchant_id: uuid.UUID, moves: list[dict]) -> None:
    _changed(db, merchant_id)
    for move in moves:
        lot = db.get(StockLot, uuid.UUID(move["lot_id"]), with_for_update=True)
        if lot is not None and lot.merchant_id == merchant_id:
            lot.packs_left = max(0, lot.packs_left - move["delta"])


def unit_costs(db: Session, merchant_id: uuid.UUID) -> dict[str, tuple[Decimal, bool]]:
    """Cost price per item now: (price, estimated). Average of the packs in stock by what each lot cost, else the
    latest purchase price, else the supplier price for the brand stocked (estimated)."""
    key = ("unit_costs", merchant_id)
    if key in db.info:
        return db.info[key]
    held = {str(pid): (value, packs) for pid, value, packs in db.execute(
        select(StockLot.product_id, func.sum(StockLot.unit_cost * StockLot.packs_left), func.sum(StockLot.packs_left))
        .where(StockLot.merchant_id == merchant_id, StockLot.packs_left > 0).group_by(StockLot.product_id)).all()}
    out: dict[str, tuple[Decimal, bool]] = {}
    for product in db.scalars(select(Product).where(Product.merchant_id == merchant_id)):
        pid = str(product.id)
        if pid in held:
            value, packs = held[pid]
            out[pid] = (money(Decimal(value) / packs), False)
            continue
        has_lot = db.scalar(select(StockLot.id).where(StockLot.merchant_id == merchant_id,
                                                      StockLot.product_id == product.id).limit(1)) is not None
        unit = fallback_cost(db, merchant_id, product)
        if unit is not None:
            out[pid] = (money(unit), not has_lot)
    db.info[key] = out
    return out


def _bought_before(db: Session, merchant_id: uuid.UUID, before: datetime) -> dict[str, Decimal]:
    """What each item cost on average across purchases received before `before` (prices weekly POS sales)."""
    return {str(pid): money(Decimal(value) / packs) for pid, value, packs in db.execute(
        select(StockLot.product_id, func.sum(StockLot.unit_cost * StockLot.packs_in), func.sum(StockLot.packs_in))
        .where(StockLot.merchant_id == merchant_id, StockLot.received_at < before, StockLot.packs_in > 0)
        .group_by(StockLot.product_id)).all() if packs}


def _pct(profit: Decimal | None, revenue: Decimal) -> str | None:
    return f"{profit / revenue * 100:.1f}" if profit is not None and revenue > 0 else None


def report(db: Session, merchant_id: uuid.UUID) -> dict:
    """Profit per item since the start of the 4-week sales window: weekly POS totals for the completed weeks
    (costed at what the shop paid for its stock before then) plus Soundbox counter bills (costed per bill)."""
    key = ("profit_report", merchant_id)
    if key in db.info:
        return db.info[key]
    window = restock_flow.sales_window()
    start = datetime.combine(window[0], time.min, tzinfo=IST)
    window_end = datetime.combine(window[-1] + timedelta(days=7), time.min, tzinfo=IST)
    history_cost = _bought_before(db, merchant_id, window_end)
    now_cost = unit_costs(db, merchant_id)
    pos = {pid: (packs, value) for pid, packs, value in db.execute(
        select(SalesWeekly.product_id, func.sum(SalesWeekly.packs_sold), func.sum(SalesWeekly.packs_sold * SOLD_AT))
        .join(Product, Product.id == SalesWeekly.product_id)
        .where(SalesWeekly.merchant_id == merchant_id, SalesWeekly.week_start >= window[0], SalesWeekly.week_start <= window[-1])
        .group_by(SalesWeekly.product_id)).all()}

    counter: dict[str, dict] = defaultdict(lambda: {"packs": 0, "revenue": Decimal("0"), "cost": Decimal("0"),
                                                    "estimated": False, "unknown": False})
    for sale in db.scalars(select(CounterSale).where(CounterSale.merchant_id == merchant_id, CounterSale.status == "RECORDED",
                                                     CounterSale.kind.in_(("SALE", "RETURN")), CounterSale.recorded_at >= start)):
        sign = 1 if sale.kind == "SALE" else -1
        for ln in sale.lines:
            c = counter[ln["product_id"]]
            c["packs"] += sign * ln["packs"]
            c["revenue"] += sign * Decimal(ln["amount"])
            if ln.get("cost") is not None:
                c["cost"] += sign * Decimal(ln["cost"])
                c["estimated"] |= bool(ln.get("cost_estimated"))
            elif ln["product_id"] in now_cost:  # a bill from before cost prices were kept
                c["cost"] += sign * now_cost[ln["product_id"]][0] * ln["packs"]
                c["estimated"] = True
            else:
                c["unknown"] = True

    items, total_rev, total_cost, unknown = [], Decimal("0"), Decimal("0"), False
    for product in db.scalars(select(Product).where(Product.merchant_id == merchant_id, Product.active.is_(True))
                              .order_by(Product.sort_order)):
        pid = str(product.id)
        pos_packs, pos_value = pos.get(product.id, (0, 0))
        pos_packs = int(pos_packs or 0)
        c = counter.get(pid)
        if not pos_packs and not c:
            continue
        revenue = Decimal(pos_value or 0)
        cost: Decimal | None = Decimal("0")
        estimated = False
        if pos_packs:
            unit = history_cost.get(pid)
            if unit is None and pid in now_cost:
                unit, estimated = now_cost[pid][0], True
            cost = unit * pos_packs if unit is not None else None
        if c:
            revenue += c["revenue"]
            estimated |= c["estimated"]
            cost = cost + c["cost"] if cost is not None and not c["unknown"] else None
        packs = pos_packs + (c["packs"] if c else 0)
        profit = money(revenue - cost) if cost is not None else None
        current = now_cost.get(pid)
        items.append({
            "product_id": pid, "name": product.name, "pack_label": product.pack_label, "brand": product.brand,
            "sell_price": f"{product.sell_price:.2f}", "cost_price": f"{current[0]:.2f}" if current else None,
            "packs_sold": packs, "counter_packs": c["packs"] if c else 0, "revenue": f"{money(revenue):.2f}",
            "cost": f"{money(cost):.2f}" if cost is not None else None, "profit": f"{profit:.2f}" if profit is not None else None,
            "margin_pct": _pct(profit, revenue),
            "profit_per_pack": f"{money(profit / packs):.2f}" if profit is not None and packs > 0 else None,
            "estimated": estimated,
        })
        total_rev += revenue
        if cost is None:
            unknown = True
        else:
            total_cost += cost
    profit_total = money(total_rev - total_cost) if not unknown else None
    notes = []
    if unknown:
        notes.append("Some items have no cost price yet (no purchase or supplier price on record), so total profit is left out.")
    if any(i["estimated"] for i in items):
        notes.append("Items marked estimated include stock with no purchase record; they use the latest purchase price.")
    db.info[key] = {
        "period_from": window[0], "period_to": today_ist(), "revenue": f"{money(total_rev):.2f}",
        "cost": f"{money(total_cost):.2f}" if not unknown else None,
        "profit": f"{profit_total:.2f}" if profit_total is not None else None, "margin_pct": _pct(profit_total, total_rev),
        "items": sorted(items, key=lambda i: Decimal(i["profit"] or "0"), reverse=True),
        "sources": ["Weekly POS sales for the last 4 completed weeks (SAMPLE), at your selling price and what you paid for that stock",
                    "Soundbox counter bills since then, each at the cost of the packs it used up (oldest stock first)"],
        "notes": notes,
    }
    return db.info[key]


def item(db: Session, merchant_id: uuid.UUID, product_id: uuid.UUID) -> dict | None:
    return next((i for i in report(db, merchant_id)["items"] if i["product_id"] == str(product_id)), None)
