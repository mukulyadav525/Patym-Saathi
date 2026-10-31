"""Soundbox: wake word, counter entries into stock / khata / payments, questions back, QR payments, undo, live feed."""

import json

import pytest
from sqlalchemy import select

from app.adapters import sarvam
from app.db import SessionLocal
from app.models import Inventory, KhataEntry, Merchant, Product
from app.services import soundbox
from tests.conftest import login


def say(client, auth, text, followup=False):
    r = client.post("/api/v1/soundbox/text", json={"text": text, "followup": followup, "speak": False}, headers=auth)
    assert r.status_code == 200, r.text
    return r.json()


def stock(sku):
    with SessionLocal() as db:
        return db.scalars(select(Inventory.on_hand_packs).join(Product, Product.id == Inventory.product_id)
                          .join(Merchant, Merchant.id == Inventory.merchant_id)
                          .where(Product.sku == sku, Merchant.display_name == "Sharma Kirana Store")).one()


def khata(name, source="SOUNDBOX"):
    """Soundbox entries for a customer, sorted (same-day entries have no order of their own)."""
    with SessionLocal() as db:
        return sorted((e.kind, f"{e.amount:.0f}", e.source) for e in db.scalars(
            select(KhataEntry).where(KhataEntry.customer_name == name, KhataEntry.source == source)))


@pytest.mark.parametrize("heard,command", [
    ("Saathi, atta liya Mukul ne", "atta liya Mukul ne"),
    ("haan saathi do cheeni di", "do cheeni di"),
    ("Hey Sathi atta", "atta"),
    ("साथी आटा लिया", "आटा लिया"),
    ("Saathi", ""),
    ("atta liya Mukul ne", None),
    ("kal Mukul bola ki saathi log aayenge", None),  # "saathi" inside a sentence is chatter
    ("Bhaiya saathi log aaye", None),
    ("Saath hi, Priya ne chai patti li", "Priya ne chai patti li"),  # how Saaras often writes "Saathi"
    ("Sarthi atta liya", "atta liya"),
])
def test_wake_word(heard, command):
    assert soundbox.split_wake(heard) == command


def test_saath_hi_chatter_stays_silent(client, auth):
    assert say(client, auth, "saath hi mein woh bhi aaya tha")["action"] == "IGNORED"
    assert say(client, auth, "Saath hi, chai patti di Priya ko cash")["action"] == "RECORDED"


def test_chatter_without_wake_word_is_ignored(client, auth):
    before = stock("ATTA10")
    r = say(client, auth, "atta liya Mukul ne udhaar mein")
    assert r["action"] == "IGNORED" and r["reply"] == "" and stock("ATTA10") == before


def test_sale_on_udhaar_moves_stock_and_khata(client, auth):
    before = stock("ATTA10")
    r = say(client, auth, "Saathi, atta liya Mukul ne udhaar mein")
    assert r["action"] == "RECORDED", r
    sale = r["sale"]
    assert sale["bill_number"] == "SB-0001" and sale["customer_name"] == "Mukul Yadav"
    assert sale["total"] == "420.00" and sale["payment_mode"] == "UDHAAR" and sale["payment_status"] == "ON_KHATA"
    assert stock("ATTA10") == before - 1
    assert khata("Mukul Yadav") == [("CREDIT", "420", "SOUNDBOX")]
    assert "Mukul Yadav ke khate mein ₹420" in r["reply"] and "₹420 baaki" in r["reply"]
    k = client.get("/api/v1/khata", headers=auth).json()
    assert next(c for c in k["customers"] if c["customer_name"] == "Mukul Yadav")["outstanding"] == "420.00"


def test_asks_paid_or_udhaar_then_records(client, auth):
    before = stock("ATTA10")
    r = say(client, auth, "Saathi, atta liya Mukul ne")
    assert r["action"] == "ASKED" and r["expects_reply"] and "udhaar" in r["reply"].lower()
    assert stock("ATTA10") == before  # nothing changes while asking
    r = say(client, auth, "udhaar", followup=True)  # no wake word needed for the answer
    assert r["action"] == "RECORDED" and r["sale"]["payment_mode"] == "UDHAAR"
    assert stock("ATTA10") == before - 1


def test_answer_without_followup_or_wake_word_is_ignored(client, auth):
    say(client, auth, "Saathi, atta liya Mukul ne")
    assert say(client, auth, "udhaar")["action"] == "IGNORED"
    assert say(client, auth, "Saathi cash")["action"] == "RECORDED"  # short answer with the wake word also works


def test_qr_payment_answers_the_question(client, auth):
    r = say(client, auth, "Saathi, do cheeni di Priya ko")
    assert r["action"] == "ASKED" and r["sale"]["total"] == "96.00"
    pay = client.post("/api/v1/soundbox/qr-payments", json={"amount": "96"}, headers=auth).json()
    assert pay["bill_number"] == "SB-0001" and pay["customer_name"] == "Priya Sharma"
    today = client.get("/api/v1/soundbox/today", headers=auth).json()
    assert today["upi"] == "96.00" and today["pending"] is None and today["entries"][0]["payment_status"] == "PAID"
    events = client.get("/api/v1/live?after=0&wait=0", headers=auth).json()["events"]
    qr_event = next(e for e in events if e["kind"] == "QR_PAYMENT")
    assert qr_event["announce"].startswith("Paytm par 96 rupaye prapt hue") and "SB-0001" in qr_event["announce"]


def test_payment_that_arrived_first_is_linked(client, auth):
    client.post("/api/v1/soundbox/qr-payments", json={"amount": "150", "payer": "Priya"}, headers=auth)
    r = say(client, auth, "Saathi, chai di Priya ko, paise de diye")
    assert r["action"] == "RECORDED" and r["sale"]["payment_mode"] == "UPI" and r["sale"]["payment_status"] == "PAID"
    assert "Paytm UPI se payment mil gaya" in r["reply"]


def test_upi_said_but_not_yet_paid_is_awaited_then_linked(client, auth):
    r = say(client, auth, "Saathi, toor dal di Mukul ko UPI se")
    assert r["sale"]["payment_status"] == "AWAITED"
    client.post("/api/v1/soundbox/qr-payments", json={"amount": "170"}, headers=auth)
    assert client.get("/api/v1/soundbox/today", headers=auth).json()["entries"][0]["payment_status"] == "PAID"


def test_walk_in_asks_cash_or_upi(client, auth):
    r = say(client, auth, "Saathi, ek maggi becha")
    assert r["action"] == "ASKED" and r["sale"]["question"] == "PAYMENT_NOW"
    r = say(client, auth, "cash", followup=True)
    assert r["action"] == "RECORDED" and r["sale"]["customer_name"] is None and r["sale"]["payment_mode"] == "CASH"


def test_new_customer_khata_needs_confirmation(client, auth):
    r = say(client, auth, "Saathi, chawal liya Rohan ne udhaar")
    assert r["action"] == "ASKED" and r["sale"]["question"] == "NEW_CUSTOMER" and "Rohan" in r["reply"]
    r = say(client, auth, "haan khol do", followup=True)
    assert r["action"] == "RECORDED" and "Naya khata khola" in r["reply"]
    assert khata("Rohan") == [("CREDIT", "345", "SOUNDBOX")]


def test_new_customer_declined_falls_back_to_paid(client, auth):
    say(client, auth, "Saathi, chawal liya Rohan ne udhaar")
    r = say(client, auth, "nahi", followup=True)
    assert r["action"] == "ASKED" and r["sale"]["question"] == "PAYMENT_NOW"
    r = say(client, auth, "UPI", followup=True)
    assert r["action"] == "RECORDED" and khata("Rohan") == []


def test_units_convert_to_packs(client, auth):
    r = say(client, auth, "Saathi, do kilo cheeni li Priya ne cash")
    assert r["sale"]["lines"][0]["packs"] == 2 and r["sale"]["total"] == "96.00"


def test_unknown_item_is_not_recorded(client, auth):
    r = say(client, auth, "Saathi, biscuit liya Mukul ne udhaar")
    assert r["action"] == "NOT_UNDERSTOOD" and client.get("/api/v1/soundbox/today", headers=auth).json()["bills"] == 0


def test_khata_payment_by_voice(client, auth):
    say(client, auth, "Saathi, atta liya Mukul ne udhaar")
    r = say(client, auth, "Saathi, Mukul ne 300 diye")
    assert r["action"] == "RECORDED" and r["sale"]["kind"] == "PAYMENT" and r["sale"]["payment_mode"] == "CASH"
    assert "₹120 baaki" in r["reply"] and ("PAYMENT", "300", "SOUNDBOX") in khata("Mukul Yadav")


def test_return_puts_stock_back_and_reduces_dues(client, auth):
    say(client, auth, "Saathi, atta liya Mukul ne udhaar")
    before = stock("ATTA10")
    r = say(client, auth, "Saathi, Mukul ne atta wapas kiya")
    assert r["action"] == "RECORDED" and r["sale"]["kind"] == "RETURN" and r["sale"]["payment_mode"] == "UDHAAR"
    assert stock("ATTA10") == before + 1 and ("PAYMENT", "420", "SOUNDBOX") in khata("Mukul Yadav")


def test_cancel_reverses_exactly(client, auth):
    before = stock("ATTA10")
    say(client, auth, "Saathi, atta liya Mukul ne udhaar")
    r = say(client, auth, "Saathi, galat ho gaya, cancel karo")
    assert r["action"] == "CANCELLED" and "SB-0001 hata diya" in r["reply"]
    assert stock("ATTA10") == before and khata("Mukul Yadav") == []


def test_undo_button_and_isolation(client, auth):
    sale = say(client, auth, "Saathi, chai di Priya ko cash")["sale"]
    other = login(client, "owner@storeb.demo")
    assert client.post(f"/api/v1/soundbox/sales/{sale['id']}/undo", headers=other).status_code == 404
    r = client.post(f"/api/v1/soundbox/sales/{sale['id']}/undo", headers=auth)
    assert r.status_code == 200 and r.json()["status"] == "CANCELLED"
    assert client.post(f"/api/v1/soundbox/sales/{sale['id']}/undo", headers=auth).json()["code"] == "NOT_UNDOABLE"


def test_sale_beyond_recorded_stock_is_flagged(client, auth):
    r = say(client, auth, "Saathi, teen atta liye Mukul ne cash")  # only 2 in stock
    assert r["action"] == "RECORDED" and "sirf 2 pack tha" in r["reply"] and stock("ATTA10") == 0


def test_live_feed_cursor_and_events(client, auth):
    cursor = client.get("/api/v1/live", headers=auth).json()["cursor"]
    say(client, auth, "Saathi, chai di Priya ko cash")
    feed = client.get(f"/api/v1/live?after={cursor}&wait=0", headers=auth).json()
    assert [e["kind"] for e in feed["events"]] == ["COUNTER_SALE"] and feed["cursor"] > cursor
    assert "Priya Sharma" in feed["events"][0]["title"]
    other = login(client, "owner@storeb.demo")
    assert client.get(f"/api/v1/live?after={cursor}&wait=0", headers=other).json()["events"] == []


def test_public_pay_page_token(client, auth):
    path = client.get("/api/v1/soundbox/qr", headers=auth).json()["pay_path"]
    token = path.rsplit("/", 1)[1]
    assert client.get(f"/api/v1/pay/{token}").json()["shop_name"] == "Sharma Kirana Store"
    forged = token[:32] + "0" * 20
    assert client.get(f"/api/v1/pay/{forged}").status_code == 404
    paid = client.post(f"/api/v1/pay/{token}", json={"amount": "250", "payer": "Ravi"})
    assert paid.status_code == 200 and paid.json()["mode"] == "DEMO"
    assert client.post(f"/api/v1/pay/{token}", json={"amount": "NaN"}).status_code == 422


def _fake_llm(monkeypatch, content):
    class Resp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": json.dumps(content)}}]}

    monkeypatch.setattr(sarvam, "enabled", lambda: True)
    monkeypatch.setattr(sarvam, "romanize", lambda t: t)
    monkeypatch.setattr(soundbox.httpx, "post", lambda *a, **k: Resp())


def test_llm_understanding_is_used_and_checked(client, auth, monkeypatch):
    _fake_llm(monkeypatch, {"intent": "SALE", "customer": "Mukul", "payment": "UDHAAR", "amount": None,
                            "items": [{"product": "Sugar", "quantity": 3, "unit": "pack"},
                                      {"product": "Caviar", "quantity": 1, "unit": "pack"}]})
    r = say(client, auth, "Saathi, Mukul ko teen cheeni aur kuch aur diya khate mein")
    assert r["action"] == "RECORDED" and r["understood_by"].startswith("sarvam")
    assert r["sale"]["lines"] == [{"product_id": r["sale"]["lines"][0]["product_id"], "sku": "SUGAR1", "name": "Sugar", "pack_label": "1 kg",
                                   "packs": 3, "unit_price": "48.00", "amount": "144.00"}]  # price from the catalog
    assert "list mein nahi mila" in r["reply"]


def test_llm_amount_must_be_spoken(client, auth, monkeypatch):
    _fake_llm(monkeypatch, {"intent": "PAYMENT", "customer": "Mukul", "payment": "CASH", "amount": 5000, "items": []})
    r = say(client, auth, "Saathi, Mukul ne paanch sau diye")
    assert r["action"] == "ASKED" and r["sale"]["question"] == "AMOUNT"
    r = say(client, auth, "500", followup=True)
    assert r["action"] == "RECORDED" and r["sale"]["total"] == "500.00"


def test_model_cannot_guess_payment_mode(client, auth, monkeypatch):
    _fake_llm(monkeypatch, {"intent": "SALE", "customer": "Mukul", "payment": "UDHAAR", "amount": None,
                            "items": [{"product": "Atta", "quantity": 1, "unit": "pack"}]})
    r = say(client, auth, "Saathi atta liya Mukul ne")
    assert r["action"] == "ASKED" and r["sale"]["question"] == "PAYMENT" and khata("Mukul Yadav") == []


def test_spoken_udhaar_overrides_model(client, auth, monkeypatch):
    _fake_llm(monkeypatch, {"intent": "SALE", "customer": "Mukul", "payment": "CASH", "amount": None,
                            "items": [{"product": "Atta", "quantity": 1, "unit": "pack"}]})
    assert say(client, auth, "Saathi atta liya Mukul ne udhaar")["sale"]["payment_mode"] == "UDHAAR"
