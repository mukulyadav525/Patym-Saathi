"""Real-world supplier bill lines (serials, HSN codes, GST %, MRP, labels, units) -> packs and unit price."""

from decimal import Decimal

import pytest

from app.services.bills import read_quantities

CASES = [
    ("1. Aashirvaad Atta 10kg - 5 bags - Rs 1900", "420", 5, "380"),
    ("Sugar 5 kg qty 2 rate 210 amt 420", "48", 2, "210"),
    ("Fortune Sunflower Oil 1L 12 x 136.00 1,632.00", "185", 12, "136"),
    ("Tata Tea Premium 250g 6 133 798", "150", 6, "133"),
    ("Atta 10kg HSN 1101 5 380 1900", "420", 5, "380"),
    ("Toor Dal 1kg 5% GST 8 150.00 1200.00", "170", 8, "150"),
    ("S.No 2 Chawal 5kg 4 x 310", "345", 4, "310"),
    ("Atta 10kg x 4 @ 380 = 1520", "420", 4, "380"),
    ("Cheeni 1kg 10 42 420", "48", 10, "42"),
    ("Sugar 42 x 30", "48", 30, "42"),
    ("Rice 5kg MRP 400 3 310 930", "345", 3, "310"),
    ("Tea 250g Qty: 6 Amount: ₹798", "150", 6, "133"),
]


@pytest.mark.parametrize("line,ref,packs,price", CASES)
def test_bill_lines(line, ref, packs, price):
    q, p = read_quantities(line, Decimal(ref))
    assert q == packs and p is not None and p.quantize(Decimal("1")) == Decimal(price), (line, q, p)


def test_no_numbers_or_only_codes_is_not_a_line():
    assert read_quantities("Atta HSN 1101", Decimal("420")) == (None, None)
