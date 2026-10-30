"""Demo fixture — single source of truth for the numbers (trd.txt §4)."""

from decimal import Decimal

MERCHANT = {
    "display_name": "Sharma Kirana Store",
    "owner_name": "Rajesh Sharma",
    "locality": "Lajpat Nagar, New Delhi",
    "email": "mukul24360@iiitd.ac.in",
}
OTHER_MERCHANT = {
    "display_name": "Test Store B",
    "owner_name": "Test Owner",
    "locality": "Test City",
    "email": "owner@storeb.demo",
}

SUPPLIERS = [
    {"code": "A", "name": "Gupta Distributors"},
    {"code": "B", "name": "Metro Wholesale"},
]

# sku, name, name_hi, pack_label, stock, sales w1..w4, price A, price B, sell price
PRODUCTS = [
    ("ATTA10", "Atta", "आटा", "10 kg bag", 2, [6, 5, 7, 6], "380", "395", "420"),
    ("RICE5", "Rice", "चावल", "5 kg bag", 2, [5, 4, 6, 5], "310", "325", "345"),
    ("SUGAR1", "Sugar", "चीनी", "1 kg", 8, [20, 19, 21, 20], "42", "44", "48"),
    ("TOOR1", "Toor dal", "तूर दाल", "1 kg", 3, [8, 7, 9, 8], "150", "158", "170"),
    ("OIL1", "Sunflower oil", "सूरजमुखी तेल", "1 L", 4, [9, 8, 10, 9], "136", "176", "185"),
    ("TEA250", "Tea", "चाय", "250 g", 4, [6, 5, 7, 6], "133", "140", "150"),
    # Slow movers: plenty of stock, sales falling to zero last week (so last week's ₹9,130 is unchanged).
    ("NOODLE12", "Instant noodles", "इंस्टेंट नूडल्स", "12-pack", 14, [6, 4, 2, 0], "110", "116", "132"),
    ("HAIROIL", "Hair oil", "बालों का तेल", "200 ml", 18, [3, 2, 1, 0], "78", "82", "95"),
]

# Festival demand evidence: last Diwali week vs the 4 normal weeks before it (sample POS history).
FESTIVAL = {"code": "DIWALI", "name": "Diwali", "name_hi": "दिवाली", "date": "2026-11-08", "last_date": "2025-10-20"}
# sku: (packs sold in last year's Diwali week, normal weekly average before it)
FESTIVAL_SALES = {
    "ATTA10": (9, "6"), "RICE5": (7, "5"), "SUGAR1": (50, "20"), "TOOR1": (10, "8"),
    "OIL1": (20, "9"), "TEA250": (9, "6"), "NOODLE12": (7, "6"), "HAIROIL": (4, "3"),
}
EXPECTED_DIWALI_PLAN = Decimal("9889.00")  # 7-day horizon x last-Diwali uplift; sugar splits A 30 + B 12; budget ₹10,000

# Customer khata (udhaar) history: customer, masked phone, [(day offset, CREDIT|PAYMENT, amount, note)]
KHATA = [
    ("Aman Stores", "+91 90000 0X042", [(-85, "CREDIT", "800", "Monthly supplies"), (-62, "PAYMENT", "800", "Cash"),
                                        (-55, "CREDIT", "1500", "Bulk order"), (-30, "PAYMENT", "1500", "UPI"),
                                        (-20, "CREDIT", "1200", "INV-1042")]),
    ("Verma Tea Stall", "+91 90000 0X038", [(-70, "CREDIT", "400", "Tea, sugar"), (-64, "PAYMENT", "400", "UPI"),
                                            (-40, "CREDIT", "500", "Tea, milk powder"), (-33, "PAYMENT", "500", "UPI"),
                                            (-12, "CREDIT", "650", "INV-1038")]),
    ("Rao General", "+91 90000 0X035", [(-60, "CREDIT", "700", "Rice, dal"), (-52, "PAYMENT", "700", "Cash"),
                                        (-28, "CREDIT", "900", "INV-1035"), (-12, "PAYMENT", "900", "Paytm link")]),
    ("Gupta Sweets", "+91 90000 0X051", [(-15, "CREDIT", "2000", "Sugar, oil for festival"), (-5, "PAYMENT", "1000", "Part payment")]),
]

# Nearby-store benchmark (aggregated, anonymised). sku: peer median packs/week.
PEER_LOCALITY = "Lajpat Nagar, New Delhi"
PEER_COUNT = 18
PEER_MEDIANS = {"ATTA10": "7", "RICE5": "5", "SUGAR1": "18", "TOOR1": "8", "OIL1": "10", "TEA250": "9",
                "NOODLE12": "8", "HAIROIL": "2"}

# Merchant-entered figures (editable in the app).
CASH_ON_HAND = Decimal("6000")
WEEKLY_EXPENSES = Decimal("3500")
DEFAULT_RESTOCK_BUDGET = Decimal("5000")

AVAILABLE_A = 30
AVAILABLE_B = {"OIL1": 10}  # others default
AVAILABLE_B_DEFAULT = 30
SHORTAGE_SKU = "OIL1"  # Supplier A cannot fulfil this on submission (DEMO_SHORTAGE)

# invoice_number, customer, masked phone, amount, due offset days, status
INVOICES = [
    ("INV-1042", "Aman Stores", "+91 90000 0X042", "1200", -5, "PENDING"),
    ("INV-1038", "Verma Tea Stall", "+91 90000 0X038", "650", 2, "PENDING"),
    ("INV-1035", "Rao General", "+91 90000 0X035", "900", -12, "PAID"),
]

EXPECTED_PLAN_V1 = Decimal("4650.00")
EXPECTED_ACCEPTED_A = Decimal("3970.00")
EXPECTED_PLAN_V2 = Decimal("4850.00")
DEMO_BUDGET = Decimal("5000.00")
