"""New items: added by hand in Inventory, or from a supplier bill line Saathi didn't recognise."""

from tests.test_soundbox import say


def test_add_product_by_hand(client, auth):
    r = client.post("/api/v1/products", json={"name": "Parle-G Biscuit", "name_hi": "पारले-जी बिस्कुट", "pack_label": "800 g",
                                               "sell_price": "90", "opening_stock": 12, "cost_price": "78"}, headers=auth)
    assert r.status_code == 200, r.text
    item = r.json()
    assert item["usable_packs"] == 12 and item["sell_price"] == "90.00" and item["cost_price"] == "78.00"
    assert any(i["name"] == "Parle-G Biscuit" for i in client.get("/api/v1/inventory", headers=auth).json())
    again = client.post("/api/v1/products", json={"name": "parle-g biscuit", "pack_label": "800 g", "sell_price": "90"}, headers=auth)
    assert again.status_code == 409 and again.json()["code"] == "ALREADY_LISTED"
    bad = client.post("/api/v1/products", json={"name": "X Item", "sell_price": "50", "cost_price": "60"}, headers=auth)
    assert bad.json()["code"] == "COST_ABOVE_PRICE"
    # Every screen keeps working with an item that has no sales history yet.
    for path in ("/api/v1/dashboard", "/api/v1/brief", "/api/v1/growth/overview", "/api/v1/profit", "/api/v1/cashflow",
                 "/api/v1/benchmarks", "/api/v1/growth/slow-movers", f"/api/v1/products/{item['product_id']}/sourcing"):
        assert client.get(path, headers=auth).status_code == 200, path


def test_new_item_is_sold_by_voice(client, auth):
    client.post("/api/v1/products", json={"name": "Parle-G Biscuit", "pack_label": "800 g", "sell_price": "90",
                                          "opening_stock": 5}, headers=auth)
    r = say(client, auth, "Saathi, do biscuit diye Mukul ko cash")
    assert r["action"] == "RECORDED" and r["sale"]["lines"][0]["name"] == "Parle-G Biscuit" and r["sale"]["total"] == "180.00"


def test_bill_with_new_item_can_add_it(client, auth):
    bill = client.post("/api/v1/bills/text", json={"text": "Metro Wholesale Traders\nAtta 10kg x 2 @ 385 = 770\n"
                                                            "Parle-G Biscuit 800g x 10 @ 78 = 780\nTotal 1550"}, headers=auth).json()
    assert [ln["name"] for ln in bill["lines"]] == ["Atta"]
    new = bill["new_items"][0]
    assert new["name"] == "Parle-G Biscuit" and new["pack_label"] == "800 g" and new["packs"] == 10 and new["unit_price"] == "78.00"
    added = client.post(f"/api/v1/bills/{bill['id']}/new-item", json={"name": new["name"], "pack_label": new["pack_label"],
                                                                      "sell_price": "90", "packs": new["packs"],
                                                                      "unit_price": new["unit_price"]}, headers=auth)
    assert added.status_code == 200, added.text
    lines = [{"product_id": ln["product_id"], "packs": ln["packs"], "unit_price": ln["unit_price"]} for ln in added.json()["lines"]]
    assert len(lines) == 2
    done = client.post(f"/api/v1/bills/{bill['id']}/confirm", json={"lines": lines}, headers=auth)
    assert done.status_code == 200, done.text
    item = next(i for i in client.get("/api/v1/inventory", headers=auth).json() if i["name"] == "Parle-G Biscuit")
    assert item["usable_packs"] == 10 and item["cost_price"] == "78.00"


def test_size_on_bill_picks_the_right_atta(client, auth):
    bill = client.post("/api/v1/bills/text", json={"text": "Atta 5kg x 4 @ 200 = 800\nAtta 10kg x 1 @ 385 = 385"}, headers=auth).json()
    assert [(ln["name"], ln["packs"]) for ln in bill["lines"]] == [("Atta 5 kg", 4), ("Atta", 1)]
