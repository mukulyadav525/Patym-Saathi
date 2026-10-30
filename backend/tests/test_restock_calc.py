from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from app import seed_data as fx
from app.services.restock import (
    BudgetExceeded,
    ItemInput,
    QuoteInput,
    build_plan,
    forecast_packs,
    order_quantity,
)

NOW = datetime(2026, 10, 30, 10, 0, tzinfo=timezone.utc)
LATER = NOW + timedelta(hours=6)


def fixture(oil_available_at_a: int = fx.AVAILABLE_A):
    items, quotes = [], []
    for sku, name, _hi, pack, stock, sales, price_a, price_b, _sell in fx.PRODUCTS:
        items.append(ItemInput(sku, name, pack, 1, stock, sales))
        avail_a = oil_available_at_a if sku == fx.SHORTAGE_SKU else fx.AVAILABLE_A
        avail_b = fx.AVAILABLE_B.get(sku, fx.AVAILABLE_B_DEFAULT)
        quotes.append(QuoteInput(f"qa-{sku}", "A", "Gupta Distributors", sku, Decimal(price_a), avail_a, 1, LATER))
        quotes.append(QuoteInput(f"qb-{sku}", "B", "Metro Wholesale", sku, Decimal(price_b), avail_b, 1, LATER))
    return items, quotes


def test_forecast_uses_four_week_average_over_seven_days():
    assert forecast_packs([6, 5, 7, 6], 7) == (Decimal("6.0"), 6)
    assert forecast_packs([9, 8, 10, 9], 3) == (Decimal("9.0"), 4)  # 3-day horizon is not the weekly figure


def test_order_quantity_rounds_up_to_pack_and_never_negative():
    assert order_quantity(6, 2, 0, 0, 1) == 4
    assert order_quantity(6, 2, 0, 0, 5) == 5
    assert order_quantity(3, 10, 0, 0, 1) == 0
    assert order_quantity(6, 2, 3, 0, 1) == 1  # inbound counts


def test_plan_v1_is_4650_all_from_supplier_a():
    items, quotes = fixture()
    plan = build_plan(items, quotes, fx.DEMO_BUDGET, NOW)
    assert plan.total == fx.EXPECTED_PLAN_V1
    assert plan.total_packs == 31
    assert {line.supplier_id for line in plan.lines} == {"A"}
    packs = {line.product_id: line.packs for line in plan.lines}
    assert packs == {"ATTA10": 4, "RICE5": 3, "SUGAR1": 12, "TOOR1": 5, "OIL1": 5, "TEA250": 2}


def test_replan_after_oil_shortage_is_4850_with_oil_from_b():
    items, quotes = fixture()
    v1 = build_plan(items, quotes, fx.DEMO_BUDGET, NOW)
    committed = [line for line in v1.lines if line.product_id != fx.SHORTAGE_SKU]
    for line in committed:
        line.status = "COMMITTED"
    assert sum(line.line_total for line in committed) == fx.EXPECTED_ACCEPTED_A

    items, quotes = fixture(oil_available_at_a=0)
    v2 = build_plan(items, quotes, fx.DEMO_BUDGET, NOW, committed=committed, resource_only={fx.SHORTAGE_SKU: 5})
    assert v2.total == fx.EXPECTED_PLAN_V2
    assert v2.committed_total == fx.EXPECTED_ACCEPTED_A
    oil = [line for line in v2.lines if line.product_id == fx.SHORTAGE_SKU]
    assert len(oil) == 1 and oil[0].supplier_id == "B" and oil[0].line_total == Decimal("880.00")
    assert fx.DEMO_BUDGET - v2.total == Decimal("150.00")


def test_partial_availability_splits_across_suppliers():
    items, quotes = fixture(oil_available_at_a=2)
    plan = build_plan(items, quotes, fx.DEMO_BUDGET, NOW)
    oil = sorted((line.supplier_id, line.packs) for line in plan.lines if line.product_id == "OIL1")
    assert oil == [("A", 2), ("B", 3)]


def test_budget_cap_is_enforced():
    items, quotes = fixture()
    with pytest.raises(BudgetExceeded):
        build_plan(items, quotes, Decimal("4649.99"), NOW)


def test_expired_quotes_are_ignored():
    items, quotes = fixture()
    expired = [
        QuoteInput(q.quote_id, q.supplier_id, q.supplier_name, q.product_id, q.unit_price, q.available_packs,
                   q.min_order_packs, NOW - timedelta(minutes=1)) if q.supplier_id == "A" else q
        for q in quotes
    ]
    plan = build_plan(items, expired, Decimal("6000"), NOW)
    assert {line.supplier_id for line in plan.lines} == {"B"}
