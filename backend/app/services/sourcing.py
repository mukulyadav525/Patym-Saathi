"""Compare vendors for an item: every brand and quality the suppliers offer, what it costs, what it can sell for,
and which earns the most at the shop's usual sales. Buying one goes through the same approval as a restock plan:
nothing is ordered until the merchant approves with their PIN, and stock and cost price change when the goods
arrive.

Selling price for an offer: the shop's own price for the brand it stocks now; otherwise what nearby shops charge
for that brand (SAMPLE). Never above MRP. Profit per month assumes the shop keeps selling its usual packs a week.
"""

import math
import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import ApiError, parse_money
from app.models import Inventory, Product, Supplier, SupplierQuote, Task, utcnow
from app.security import Ctx
from app.services import profit, restock_flow
from app.services.assistant import new_task
from app.services.common import move_task
from app.services.restock import money

QUALITY_ORDER = {"PREMIUM": 0, "STANDARD": 1, "ECONOMY": 2}
QUALITY_LABEL = {"PREMIUM": "premium", "STANDARD": "standard", "ECONOMY": "economy"}
WEEKS_PER_MONTH = 4
COVER_WEEKS = 2  # a purchase suggests two weeks of sales, less what is in stock
MAX_PACKS = 500


def _product(db: Session, merchant_id: uuid.UUID, product_id: uuid.UUID) -> tuple[Product, Inventory]:
    row = db.execute(select(Product, Inventory).join(Inventory, Inventory.product_id == Product.id)
                     .where(Product.id == product_id, Product.merchant_id == merchant_id)).first()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Item not found")
    return row[0], row[1]


def planned_price(product: Product, quote: SupplierQuote) -> Decimal:
    current = not product.brand or quote.brand == product.brand
    price = product.sell_price if current else (quote.typical_sell_price or product.sell_price)
    return min(price, quote.mrp) if quote.mrp else price


def compare(db: Session, merchant_id: uuid.UUID, product_id: uuid.UUID) -> dict:
    product, inv = _product(db, merchant_id, product_id)
    weeks = restock_flow.sales_summary(db, merchant_id).get(str(product.id), {}).get("weeks", [])
    avg = Decimal(sum(weeks)) / len(weeks) if weeks else Decimal("0")
    cost = profit.unit_costs(db, merchant_id).get(str(product.id))
    now = utcnow()
    rows = [(q, sup) for q, sup in restock_flow.supplier_quotes(db, merchant_id) if q.product_id == product.id]
    offers = []
    for quote, supplier in rows:
        sell = planned_price(product, quote)
        per_pack = money(sell - quote.unit_price)
        offers.append({
            "quote_id": str(quote.id), "supplier_name": supplier.name, "connector_mode": supplier.connector_mode,
            "brand": quote.brand or product.name, "quality": quote.quality, "quality_note": quote.quality_note,
            "cost_price": f"{quote.unit_price:.2f}", "mrp": f"{quote.mrp:.2f}" if quote.mrp else None,
            "sell_price": f"{sell:.2f}", "profit_per_pack": f"{per_pack:.2f}",
            "margin_pct": f"{per_pack / sell * 100:.1f}" if sell > 0 else "0.0",
            "monthly_profit": f"{money(per_pack * avg * WEEKS_PER_MONTH):.2f}",
            "available_packs": quote.available_packs if quote.valid_until > now else 0,
            "min_order_packs": quote.min_order_packs, "eta": quote.eta,
            "current_brand": not product.brand or quote.brand == product.brand, "best": False, "cheapest_for_current": False,
        })
    offers.sort(key=lambda o: (-Decimal(o["profit_per_pack"]), QUALITY_ORDER.get(o["quality"], 1), Decimal(o["cost_price"])))
    buyable = [o for o in offers if o["available_packs"] > 0]
    if buyable:
        buyable[0]["best"] = True
    current = [o for o in buyable if o["current_brand"]]
    if current:
        min(current, key=lambda o: Decimal(o["cost_price"]))["cheapest_for_current"] = True
    suggested = max(1, math.ceil(avg * COVER_WEEKS) - inv.usable_packs)
    return {
        "product_id": str(product.id), "name": product.name, "name_hi": product.name_hi, "pack_label": product.pack_label,
        "brand": product.brand, "sell_price": f"{product.sell_price:.2f}",
        "cost_price": f"{cost[0]:.2f}" if cost else None, "cost_estimated": cost[1] if cost else True,
        "profit_per_pack": f"{product.sell_price - cost[0]:.2f}" if cost else None,
        "stock": inv.usable_packs, "avg_weekly": f"{avg:.1f}", "suggested_packs": suggested,
        "offers": offers, "recommendation": _recommend(product, offers, avg), "notes": _notes(offers, avg),
        "sources": ["Supplier price lists (SIMULATED)", "Nearby shop prices for other brands (SAMPLE)",
                    "Your sales: last 4 weeks (SAMPLE)", "Your cost price: what you paid for the stock you hold"],
    }


def _recommend(product: Product, offers: list[dict], avg: Decimal) -> str:
    best = next((o for o in offers if o["best"]), None)
    if best is None:
        return f"No supplier has {product.name} available right now."
    now = next((o for o in offers if o["cheapest_for_current"]), None)
    unit = product.pack_label
    if now is None or best["quote_id"] == now["quote_id"]:
        return (f"Keep {best['brand']} from {best['supplier_name']}: ₹{Decimal(best['profit_per_pack']):,.0f} profit per "
                f"{unit} at ₹{Decimal(best['sell_price']):,.0f}, the best of {len(offers)} offers.")
    gain = Decimal(best["profit_per_pack"]) - Decimal(now["profit_per_pack"])
    text = (f"{best['brand']} ({QUALITY_LABEL.get(best['quality'], '')}) from {best['supplier_name']} earns "
            f"₹{Decimal(best['profit_per_pack']):,.0f} per {unit} selling at ₹{Decimal(best['sell_price']):,.0f}, "
            f"₹{gain:,.0f} more than {now['brand']} from {now['supplier_name']}")
    if avg > 0:
        text += f": about ₹{gain * avg * WEEKS_PER_MONTH:,.0f} more a month at your {avg:.0f} a week"
    return text + "."


def _notes(offers: list[dict], avg: Decimal) -> list[str]:
    notes = []
    best = next((o for o in offers if o["best"]), None)
    if best and not best["current_brand"]:
        if best["quality"] == "PREMIUM":
            notes.append("A premium brand costs more and may sell slower at a higher price; try a small first order.")
        elif best["quality"] == "ECONOMY":
            notes.append("Economy quality: regular customers may notice the change.")
    if avg == 0:
        notes.append("No recent sales of this item, so monthly profit is 0.")
    return notes


def start_purchase(db: Session, ctx: Ctx, quote_id: uuid.UUID, packs: int, sell_price: str | None) -> Task:
    """Buy one supplier offer: a purchase plan that waits for the merchant's approval (nothing is ordered here)."""
    row = db.execute(select(SupplierQuote, Supplier, Product).join(Supplier, Supplier.id == SupplierQuote.supplier_id)
                     .join(Product, Product.id == SupplierQuote.product_id)
                     .where(SupplierQuote.id == quote_id, Product.merchant_id == ctx.merchant_id)).first()
    if row is None:
        raise ApiError(404, "NOT_FOUND", "Supplier offer not found")
    quote, supplier, product = row
    if supplier.status != "ACTIVE":
        raise ApiError(409, "SUPPLIER_INACTIVE", f"{supplier.name} is not taking orders")
    if not quote.min_order_packs <= packs <= MAX_PACKS:
        raise ApiError(422, "BAD_PACKS", f"Order between {quote.min_order_packs} and {MAX_PACKS} packs")
    sell = (parse_money(sell_price, "Selling price", "1", "100000") if sell_price not in (None, "")
            else planned_price(product, quote))
    if quote.mrp and sell > quote.mrp:
        raise ApiError(422, "ABOVE_MRP", f"Selling price can't be above the MRP of ₹{quote.mrp:,.0f}")
    brand = quote.brand or product.name
    task = new_task(db, ctx, "RESTOCK", f"Buy {packs} × {brand} from {supplier.name}",
                    f"Compare vendors: {packs} × {brand} ({product.pack_label}) from {supplier.name}", "TEXT",
                    {"intent": "RESTOCK", "budget": f"{money(quote.unit_price * packs):.2f}", "horizon_days": 7,
                     "purchase": {"quote_id": str(quote.id), "packs": packs, "sell_price": f"{sell:.2f}"}})
    move_task(db, task, "UNDERSTANDING", "saathi", f"Understood: buy {packs} × {brand} from {supplier.name}")
    move_task(db, task, "EVIDENCE_READY", "saathi", "Loaded the supplier's price and your stock")
    plan = restock_flow.draft_plan(db, task, ctx.actor, money(quote.unit_price * packs), "Purchase from Compare vendors")
    move_task(db, task, "PLAN_DRAFTED", "saathi", f"Drafted purchase ₹{plan.total:,.2f}")
    restock_flow.request_approval(db, task, plan)
    move_task(db, task, "AWAITING_APPROVAL", "saathi", "Waiting for merchant approval")
    db.commit()
    return task


def spoken_comparison(db: Session, merchant_id: uuid.UUID, product: Product) -> str:
    """Saathi's answer to 'atta kahan se lun?': the best offer and what it earns, in Hinglish."""
    data = compare(db, merchant_id, product.id)
    best = next((o for o in data["offers"] if o["best"]), None)
    if best is None:
        return f"{product.name} abhi kisi supplier ke paas available nahi hai."
    now = next((o for o in data["offers"] if o["cheapest_for_current"]), None)
    msg = (f"{product.name} mein sabse zyada munafa: {best['brand']} {best['supplier_name']} se, ₹{Decimal(best['cost_price']):,.0f} "
           f"mein, ₹{Decimal(best['sell_price']):,.0f} par bechne se ₹{Decimal(best['profit_per_pack']):,.0f} har pack.")
    if now and now["quote_id"] != best["quote_id"]:
        msg += (f" Abhi wala {now['brand']} {now['supplier_name']} se ₹{Decimal(now['cost_price']):,.0f} mein, "
                f"₹{Decimal(now['profit_per_pack']):,.0f} har pack.")
    return msg + " Kharidne ke liye app mein Compare vendors kholiye."
