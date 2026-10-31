"""Adding an item to the shop's list: by hand from Inventory, or from a supplier bill line Saathi didn't recognise.

A new item gets its own stock row (0 unless the merchant counts some in) and, when a cost price is known, a stock
lot so profit is right from the first sale. Saathi's voice and bill matching find it by its name straight away.
"""

import re
import secrets
import uuid
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.errors import ApiError, parse_money
from app.models import Inventory, Product
from app.security import Ctx
from app.services import audit, live, profit
from app.services.restock import money

MAX_ITEMS = 300
PACK = re.compile(r"(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|grams?|l|ltr|litres?|liters?|ml|pcs|pieces?|pack)\b", re.I)
UNIT_NAME = {"kg": "kg", "kgs": "kg", "g": "g", "gm": "g", "gms": "g", "gram": "g", "grams": "g", "l": "L", "ltr": "L",
             "litre": "L", "litres": "L", "liter": "L", "liters": "L", "ml": "ml", "pcs": "pcs", "piece": "pcs",
             "pieces": "pcs", "pack": "pack"}


def create_product(db: Session, ctx: Ctx, *, name: str, name_hi: str | None, pack_label: str, sell_price: str,
                   opening_stock: int = 0, cost_price: str | None = None, source: str = "MANUAL") -> Product:
    name = " ".join(name.split())[:60]
    if len(name) < 2:
        raise ApiError(422, "BAD_NAME", "Give the item a name")
    pack_label = " ".join((pack_label or "1 pack").split())[:40]
    sell = parse_money(sell_price, "Selling price", "1", "100000")
    cost = parse_money(cost_price, "Cost price", "0", "100000") if cost_price not in (None, "") else None
    if cost is not None and cost > sell:
        raise ApiError(422, "COST_ABOVE_PRICE", "Cost price is above the selling price")
    if not 0 <= opening_stock <= 10000:
        raise ApiError(422, "BAD_STOCK", "Opening stock must be 0-10,000 packs")
    mid = ctx.merchant_id
    taken = db.scalar(select(Product.id).where(Product.merchant_id == mid, Product.active.is_(True),
                                               func.lower(Product.name) == name.lower(),
                                               func.lower(Product.pack_label) == pack_label.lower()))
    if taken is not None:
        raise ApiError(409, "ALREADY_LISTED", f"{name} ({pack_label}) is already in your inventory")
    count = db.scalar(select(func.count()).select_from(Product).where(Product.merchant_id == mid)) or 0
    if count >= MAX_ITEMS:
        raise ApiError(422, "TOO_MANY_ITEMS", f"Up to {MAX_ITEMS} items")
    order = (db.scalar(select(func.max(Product.sort_order)).where(Product.merchant_id == mid)) or 0) + 1
    product = Product(merchant_id=mid, sku=f"N{secrets.token_hex(4).upper()}", name=name, name_hi=(name_hi or name)[:120],
                      pack_label=pack_label, pack_size=1, sell_price=money(sell), sort_order=order, brand="")
    db.add(product)
    db.flush()
    db.add(Inventory(merchant_id=mid, product_id=product.id, on_hand_packs=opening_stock, source="MANUAL"))
    if opening_stock and cost is not None:
        profit.add_lot(db, mid, product.id, opening_stock, money(cost), "MANUAL")
    audit.record(db, mid, ctx.actor, "PRODUCT_ADDED", "product", product.id,
                 f"Added {name} ({pack_label}) at ₹{sell:,.0f}" + (f", {opening_stock} in stock" if opening_stock else ""),
                 details={"source": source})
    live.publish(db, mid, "PRODUCT_ADDED", f"New item · {name} ({pack_label})", f"₹{sell:,.0f} · {opening_stock} in stock",
                 data={"product_id": str(product.id)})
    return product


def guess_new_item(line: str, packs: Decimal | None, unit_price: Decimal | None) -> dict:
    """A bill line Saathi didn't recognise, read as a new item the merchant can add: its name, pack size,
    how many came and at what cost. Only a suggestion: the merchant checks it and sets the selling price."""
    text = re.sub(r"^\s*(?:s\.?\s*no\.?\s*)?\d{1,3}\s*[.)\]:-]\s*", "", line)
    pack = PACK.search(text)
    first_number = re.search(r"\d", text)
    cut = min(i for i in (pack.start() if pack else len(text), first_number.start() if first_number else len(text)))
    name = re.sub(r"[^\w\s&'-]", " ", text[:cut])
    name = " ".join(w for w in name.split() if w.lower() not in {"x", "qty", "rate", "rs", "inr", "mrp", "@"}).strip()
    pack_label = f"{pack.group(1)} {UNIT_NAME[pack.group(2).lower()]}" if pack else "1 pack"
    cost = money(unit_price) if unit_price is not None and 0 < unit_price <= 100000 else None
    return {
        "source_text": line[:120], "name": name.title()[:60], "pack_label": pack_label,
        "packs": int(packs) if packs is not None and packs == packs.to_integral_value() and 0 < packs <= 1000 else 1,
        "unit_price": f"{cost:.2f}" if cost is not None else None,
        # A starting point only: the merchant sets their own selling price.
        "suggested_sell_price": f"{money(cost * Decimal('1.15')).to_integral_value():.2f}" if cost is not None else None,
    }


def product_for(db: Session, merchant_id: uuid.UUID, product_id: uuid.UUID) -> Product:
    product = db.scalars(select(Product).where(Product.id == product_id, Product.merchant_id == merchant_id)).first()
    if product is None:
        raise ApiError(404, "NOT_FOUND", "Item not found")
    return product
