"""SIMULATED supplier adapter. Deterministic quotes and a deterministic sunflower-oil shortage at
Supplier A (DEMO_SHORTAGE). Placing an order here never implies payment or delivery."""

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import seed_data as fx
from app.config import get_settings
from app.models import OrderLine, Product, Supplier, SupplierQuote, utcnow

MODE = "SIMULATED"
QUOTE_TTL = timedelta(hours=12)


@dataclass
class LineResult:
    line_id: str
    status: str  # ACCEPTED | UNAVAILABLE
    reason: str = ""


def refresh_quotes(db: Session, quotes: list[SupplierQuote]) -> None:
    """Simulates re-fetching price lists: an expired simulated quote is re-issued at the same price."""
    now = utcnow()
    for quote in quotes:
        if quote.valid_until <= now:
            quote.valid_until = now + QUOTE_TTL
            quote.fetched_at = now


def submit(db: Session, supplier: Supplier, lines: list[OrderLine]) -> list[LineResult]:
    settings = get_settings()
    results: list[LineResult] = []
    for line in lines:
        product = db.get(Product, line.product_id)
        quote = db.get(SupplierQuote, line.quote_id)
        # The demo shortage is the brand the shop stocks; Supplier A's other oils are in stock.
        short = (settings.demo_shortage and supplier.code == "A" and product.sku == fx.SHORTAGE_SKU
                 and quote.brand in ("", fx.CURRENT_BRANDS[fx.SHORTAGE_SKU][0]))
        if short or quote.available_packs < line.packs:
            # Supplier reports the item out of stock; its quote now shows zero availability.
            quote.available_packs = 0
            quote.fetched_at = utcnow()
            results.append(LineResult(str(line.id), "UNAVAILABLE", f"{product.name} out of stock at {supplier.name}"))
        else:
            quote.available_packs -= line.packs
            results.append(LineResult(str(line.id), "ACCEPTED"))
    return results


def supplier_by_code(db: Session, code: str) -> Supplier:
    return db.scalars(select(Supplier).where(Supplier.code == code)).one()
