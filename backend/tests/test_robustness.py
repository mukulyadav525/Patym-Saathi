from datetime import timedelta
from decimal import Decimal

from app.db import SessionLocal
from app.models import Inventory, Merchant, Product, SalesWeekly
from tests.conftest import login

GETS = ["/api/v1/dashboard", "/api/v1/brief", "/api/v1/tasks", "/api/v1/inventory", "/api/v1/orders", "/api/v1/invoices",
        "/api/v1/approvals", "/api/v1/connections", "/api/v1/audit", "/api/v1/tools", "/api/v1/growth/overview",
        "/api/v1/growth/festival", "/api/v1/growth/impact", "/api/v1/brief/speech", "/api/v1/growth/slow-movers",
        "/api/v1/offers", "/api/v1/khata", "/api/v1/cashflow", "/api/v1/settings/business", "/api/v1/benchmarks",
        "/api/v1/bills", "/api/v1/languages"]


def test_probe_other_merchant(client):
    other = login(client, "owner@storeb.demo")
    for path in GETS:
        r = client.get(path, headers=other)
        assert r.status_code == 200, (path, r.status_code, r.text[:300])


def test_probe_sparse_sales(client, auth):
    # new product with only 2 weeks of sales, and a product with no sales at all
    with SessionLocal() as db:
        m = db.query(Merchant).filter(Merchant.display_name == "Sharma Kirana Store").one()
        p = Product(merchant_id=m.id, sku="NEW1", name="New biscuit", name_hi="बिस्कुट", pack_label="pack", pack_size=1, sell_price=Decimal("20"), sort_order=99)
        q = Product(merchant_id=m.id, sku="NEW2", name="No sales item", name_hi="x", pack_label="pack", pack_size=1, sell_price=Decimal("20"), sort_order=100)
        db.add_all([p, q])
        db.flush()
        db.add_all([Inventory(merchant_id=m.id, product_id=p.id, on_hand_packs=50, source="SAMPLE"),
                    Inventory(merchant_id=m.id, product_id=q.id, on_hand_packs=5, source="SAMPLE")])
        last = db.query(SalesWeekly).filter(SalesWeekly.merchant_id == m.id).order_by(SalesWeekly.week_start.desc()).first().week_start
        db.add_all([SalesWeekly(merchant_id=m.id, product_id=p.id, week_start=last - timedelta(weeks=1), packs_sold=4, source="SAMPLE"),
                    SalesWeekly(merchant_id=m.id, product_id=p.id, week_start=last, packs_sold=1, source="SAMPLE")])
        db.commit()
    for path in GETS:
        r = client.get(path, headers=auth)
        assert r.status_code == 200, (path, r.status_code, r.text[:300])
    r = client.post("/api/v1/assistant/message", json={"text": "Weekend ke liye ₹5,000 ke andar stock arrange karo"}, headers=auth)
    assert r.status_code == 200, r.text[:300]


def _sharma(db):
    return db.query(Merchant).filter(Merchant.display_name == "Sharma Kirana Store").one()


def test_stale_sales_are_not_current_demand(client, auth):
    """A feed that stopped 2 months ago must not drive this week's plan."""
    from app.services.restock_flow import sales_window
    with SessionLocal() as db:
        m = _sharma(db)
        atta = db.query(Product).filter(Product.merchant_id == m.id, Product.sku == "ATTA10").one()
        # move all atta history 8 weeks back
        for row in db.query(SalesWeekly).filter(SalesWeekly.product_id == atta.id):
            row.week_start = row.week_start - timedelta(weeks=8)
        db.commit()
        assert all(w < sales_window()[0] for (w,) in db.query(SalesWeekly.week_start).filter(SalesWeekly.product_id == atta.id))
    plan = client.post("/api/v1/assistant/message", json={"text": "Weekend ke liye ₹5,000 ke andar stock arrange karo"},
                       headers=auth).json()["task"]["plans"][-1]
    assert "Atta" not in {line["name"] for line in plan["lines"]}
    assert any("Atta" in m for m in plan["missing"])


def test_missing_week_counts_as_zero_after_first_sale(client, auth):
    from app.services.restock_flow import sales_window
    with SessionLocal() as db:
        m = _sharma(db)
        tea = db.query(Product).filter(Product.merchant_id == m.id, Product.sku == "TEA250").one()
        # drop the second-latest week's record (POS skipped a zero-sale week)
        db.query(SalesWeekly).filter(SalesWeekly.product_id == tea.id, SalesWeekly.week_start == sales_window()[2]).delete()
        db.commit()
    weekly = client.get("/api/v1/dashboard", headers=auth).json()["weekly_sales"]
    assert len(weekly) == 4 and [w["week_start"] for w in weekly] == [d.isoformat() for d in sales_window()]
    slow = client.get("/api/v1/growth/slow-movers", headers=auth).json()
    assert all(len(i["weekly_sales"]) <= 4 for i in slow)
