from decimal import Decimal

from app.seed_data import EXPECTED_DIWALI_PLAN
from app.services.intent import parse
from app.services.restock import festival_uplift, forecast_packs


def test_uplift_is_ratio_rounded_and_never_below_one():
    assert festival_uplift(20, Decimal("9")) == Decimal("2.22")
    assert festival_uplift(50, Decimal("20")) == Decimal("2.50")
    assert festival_uplift(3, Decimal("6")) == Decimal("1.00")
    assert forecast_packs([9, 8, 10, 9], 7, Decimal("2.22")) == (Decimal("9.0"), 20)


def test_diwali_words_route_to_festival_restock():
    p = parse("Diwali ke liye ₹10,000 ke andar stock arrange karo", [])
    assert p.intent == "RESTOCK" and p.festival == "DIWALI" and p.budget == Decimal("10000")
    assert parse("Weekend ke liye ₹5,000 ke andar stock arrange karo", []).festival is None


def test_diwali_plan_uses_last_festival_week(client, auth):
    body = client.post("/api/v1/assistant/message", json={"text": "Diwali ke liye ₹10,000 ke andar stock arrange karo"},
                       headers=auth).json()
    plan = body["task"]["plans"][-1]
    assert plan["festival"] == "Diwali"
    assert Decimal(plan["total"]) == EXPECTED_DIWALI_PLAN
    by_name = {line["name"]: line for line in plan["lines"]}
    sugar = [line for line in plan["lines"] if line["name"] == "Sugar"]
    assert sum(line["packs"] for line in sugar) == 42 and sugar[0]["uplift"] == "2.50"
    assert {line["supplier_name"] for line in sugar} == {"Gupta Distributors", "Metro Wholesale"}
    assert by_name["Sunflower oil"]["forecast"] == 20
    assert "Instant noodles" not in by_name and "Hair oil" not in by_name
    assert any("Diwali" in a for a in plan["assumptions"])
    assert len(plan["festival_evidence"]) == 8


def test_diwali_without_budget_asks_with_festival_suggestions(client, auth):
    body = client.post("/api/v1/assistant/message", json={"text": "Diwali ka stock kar do"}, headers=auth).json()
    assert body["needs_confirmation"]["field"] == "budget" and "₹10,000" in body["suggestions"]


def test_normal_restock_unchanged(client, auth):
    body = client.post("/api/v1/assistant/message", json={"text": "Weekend ke liye ₹5,000 ke andar stock arrange karo"},
                       headers=auth).json()
    assert body["task"]["plans"][-1]["total"] == "4650.00" and body["task"]["plans"][-1]["festival"] is None
