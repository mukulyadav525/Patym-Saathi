"""Deterministic restock calculator (trd.txt §6). Pure functions: no DB, no LLM.

forecast   = ceil(avg weekly packs over last 4 weeks * horizon_days / 7)
net_need   = max(0, forecast + safety - usable - inbound)
order      = round_up(net_need, max(pack_size, min_order_packs))
supplier   = cheapest valid quote with availability; partial at one supplier, rest at next
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from datetime import datetime

TWO_PLACES = Decimal("0.01")


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(TWO_PLACES, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class ItemInput:
    product_id: str
    name: str
    pack_label: str
    pack_size: int
    usable_packs: int
    weekly_sales: list[int]  # most recent 4 weeks
    inbound_packs: int = 0


@dataclass(frozen=True)
class QuoteInput:
    quote_id: str
    supplier_id: str
    supplier_name: str
    product_id: str
    unit_price: Decimal
    available_packs: int
    min_order_packs: int
    valid_until: datetime


@dataclass
class PlanLine:
    product_id: str
    name: str
    pack_label: str
    sold_per_week: Decimal
    stock: int
    forecast: int
    packs: int
    supplier_id: str
    supplier_name: str
    quote_id: str
    unit_price: Decimal
    line_total: Decimal
    status: str = "NEW"  # NEW | COMMITTED


@dataclass
class PlanResult:
    lines: list[PlanLine]
    total: Decimal
    committed_total: Decimal
    budget: Decimal
    total_packs: int
    unfillable: list[dict] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)


class BudgetExceeded(Exception):
    def __init__(self, total: Decimal, budget: Decimal):
        super().__init__(f"Plan total ₹{total} exceeds budget ₹{budget}")
        self.total = total
        self.budget = budget


def forecast_packs(weekly_sales: list[int], horizon_days: int) -> tuple[Decimal, int]:
    recent = weekly_sales[-4:]
    if not recent:
        return Decimal("0"), 0
    avg = Decimal(sum(recent)) / Decimal(len(recent))
    demand = avg * Decimal(horizon_days) / Decimal(7)
    return avg.quantize(Decimal("0.1")), math.ceil(demand)


def order_quantity(forecast: int, usable: int, inbound: int, safety: int, step: int) -> int:
    net_need = max(0, forecast + safety - usable - inbound)
    if net_need == 0:
        return 0
    step = max(1, step)
    return math.ceil(net_need / step) * step


def allocate(packs: int, quotes: list[QuoteInput], now: datetime) -> tuple[list[tuple[QuoteInput, int]], int]:
    """Cheapest valid quote first; partial fill then next supplier. Returns (allocations, unfilled)."""
    valid = sorted(
        (q for q in quotes if q.valid_until > now and q.available_packs > 0),
        key=lambda q: (q.unit_price, q.supplier_name),
    )
    remaining = packs
    allocations: list[tuple[QuoteInput, int]] = []
    for quote in valid:
        if remaining <= 0:
            break
        take = min(remaining, quote.available_packs)
        step = max(1, quote.min_order_packs)
        take = (take // step) * step
        if take <= 0:
            continue
        allocations.append((quote, take))
        remaining -= take
    return allocations, remaining


def build_plan(
    items: list[ItemInput],
    quotes: list[QuoteInput],
    budget: Decimal,
    now: datetime,
    horizon_days: int = 7,
    safety_packs: int = 0,
    committed: list[PlanLine] | None = None,
    resource_only: dict[str, int] | None = None,
) -> PlanResult:
    """Build a plan.

    committed: lines already accepted by a supplier (kept as-is, count toward budget).
    resource_only: {product_id: packs} to re-source after a shortage (replan); when given,
    only these products are planned in addition to the committed lines.
    """
    committed = list(committed or [])
    lines: list[PlanLine] = list(committed)
    unfillable: list[dict] = []
    quotes_by_product: dict[str, list[QuoteInput]] = {}
    for q in quotes:
        quotes_by_product.setdefault(q.product_id, []).append(q)

    for item in items:
        avg, forecast = forecast_packs(item.weekly_sales, horizon_days)
        if resource_only is not None:
            if item.product_id not in resource_only:
                continue
            packs = resource_only[item.product_id]
        else:
            product_quotes = quotes_by_product.get(item.product_id, [])
            step = max([item.pack_size] + [q.min_order_packs for q in product_quotes])
            packs = order_quantity(forecast, item.usable_packs, item.inbound_packs, safety_packs, step)
        if packs == 0:
            continue
        allocations, unfilled = allocate(packs, quotes_by_product.get(item.product_id, []), now)
        for quote, take in allocations:
            lines.append(
                PlanLine(
                    product_id=item.product_id,
                    name=item.name,
                    pack_label=item.pack_label,
                    sold_per_week=avg,
                    stock=item.usable_packs,
                    forecast=forecast,
                    packs=take,
                    supplier_id=quote.supplier_id,
                    supplier_name=quote.supplier_name,
                    quote_id=quote.quote_id,
                    unit_price=money(quote.unit_price),
                    line_total=money(quote.unit_price * take),
                )
            )
        if unfilled:
            unfillable.append({"product_id": item.product_id, "name": item.name, "packs": unfilled})

    total = money(sum((line.line_total for line in lines), Decimal("0")))
    committed_total = money(sum((line.line_total for line in committed), Decimal("0")))
    if total > money(budget):
        raise BudgetExceeded(total, money(budget))
    return PlanResult(
        lines=lines,
        total=total,
        committed_total=committed_total,
        budget=money(budget),
        total_packs=sum(line.packs for line in lines),
        unfillable=unfillable,
        assumptions=[
            f"Demand horizon: {horizon_days} days until next restock (covers the weekend).",
            "Demand = average weekly packs sold over the last 4 weeks (sample POS data).",
            f"Safety stock: {safety_packs} packs per item.",
            "Quantities rounded up to pack size / supplier minimum order.",
            "Cheapest valid supplier quote chosen per item.",
        ],
    )
