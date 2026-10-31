"""Supplier bill -> goods receipt. Bill text (from a photo via Sarvam Document AI, or typed) is untrusted:
we only pull out item matches and numbers, the merchant reviews every line, and stock changes only when the
merchant confirms the receipt."""

import re
import uuid
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError, parse_money
from app.models import GoodsReceipt, Inventory, Product, utcnow
from app.services import audit
from app.services.restock import money

# Common shop words for each item (Hinglish / Hindi / trade names). Matching is case-insensitive.
ALIASES = {
    "ATTA10": ("atta", "aata", "wheat flour", "chakki", "आटा"),
    "RICE5": ("rice", "chawal", "basmati", "चावल"),
    "SUGAR1": ("sugar", "cheeni", "chini", "shakkar", "चीनी"),
    "TOOR1": ("toor", "tur", "arhar", "dal", "daal", "तूर", "दाल"),
    "OIL1": ("sunflower", "refined", "cooking oil", "tel", "सूरजमुखी"),
    "TEA250": ("tea", "chai patti", "chai", "चाय"),
    "NOODLE12": ("noodle", "noodles", "maggi", "नूडल्स"),
    "HAIROIL": ("hair oil", "coconut oil", "बालों"),
}
UNIT = re.compile(r"\d+(?:\.\d+)?\s*(?:kg|kgs|g|gm|gms|grams?|l|ltr|litre|liter|ml)\b", re.I)
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")
SUPPLIER_HINT = re.compile(r"\b(distributors?|distribution|wholesale|wholesalers|traders|suppliers?|agency|agencies|enterprises|mart)\b", re.I)
MAX_LINES = 60


def _num(s: str) -> Decimal | None:
    try:
        value = Decimal(s.replace(",", ""))
    except InvalidOperation:
        return None
    return value if value.is_finite() else None


def _match(line: str, products: list[Product]) -> Product | None:
    lowered = line.lower()
    best, best_len = None, 0
    for p in products:
        for alias in ALIASES.get(p.sku, ()) + (p.name.lower(), p.name_hi):
            if alias and alias.lower() in lowered and len(alias) > best_len:
                best, best_len = p, len(alias)
    return best


MONEY_RE = r"(?:rs\.?|inr|₹)?\s*(\d[\d,]*(?:\.\d+)?)"
SERIAL = re.compile(r"^\s*(?:(?:s\.?\s*no|sr\.?\s*no|sl\.?\s*no)\.?\s*:?\s*\d{1,3}\b|#?\d{1,3}\s*[.)\]:-]\s)", re.I)
HSN = re.compile(r"\b(?:hsn|sac)\s*(?:code)?\s*[:#.]?\s*\d{4,8}\b", re.I)
PERCENT = re.compile(r"\d+(?:\.\d+)?\s*%")
MRP = re.compile(r"\bmrp\s*[:=.]?\s*" + MONEY_RE, re.I)
QTY_LABEL = re.compile(r"\b(?:qty|quantity)\s*[:=.]?\s*(\d+)\b|\b(\d+)\s*(?:bags?|pcs|pc|pkts?|packs?|packets?|nos|pieces|boxes|units|bottles|tins|cartons?)\b", re.I)
RATE_LABEL = re.compile(r"(?:\brate\b|\bprice\b|@)\s*[:=.]?\s*" + MONEY_RE, re.I)
AMOUNT_LABEL = re.compile(r"(?:\bamt\b|\bamount\b|\bvalue\b|=)\s*[:=.]?\s*" + MONEY_RE, re.I)


def _closeness(price: Decimal, ref: Decimal) -> Decimal:
    """How far a candidate unit price is from the item's known price, as a ratio (1 = identical)."""
    if price <= 0 or ref <= 0:
        return Decimal("1e9")
    return max(price / ref, ref / price)


def read_quantities(line: str, ref_price: Decimal) -> tuple[Decimal | None, Decimal | None]:
    """(packs, unit price) from one bill line. Serial numbers, HSN codes, tax percentages, MRP and pack sizes are
    removed first; labelled fields (qty/bags, rate/@, amt/=) win; otherwise qty x rate = amount decides, and when
    only one price is printed the item's known price tells a unit rate from a line total."""
    s = SERIAL.sub(" ", line, count=1)
    s = HSN.sub(" ", s)
    s = MRP.sub(" ", s)
    s = PERCENT.sub(" ", s)
    s = UNIT.sub(" ", s)
    qty = rate = amount = None
    if m := QTY_LABEL.search(s):
        qty = _num(m.group(1) or m.group(2))
        s = s[:m.start()] + " " + s[m.end():]
    if m := RATE_LABEL.search(s):
        rate = _num(m.group(1))
        s = s[:m.start()] + " " + s[m.end():]
    if m := AMOUNT_LABEL.search(s):
        amount = _num(m.group(1))
        s = s[:m.start()] + " " + s[m.end():]
    rest = [n for n in (_num(x) for x in NUMBER.findall(s)) if n is not None and n > 0][:4]
    is_qty = lambda n: n == n.to_integral_value() and 0 < n <= 1000  # noqa: E731

    if qty is not None and rate is not None:
        return qty, rate
    if qty is not None and amount is not None:
        return qty, amount / qty
    if rate is not None and amount is not None and qty is None:
        q = (amount / rate).quantize(Decimal("0.01"))
        return (q, rate) if is_qty(q) else (None, None)
    if qty is not None:
        if rate is None and amount is None and rest:
            # one printed price: unit rate or line total, whichever is closer to the item's known price
            x = rest[0] if len(rest) == 1 else None
            if len(rest) >= 2:
                for r, a in ((rest[0], rest[1]), (rest[1], rest[0])):
                    if abs(qty * r - a) <= max(Decimal("1"), a / 100):
                        return qty, r
                x = rest[0]
            return qty, min((x, x / qty), key=lambda p: _closeness(p, ref_price))
        return qty, rate if rate is not None else (amount / qty if amount is not None else None)
    if rate is not None:
        q = next((n for n in rest if is_qty(n)), None)
        return q, rate
    if amount is not None:
        q = next((n for n in rest if is_qty(n)), None)
        return q, (amount / q if q else None)
    # Unlabelled: look for qty x rate = amount among the numbers, in any order.
    for i, q in enumerate(rest):
        if not is_qty(q):
            continue
        for j, r in enumerate(rest):
            for k, a in enumerate(rest):
                if len({i, j, k}) == 3 and abs(q * r - a) <= max(Decimal("1"), a / 100):
                    return q, r
    if len(rest) >= 2:
        options = [(q, p) for q, x in ((rest[0], rest[1]), (rest[1], rest[0])) if is_qty(q) for p in (x, x / q)]
        if options:
            return min(options, key=lambda o: _closeness(o[1], ref_price))
    if rest and is_qty(rest[0]):
        return rest[0], None
    return None, None


def parse_bill_text(text: str, products: list[Product]) -> dict:
    lines_out, unmatched = [], []
    supplier, bill_total = "", None
    for raw in text.splitlines()[:200]:
        line = raw.strip()
        if not line:
            continue
        if not supplier and SUPPLIER_HINT.search(line) and _match(line, products) is None:
            # Header like "METRO WHOLESALE TRADERS  Bill No 7781": keep the name before bill details.
            name = re.split(r"(?i)\b(?:bill|invoice|inv|gstin|gst|date|ph|phone|mob)\b|\d", line)[0].strip(" -:|,")
            if SUPPLIER_HINT.search(name):
                supplier = name[:120]
                continue
        if re.search(r"\b(grand\s*)?total\b", line, re.I):
            nums = [n for n in (_num(x) for x in NUMBER.findall(line)) if n is not None]
            bill_total = nums[-1] if nums else bill_total
            continue
        product = _match(line, products)
        if product is None:
            if NUMBER.search(UNIT.sub(" ", line)):
                unmatched.append(line[:120])
            continue
        qty, price = read_quantities(line, product.sell_price)
        if qty is None or qty <= 0 or qty != qty.to_integral_value() or qty > 1000:
            unmatched.append(line[:120])
            continue
        packs = int(qty)
        unit_price = money(price) if price is not None and 0 < price <= 100000 else None
        lines_out.append({
            "product_id": str(product.id), "name": product.name, "pack_label": product.pack_label, "packs": packs,
            "unit_price": f"{unit_price:.2f}" if unit_price is not None else None,
            "line_total": f"{money(unit_price * packs):.2f}" if unit_price is not None else None,
            "source_text": line[:120],
        })
        if len(lines_out) >= MAX_LINES:
            break
    total = sum((Decimal(line["line_total"]) for line in lines_out if line["line_total"]), Decimal("0"))
    return {"supplier_name": supplier, "lines": lines_out, "unmatched": unmatched[:20],
            "total": money(total), "bill_total": f"{money(bill_total):.2f}" if bill_total is not None else None}


def create_receipt(db: Session, merchant_id: uuid.UUID, user_id: uuid.UUID, actor: str, text: str, source: str,
                   supplier_name: str | None = None) -> tuple[GoodsReceipt, dict]:
    """Returns the draft receipt plus parse extras (unmatched lines, printed bill total) for review."""
    products = db.scalars(select(Product).where(Product.merchant_id == merchant_id, Product.active.is_(True))).all()
    parsed = parse_bill_text(text, products)
    receipt = GoodsReceipt(merchant_id=merchant_id, source=source, supplier_name=(supplier_name or parsed["supplier_name"])[:120],
                           raw_text=text[:5000], lines=parsed["lines"], total=parsed["total"], created_by=user_id,
                           status="DRAFT")
    db.add(receipt)
    db.flush()
    audit.record(db, merchant_id, actor, "BILL_READ", "goods_receipt", receipt.id,
                 f"Bill read ({source.lower()}): {len(parsed['lines'])} item lines found; waiting for merchant review",
                 details={"lines": len(parsed["lines"]), "unmatched": len(parsed["unmatched"])})
    return receipt, {"unmatched": parsed["unmatched"], "bill_total": parsed["bill_total"]}


def confirm_receipt(db: Session, merchant_id: uuid.UUID, user_id: uuid.UUID, actor: str, receipt_id: uuid.UUID,
                    lines: list[dict], supplier_name: str | None) -> GoodsReceipt:
    receipt = db.scalars(select(GoodsReceipt).where(GoodsReceipt.id == receipt_id, GoodsReceipt.merchant_id == merchant_id)
                         .with_for_update()).first()
    if receipt is None:
        raise ApiError(404, "NOT_FOUND", "Bill not found")
    if receipt.status != "DRAFT":
        raise ApiError(409, "INVALID_TRANSITION", f"This bill is already {receipt.status.lower()}")
    if not lines:
        raise ApiError(422, "NO_LINES", "Add at least one item line")
    products = {str(p.id): p for p in db.scalars(select(Product).where(Product.merchant_id == merchant_id))}
    final = []
    for line in lines:
        product = products.get(str(line.get("product_id")))
        if product is None:
            raise ApiError(422, "BAD_LINE", "Unknown item on the bill")
        packs = int(line.get("packs") or 0)
        if not 1 <= packs <= 1000:
            raise ApiError(422, "BAD_LINE", f"{product.name}: packs must be 1-1000")
        price = line.get("unit_price")
        unit_price = parse_money(price, f"{product.name} price", "0", "100000") if price not in (None, "") else None
        final.append({"product_id": str(product.id), "name": product.name, "pack_label": product.pack_label,
                      "packs": packs, "unit_price": f"{unit_price:.2f}" if unit_price is not None else None,
                      "line_total": f"{money(unit_price * packs):.2f}" if unit_price is not None else None})
    for line in final:
        inv = db.scalars(select(Inventory).where(Inventory.merchant_id == merchant_id,
                                                 Inventory.product_id == uuid.UUID(line["product_id"])).with_for_update()).first()
        if inv is None:
            inv = Inventory(merchant_id=merchant_id, product_id=uuid.UUID(line["product_id"]), on_hand_packs=0, source="MANUAL")
            db.add(inv)
        inv.on_hand_packs += line["packs"]
        inv.source, inv.source_updated_at, inv.updated_at = "MANUAL", utcnow(), utcnow()
    receipt.lines = final
    receipt.total = money(sum((Decimal(line["line_total"]) for line in final if line["line_total"]), Decimal("0")))
    if supplier_name is not None:
        receipt.supplier_name = supplier_name.strip()[:120]
    receipt.status, receipt.confirmed_by, receipt.confirmed_at = "CONFIRMED", user_id, utcnow()
    audit.record(db, merchant_id, actor, "GOODS_RECEIVED", "goods_receipt", receipt.id,
                 f"Bill confirmed: +{sum(line['packs'] for line in final)} packs added to stock"
                 + (f" from {receipt.supplier_name}" if receipt.supplier_name else ""),
                 details={"lines": [{"name": line["name"], "packs": line["packs"]} for line in final]})
    db.commit()
    return receipt
