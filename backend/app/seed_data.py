"""Demo fixture — single source of truth for the numbers (trd.txt §4)."""

from decimal import Decimal

MERCHANT = {
    "display_name": "Sharma Kirana Store",
    "owner_name": "Rajesh Sharma",
    "locality": "Lajpat Nagar, New Delhi",
    "email": "owner@sharma.demo",
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
]

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
