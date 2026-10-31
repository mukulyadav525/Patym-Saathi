"""Buying from vendors: compare brands and qualities by profit, buy through approval, cost price lots, profit."""

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Merchant, Product, StockLot
from tests.conftest import idem, login


def items(client, auth):
    return {i["sku"]: i for i in client.get("/api/v1/inventory", headers=auth).json()}


def sourcing(client, auth, sku):
    pid = items(client, auth)[sku]["product_id"]
    r = client.get(f"/api/v1/products/{pid}/sourcing", headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def offer(data, brand, supplier):
    return next(o for o in data["offers"] if o["brand"] == brand and o["supplier_name"] == supplier)


def ask(client, auth, text):
    r = client.post("/api/v1/assistant/message", json={"text": text}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()["reply"]


def say(client, auth, text):
    r = client.post("/api/v1/soundbox/text", json={"text": text, "speak": False}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def lots(sku):
    with SessionLocal() as db:
        return [(lot.unit_cost, lot.packs_left) for lot in db.scalars(
            select(StockLot).join(Product, Product.id == StockLot.product_id).join(Merchant, Merchant.id == StockLot.merchant_id)
            .where(Product.sku == sku, Merchant.display_name == "Sharma Kirana Store").order_by(StockLot.received_at))]


def buy(client, auth, quote_id, packs, sell_price=None):
    r = client.post("/api/v1/purchases", json={"quote_id": quote_id, "packs": packs, "sell_price": sell_price}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def approve_and_deliver(client, auth, task):
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).json()
    assert task["state"] == "VERIFYING", task
    return client.post(f"/api/v1/demo/tasks/{task['id']}/simulate-delivery", headers=auth).json()


def test_compare_vendors_ranks_brands_by_profit(client, auth):
    atta = sourcing(client, auth, "ATTA10")
    assert atta["brand"] == "Shree Chakki Atta" and atta["cost_price"] == "380.00" and atta["profit_per_pack"] == "40.00"
    assert [(o["brand"], o["supplier_name"], o["profit_per_pack"]) for o in atta["offers"]] == [
        ("Sharbati Select Atta", "Gupta Distributors", "54.00"),   # premium: ₹445, sells at ₹499 nearby
        ("Shree Chakki Atta", "Gupta Distributors", "40.00"),      # what the shop stocks, at its own ₹420
        ("Mill Fresh Loose Atta", "Metro Wholesale", "35.00"),
        ("Shree Chakki Atta", "Metro Wholesale", "25.00"),
    ]
    best = atta["offers"][0]
    assert best["best"] and best["quality"] == "PREMIUM" and best["monthly_profit"] == "1296.00"  # 54 x 6/week x 4
    assert offer(atta, "Shree Chakki Atta", "Gupta Distributors")["cheapest_for_current"]
    assert "₹14 more" in atta["recommendation"] and "₹336 more a month" in atta["recommendation"]
    assert any("premium" in n.lower() for n in atta["notes"])
    # Never above MRP; sometimes the brand already stocked is the best buy.
    assert all(o["mrp"] is None or float(o["sell_price"]) <= float(o["mrp"]) for o in atta["offers"])
    oil = sourcing(client, auth, "OIL1")
    assert oil["offers"][0]["brand"] == "SunGold Refined Oil" and oil["recommendation"].startswith("Keep SunGold")


def test_restock_plan_keeps_the_brand_stocked(client, auth):
    task = client.post("/api/v1/assistant/message", json={"text": "Weekend ke liye ₹5,000 ke andar stock arrange karo"},
                       headers=auth).json()["task"]
    sugar = next(line for line in task["plans"][0]["lines"] if line["name"] == "Sugar")
    assert sugar["unit_price"] == "42.00"  # not the cheaper loose sugar at ₹39


def test_buy_needs_approval_then_cost_brand_and_price_change(client, auth):
    before = items(client, auth)["ATTA10"]
    sharbati = offer(sourcing(client, auth, "ATTA10"), "Sharbati Select Atta", "Gupta Distributors")
    task = buy(client, auth, sharbati["quote_id"], 5, "499")
    assert task["state"] == "AWAITING_APPROVAL" and task["task_type"] == "RESTOCK"
    plan = task["plans"][0]
    assert plan["total"] == "2225.00" and plan["lines"][0]["brand"] == "Sharbati Select Atta"
    assert plan["purchase"]["sell_price"] == "499.00" and plan["purchase"]["from_brand"] == "Shree Chakki Atta"
    assert items(client, auth)["ATTA10"]["usable_packs"] == before["usable_packs"]  # nothing ordered yet

    task = approve_and_deliver(client, auth, task)
    assert task["state"] == "COMPLETED"
    after = items(client, auth)["ATTA10"]
    assert after["usable_packs"] == before["usable_packs"] + 5
    assert after["brand"] == "Sharbati Select Atta" and after["sell_price"] == "499.00"
    assert after["cost_price"] == "426.43"  # (2 x ₹380 + 5 x ₹445) / 7
    assert lots("ATTA10") == [(380, 2), (445, 5)]

    # Oldest stock sells first: 2 bags at ₹380, then 1 at ₹445.
    sale = say(client, auth, "Saathi, teen atta liye Mukul ne cash")["sale"]
    assert sale["lines"][0]["amount"] == "1497.00" and sale["lines"][0]["cost"] == "1205.00"
    assert lots("ATTA10") == [(380, 0), (445, 4)]

    # The new price applies from now on: the 24 bags sold before were sold at ₹420, and stay so.
    atta = next(i for i in client.get("/api/v1/profit", headers=auth).json()["items"] if i["name"] == "Atta")
    assert atta["revenue"] == "11577.00" and atta["cost"] == "10325.00" and atta["profit"] == "1252.00"  # 10,080 + 1,497
    assert client.get("/api/v1/dashboard", headers=auth).json()["last_week_sales"] == "9130.00"


def test_bought_from_a_bill_records_cost(client, auth):
    r = client.post("/api/v1/bills/text", json={"text": "Gupta Distributors\nSugar 1kg 10 x 40 = 400"}, headers=auth).json()
    lines = [{"product_id": ln["product_id"], "packs": ln["packs"], "unit_price": ln["unit_price"]} for ln in r["lines"]]
    assert client.post(f"/api/v1/bills/{r['id']}/confirm", json={"lines": lines}, headers=auth).status_code == 200
    assert lots("SUGAR1") == [(42, 8), (40, 10)] and items(client, auth)["SUGAR1"]["cost_price"] == "40.89"


def test_profit_answers_from_cost_and_selling_price(client, auth):
    # 24 bags sold in the last 4 weeks at ₹420, bought at ₹380.
    reply = ask(client, auth, "Atta pe kitna munafa hua?")
    assert "24 pack" in reply and "munafa ₹960" in reply and "₹40 har pack" in reply
    say(client, auth, "Saathi, atta liya Priya ne cash")
    report = client.get("/api/v1/profit", headers=auth).json()
    atta = next(i for i in report["items"] if i["name"] == "Atta")
    assert atta["packs_sold"] == 25 and atta["counter_packs"] == 1 and atta["profit"] == "1000.00"
    assert report["profit"] == "5358.00" and report["revenue"] == "39094.00"
    assert "kul munafa ₹5,358" in ask(client, auth, "kitna munafa hua?")
    # Last week's margin still answers "pichhle hafte".
    assert "Pichhle hafte ki bikri ₹9,130" in ask(client, auth, "pichhle hafte kitna munafa hua?")


def test_saathi_suggests_where_to_buy(client, auth):
    reply = ask(client, auth, "Atta kahan se lun?")
    assert "Sharbati Select Atta" in reply and "Gupta Distributors" in reply and "₹54" in reply


def test_undo_and_return_put_cost_back(client, auth):
    sale = say(client, auth, "Saathi, atta liya Mukul ne cash")["sale"]
    assert lots("ATTA10") == [(380, 1)] and sale["lines"][0]["cost"] == "380.00"
    client.post(f"/api/v1/soundbox/sales/{sale['id']}/undo", headers=auth)
    assert lots("ATTA10") == [(380, 2)]
    say(client, auth, "Saathi, atta liya Mukul ne udhaar")
    ret = say(client, auth, "Saathi, Mukul ne atta wapas kiya")["sale"]
    assert ret["kind"] == "RETURN" and ret["lines"][0]["cost"] == "380.00" and lots("ATTA10") == [(380, 2)]


def test_purchase_rules(client, auth):
    sharbati = offer(sourcing(client, auth, "ATTA10"), "Sharbati Select Atta", "Gupta Distributors")
    r = client.post("/api/v1/purchases", json={"quote_id": sharbati["quote_id"], "packs": 5, "sell_price": "600"}, headers=auth)
    assert r.status_code == 422 and r.json()["code"] == "ABOVE_MRP"
    other = login(client, "owner@storeb.demo")
    assert client.post("/api/v1/purchases", json={"quote_id": sharbati["quote_id"], "packs": 5}, headers=other).status_code == 404
    pid = items(client, auth)["ATTA10"]["product_id"]
    assert client.get(f"/api/v1/products/{pid}/sourcing", headers=other).status_code == 404
    # Default selling price: what nearby shops charge for that brand.
    task = buy(client, auth, sharbati["quote_id"], 2)
    assert task["plans"][0]["purchase"]["sell_price"] == "499.00"


def test_purchase_shortage_is_not_resourced_to_another_brand(client, auth):
    sungold = offer(sourcing(client, auth, "OIL1"), "SunGold Refined Oil", "Gupta Distributors")  # demo shortage
    task = buy(client, auth, sungold["quote_id"], 4)
    task = client.post(f"/api/v1/approvals/{task['pending_approval_id']}/confirm", headers={**auth, **idem()}).json()
    assert task["state"] == "FAILED" and len(task["plans"]) == 1 and "nothing else was ordered" in task["result_note"]
    # Gupta's other oil is in stock.
    blend = offer(sourcing(client, auth, "OIL1"), "Rice Bran Blend Oil", "Gupta Distributors")
    assert approve_and_deliver(client, auth, buy(client, auth, blend["quote_id"], 4))["state"] == "COMPLETED"
