"""Fuller demo data on top of the core seed: about ten records per set, so every screen looks like a shop that has
been using Saathi for a while (more items, khata customers, invoices, past supplier orders, supplier bills, offers,
Soundbox bills and QR payments). The core seed (and the tests) stay exactly as they were; this is added only when
DEMO_RICH_DATA is on (the default for `python -m app.seed` and demo resets)."""

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import (
    IST,
    AuditEvent,
    CounterSale,
    GoodsReceipt,
    Inventory,
    Invoice,
    KhataEntry,
    MerchantLoan,
    Offer,
    Order,
    OrderLine,
    PeerBenchmark,
    Plan,
    Product,
    QrPayment,
    SalesEvent,
    SalesWeekly,
    StockLot,
    Supplier,
    SupplierQuote,
    Task,
)
from app.services.common import canonical_hash

# sku, name, name_hi, pack, stock, sales w1..w4, cost A, cost B, sell, brand, MRP, festival (week, normal), peers/week
EXTRA_PRODUCTS = [
    ("SALT1", "Salt", "नमक", "1 kg", 24, [10, 9, 11, 10], "20", "21", "25", "Shudh Namak", "28", (14, "10"), "11"),
    ("BISCUIT8", "Glucose biscuits", "ग्लूकोज़ बिस्कुट", "800 g", 15, [5, 6, 5, 6], "78", "80", "90", "Suraj Glucose", "95", (9, "5"), "6"),
    ("SOAP4", "Bathing soap", "नहाने का साबुन", "pack of 4", 12, [3, 3, 4, 3], "118", "122", "140", "Neem Fresh Soap", "150", (6, "3"), "4"),
]

# Four more khata customers (10 in all): name, masked phone, [(days ago, kind, amount, note)]
EXTRA_KHATA = [
    ("Sunita Devi", "+91 90000 0X071", [(-40, "CREDIT", "650", "Monthly ration"), (-31, "PAYMENT", "650", "Cash"),
                                        (-8, "CREDIT", "480", "Atta, dal")]),
    ("Arjun Mehta", "+91 90000 0X074", [(-26, "CREDIT", "300", "Tea, sugar"), (-24, "PAYMENT", "300", "UPI"),
                                        (-6, "CREDIT", "220", "Atta 5 kg")]),
    ("Kavita Joshi", "+91 90000 0X077", [(-50, "CREDIT", "900", "Festival order"), (-20, "PAYMENT", "500", "Part payment"),
                                         (-3, "CREDIT", "190", "Oil")]),
    ("Ramesh Tailor", "+91 90000 0X079", [(-15, "CREDIT", "140", "Soap"), (-14, "PAYMENT", "140", "Cash")]),
]

# Seven more invoices (10 in all): number, customer, phone, amount, due (days from today), status
EXTRA_INVOICES = [
    ("INV-1044", "Gupta Sweets", "+91 90000 0X051", "1000", 5, "PENDING"),
    ("INV-1045", "Kavita Joshi", "+91 90000 0X077", "400", -2, "PENDING"),
    ("INV-1046", "Sunita Devi", "+91 90000 0X071", "480", 6, "PENDING"),
    ("INV-1031", "Aman Stores", "+91 90000 0X042", "1500", -32, "PAID"),
    ("INV-1033", "Verma Tea Stall", "+91 90000 0X038", "500", -35, "PAID"),
    ("INV-1036", "Rao General", "+91 90000 0X035", "700", -54, "PAID"),
    ("INV-1040", "Arjun Mehta", "+91 90000 0X074", "300", -25, "PAID"),
]

# Past restocks: (days ago, budget, [(supplier code, sku, packs)])  -> 5 completed tasks, 10 supplier orders
PAST_RESTOCKS = [
    (27, "4500", [("A", "ATTA10", 6), ("A", "SUGAR1", 20), ("B", "TOOR1", 8), ("B", "OIL1", 6)]),
    (22, "3000", [("A", "RICE5", 5), ("A", "TEA250", 6), ("B", "SALT1", 20)]),
    (16, "5000", [("A", "ATTA10", 7), ("A", "SUGAR1", 20), ("B", "OIL1", 9), ("B", "BISCUIT8", 10)]),
    (11, "2500", [("A", "TOOR1", 8), ("B", "SOAP4", 6), ("B", "TEA250", 6)]),
    (5, "4000", [("A", "ATTA10", 6), ("A", "RICE5", 4), ("B", "SUGAR1", 20), ("B", "OIL1", 4)]),
]

# Ten supplier bills read and confirmed: (days ago, supplier code, [(sku, packs)])
PAST_BILLS = [
    (29, "A", [("ATTA10", 4), ("SUGAR1", 10)]), (26, "B", [("OIL1", 6)]), (24, "A", [("TEA250", 6), ("SALT1", 10)]),
    (20, "B", [("TOOR1", 5), ("BISCUIT8", 6)]), (18, "A", [("RICE5", 3)]), (15, "B", [("SOAP4", 6), ("SALT1", 10)]),
    (12, "A", [("ATTA10", 5), ("TOOR1", 4)]), (9, "B", [("SUGAR1", 15)]), (7, "A", [("NOODLE12", 4), ("TEA250", 4)]),
    (4, "B", [("OIL1", 5), ("BISCUIT8", 5)]),
]

# Ten offers drafted and shared over the last weeks: (days ago, sku, discount %, status)
PAST_OFFERS = [
    (25, "NOODLE12", 10, "SHARED"), (21, "HAIROIL", 15, "SHARED"), (19, "TEA250", 5, "SHARED"), (17, "SOAP4", 10, "SHARED"),
    (14, "NOODLE12", 15, "SHARED"), (12, "BISCUIT8", 5, "SHARED"), (10, "HAIROIL", 10, "DRAFTED"), (8, "SALT1", 5, "SHARED"),
    (5, "OIL1", 5, "SHARED"), (2, "NOODLE12", 20, "DRAFTED"),
]

# Ten Soundbox bills from this morning: (hour, minute, customer or None, [(sku, packs)], mode)
COUNTER_BILLS = [
    (8, 5, "Priya Sharma", [("SUGAR1", 2), ("TEA250", 1)], "UPI"),
    (8, 20, None, [("BISCUIT8", 1)], "CASH"),
    (8, 42, "Mukul Yadav", [("ATTA5", 1)], "CASH"),
    (9, 10, "Sunita Devi", [("TOOR1", 1), ("SALT1", 1)], "UDHAAR"),
    (9, 31, None, [("SOAP4", 1)], "UPI"),
    (9, 55, "Arjun Mehta", [("TEA250", 1), ("SUGAR1", 1)], "CASH"),
    (10, 12, None, [("NOODLE12", 1)], "UPI"),
    (10, 40, "Kavita Joshi", [("OIL1", 1)], "UDHAAR"),
    (11, 3, "Ramesh Tailor", [("SALT1", 2), ("BISCUIT8", 1)], "UPI"),
    (11, 25, None, [("SUGAR1", 1)], "CASH"),
]
# Ten QR payments: the four UPI bills above, and six walk-in payments with no bill
WALK_IN_QR = [(7, 52, "150"), (8, 33, "60"), (9, 4, "240"), (9, 48, "35"), (10, 26, "500"), (11, 14, "90")]

# Two finished loans before the current one (3 in all)
PAST_LOANS = [("Paytm Merchant Loan", Decimal("25000"), Decimal("200"), 400, 250),
              ("Paytm Merchant Loan", Decimal("35000"), Decimal("250"), 240, 110)]


def _at(day: date, hour: int, minute: int) -> datetime:
    return datetime.combine(day, time(hour, minute), tzinfo=IST)


def add(db: Session, merchant, user_id: uuid.UUID, suppliers: dict[str, Supplier], today: date, now: datetime) -> None:
    mid = merchant.id
    this_monday = today - timedelta(days=today.weekday())
    week_starts = [this_monday - timedelta(weeks=n) for n in (4, 3, 2, 1)]
    order = 100
    for sku, name, name_hi, pack, stock, sales, cost_a, cost_b, sell, brand, mrp, (fest, normal), peers in EXTRA_PRODUCTS:
        order += 1
        p = Product(merchant_id=mid, sku=sku, name=name, name_hi=name_hi, pack_label=pack, pack_size=1,
                    sell_price=Decimal(sell), sort_order=order, brand=brand)
        db.add(p)
        db.flush()
        db.add(Inventory(merchant_id=mid, product_id=p.id, on_hand_packs=stock, source="SAMPLE"))
        for week_start, sold in zip(week_starts, sales, strict=True):
            db.add(SalesWeekly(merchant_id=mid, product_id=p.id, week_start=week_start, packs_sold=sold, source="SAMPLE",
                               unit_price=Decimal(sell)))
        db.add(SalesEvent(merchant_id=mid, product_id=p.id, event_code="DIWALI", event_name="Diwali",
                          event_date=date(2025, 10, 20), event_week_packs=fest, baseline_weekly_packs=Decimal(normal),
                          source="SAMPLE"))
        db.add(PeerBenchmark(merchant_id=mid, product_id=p.id, locality=merchant.locality, peer_median_weekly=Decimal(peers),
                             peer_count=18, period_label="Last 4 weeks", source="SAMPLE"))
        for code, cost in (("A", cost_a), ("B", cost_b)):
            db.add(SupplierQuote(supplier_id=suppliers[code].id, product_id=p.id, unit_price=Decimal(cost), available_packs=40,
                                 valid_until=now + timedelta(hours=12), brand=brand, quality="STANDARD",
                                 quality_note="Everyday brand", mrp=Decimal(mrp), typical_sell_price=Decimal(sell)))
        db.add(StockLot(merchant_id=mid, product_id=p.id, source="SAMPLE", brand=brand, supplier_name=suppliers["A"].name,
                        unit_cost=Decimal(cost_a), packs_in=stock + sum(sales), packs_left=stock,
                        received_at=datetime.combine(week_starts[0] - timedelta(days=1), time(10), tzinfo=IST)))
    db.flush()
    products = {p.sku: p for p in db.query(Product).filter(Product.merchant_id == mid)}
    quotes = {(q.supplier_id, q.product_id): q for q in db.query(SupplierQuote).join(Product, Product.id == SupplierQuote.product_id)
              .filter(Product.merchant_id == mid, SupplierQuote.brand == Product.brand)}

    for customer, phone, entries in EXTRA_KHATA:
        for offset, kind, amount, note in entries:
            db.add(KhataEntry(merchant_id=mid, customer_name=customer, customer_phone_masked=phone,
                              entry_date=today + timedelta(days=offset), kind=kind, amount=Decimal(amount), note=note, source="SAMPLE"))

    for number, customer, phone, amount, due, status in EXTRA_INVOICES:
        paid_on = _at(today + timedelta(days=due + 2), 12, 0) if status == "PAID" else None
        db.add(Invoice(merchant_id=mid, customer_name=customer, customer_phone_masked=phone, invoice_number=number,
                       amount=Decimal(amount), status=status, due_date=today + timedelta(days=due), paid_at=paid_on,
                       created_at=_at(today + timedelta(days=due - 7), 10, 0)))

    ref = 0
    for days_ago, budget, picks in PAST_RESTOCKS:
        when = _at(today - timedelta(days=days_ago), 18, 30)
        lines = []
        for code, sku, packs in picks:
            p, q = products[sku], quotes[(suppliers[code].id, products[sku].id)]
            lines.append({"product_id": str(p.id), "name": p.name, "pack_label": p.pack_label, "sold_per_week": "0", "stock": 0,
                          "forecast": packs, "packs": packs, "supplier_id": str(suppliers[code].id),
                          "supplier_name": suppliers[code].name, "quote_id": str(q.id), "unit_price": f"{q.unit_price:.2f}",
                          "line_total": f"{q.unit_price * packs:.2f}", "status": "NEW", "uplift": None})
        total = sum((Decimal(ln["line_total"]) for ln in lines), Decimal("0"))
        task = Task(merchant_id=mid, task_type="RESTOCK", state="COMPLETED", title=f"Restock within ₹{Decimal(budget):,.0f}",
                    input_text=f"Weekend ke liye ₹{Decimal(budget):,.0f} ke andar stock arrange karo", input_channel="VOICE",
                    parsed_intent={"intent": "RESTOCK", "budget": f"{Decimal(budget):.2f}", "horizon_days": 7},
                    result_note="Goods received; stock updated", created_by=user_id, correlation_id=uuid.uuid4().hex[:16],
                    created_at=when, updated_at=when + timedelta(days=1))
        db.add(task)
        db.flush()
        payload = {"lines": lines, "total_packs": sum(ln["packs"] for ln in lines), "unfillable": [], "assumptions": [],
                   "evidence": {"items": [], "quotes": [], "sources": ["Sales: 4-week POS history (SAMPLE)"], "missing": []},
                   "diff": [], "horizon_days": 7, "festival": None}
        plan = Plan(task_id=task.id, version=1, budget=Decimal(budget), total=total, committed_total=total, payload=payload,
                    payload_hash=canonical_hash(payload), status="ACTIVE", reason="Initial plan", created_at=when)
        db.add(plan)
        db.flush()
        for code in ("A", "B"):
            mine = [ln for ln in lines if ln["supplier_id"] == str(suppliers[code].id)]
            if not mine:
                continue
            ref += 1
            o = Order(merchant_id=mid, task_id=task.id, plan_id=plan.id, supplier_id=suppliers[code].id, reference=f"PO-{1000 + ref}",
                      status="GOODS_RECEIVED", total=sum((Decimal(ln["line_total"]) for ln in mine), Decimal("0")),
                      idempotency_key=f"seed-{uuid.uuid4().hex}", connector_mode="SIMULATED", created_at=when,
                      updated_at=when + timedelta(days=1))
            db.add(o)
            db.flush()
            for ln in mine:
                db.add(OrderLine(order_id=o.id, product_id=uuid.UUID(ln["product_id"]), packs=ln["packs"],
                                 unit_price=Decimal(ln["unit_price"]), line_total=Decimal(ln["line_total"]),
                                 quote_id=uuid.UUID(ln["quote_id"]), line_status="ACCEPTED"))
        db.add(AuditEvent(merchant_id=mid, actor="saathi", task_id=task.id, event_type="GOODS_RECEIVED", entity_type="task",
                          entity_id=str(task.id), summary=f"Goods received for {task.title} (₹{total:,.0f})", details_redacted={},
                          created_at=when + timedelta(days=1)))

    for days_ago, code, picks in PAST_BILLS:
        when = _at(today - timedelta(days=days_ago), 16, 0)
        lines = []
        for sku, packs in picks:
            p, q = products[sku], quotes[(suppliers[code].id, products[sku].id)]
            lines.append({"product_id": str(p.id), "name": p.name, "pack_label": p.pack_label, "packs": packs,
                          "unit_price": f"{q.unit_price:.2f}", "line_total": f"{q.unit_price * packs:.2f}", "source_text": None})
        db.add(GoodsReceipt(merchant_id=mid, source="TEXT" if days_ago % 2 else "PHOTO", supplier_name=suppliers[code].name,
                            raw_text="", lines=lines, total=sum((Decimal(ln["line_total"]) for ln in lines), Decimal("0")),
                            status="CONFIRMED", created_by=user_id, confirmed_by=user_id, created_at=when, confirmed_at=when))

    for days_ago, sku, pct, status in PAST_OFFERS:
        p = products[sku]
        price = (p.sell_price * (100 - pct) / 100).quantize(Decimal("1"))
        db.add(Offer(merchant_id=mid, product_id=p.id, discount_pct=pct, offer_price=price,
                     message=f"{merchant.display_name}: {p.name} ({p.pack_label}) ab sirf ₹{price:,.0f} (MRP se {pct}% kam). Aaj hi le jaiye!",
                     status=status, created_by=user_id, created_at=_at(today - timedelta(days=days_ago), 11, 0)))

    bill_no = 0
    for hour, minute, customer, picks, mode in COUNTER_BILLS:
        bill_no += 1
        when = _at(today, hour, minute)
        lines = [{"product_id": str(products[s].id), "sku": s, "name": products[s].name, "pack_label": products[s].pack_label,
                  "packs": n, "unit_price": f"{products[s].sell_price:.2f}", "amount": f"{products[s].sell_price * n:.2f}"}
                 for s, n in picks]
        total = sum((Decimal(ln["amount"]) for ln in lines), Decimal("0"))
        sale = CounterSale(merchant_id=mid, bill_number=f"SB-{bill_no:04d}", kind="SALE", customer_name=customer, lines=lines,
                           total=total, payment_mode=mode, payment_status={"UDHAAR": "ON_KHATA"}.get(mode, "PAID"),
                           status="RECORDED", applied={"stock": [], "lots": []}, understood_by="sarvam-105b",
                           transcript=f"Saathi, {customer or 'customer'} ne " + ", ".join(ln["name"] for ln in lines) + " liya",
                           created_by=user_id, created_at=when, recorded_at=when)
        db.add(sale)
        db.flush()
        if mode == "UDHAAR":
            phone = next((c[1] for c in EXTRA_KHATA if c[0] == customer), "—")
            db.add(KhataEntry(merchant_id=mid, customer_name=customer, customer_phone_masked=phone, entry_date=today, kind="CREDIT",
                              amount=total, note=f"{sale.bill_number} (Soundbox)", source="SOUNDBOX"))
        if mode == "UPI":
            qr = QrPayment(merchant_id=mid, amount=total, payer=customer or "Customer", txn_id=f"DEMO{uuid.uuid4().hex[:16].upper()}",
                           mode="DEMO", sale_id=sale.id, created_at=when + timedelta(minutes=1))
            db.add(qr)
            db.flush()
            sale.qr_payment_id = qr.id
    for hour, minute, amount in WALK_IN_QR:
        db.add(QrPayment(merchant_id=mid, amount=Decimal(amount), payer="Customer", txn_id=f"DEMO{uuid.uuid4().hex[:16].upper()}",
                         mode="DEMO", created_at=_at(today, hour, minute)))

    for product, sanctioned, daily, ago, ended in PAST_LOANS:
        db.add(MerchantLoan(merchant_id=mid, product=product, sanctioned=sanctioned, outstanding=Decimal("0"),
                            daily_installment=daily, started_on=today - timedelta(days=ago),
                            ends_on=today - timedelta(days=ended), status="CLOSED"))
