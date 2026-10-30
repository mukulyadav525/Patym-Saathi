"""Merchant-growth endpoints: festival, impact, offers, khata, cash flow, benchmarks, voice brief,
proactive scan, bills. Read endpoints compute from records; writes only draft or record merchant actions."""

import uuid
from decimal import Decimal

from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import schemas as s
from app.adapters import sarvam
from app.db import get_db
from app.errors import ApiError, parse_money
from app.models import GoodsReceipt, Invoice, Offer, Product, Task
from app.security import Ctx, current_ctx
from app.services import audit, bills, dues_flow, growth, ratelimit

growth_api = APIRouter(prefix="/api/v1")

ALLOWED_BILL_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"}


def _money(value: str | None, field: str) -> Decimal | None:
    return None if value in (None, "") else parse_money(value, field)


def _offer_out(offer: Offer, product: Product) -> s.OfferOut:
    return s.OfferOut(id=str(offer.id), product_id=str(product.id), product_name=product.name,
                      discount_pct=offer.discount_pct, offer_price=f"{offer.offer_price:.2f}",
                      sell_price=f"{product.sell_price:.2f}", message=offer.message, language=offer.language,
                      status=offer.status, created_at=offer.created_at)


def _receipt_out(r: GoodsReceipt, extras: dict | None = None) -> s.ReceiptOut:
    return s.ReceiptOut(id=str(r.id), status=r.status, source=r.source, supplier_name=r.supplier_name,
                        lines=[s.ReceiptLine(**line) for line in r.lines], total=f"{r.total:.2f}",
                        created_at=r.created_at, confirmed_at=r.confirmed_at,
                        unmatched=(extras or {}).get("unmatched", []), bill_total=(extras or {}).get("bill_total"))


# ---------- overview ----------

@growth_api.get("/growth/overview", response_model=s.GrowthOverview)
def overview(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.GrowthOverview:
    slow = growth.slow_movers(db, ctx.merchant_id)
    khata = growth.khata_insights(db, ctx.merchant_id)
    cash = growth.cashflow(db, ctx.merchant)
    bench = growth.benchmarks(db, ctx.merchant_id)
    proactive = db.scalar(select(func.count()).select_from(Task).where(
        Task.merchant_id == ctx.merchant_id, Task.input_channel == "PROACTIVE", Task.state == "AWAITING_APPROVAL")) or 0
    festival = growth.upcoming_festival(db, ctx.merchant_id)
    return s.GrowthOverview(
        festival=s.FestivalOut(**festival) if festival else None,
        impact=s.ImpactOut(**growth.impact(db, ctx.merchant_id)),
        slow_movers=len(slow),
        slow_cash_tied_up=f"{sum((Decimal(i['cash_tied_up']) for i in slow), Decimal('0')):.2f}",
        khata_outstanding=khata["total_outstanding"],
        khata_late_customers=sum(1 for c in khata["customers"] if c["label"] == "Pays late" and Decimal(c["outstanding"]) > 0),
        cash_shortfall=cash["shortfall"], cash_first_negative_on=cash["first_negative_on"],
        benchmark_insight=s.BenchmarkInsight(**bench["insights"][0]) if bench["insights"] else None,
        proactive_tasks=proactive,
    )


@growth_api.get("/growth/festival", response_model=s.FestivalOut | None)
def festival(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.FestivalOut | None:
    data = growth.upcoming_festival(db, ctx.merchant_id)
    return s.FestivalOut(**data) if data else None


@growth_api.get("/growth/impact", response_model=s.ImpactOut)
def impact(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.ImpactOut:
    return s.ImpactOut(**growth.impact(db, ctx.merchant_id))


# ---------- voice brief ----------

@growth_api.get("/brief/speech", response_model=s.SpeechOut)
def brief_speech(lang: str = Query("hi-IN", pattern=r"^[a-z]{2}-IN$"), audio: bool = False,
                 ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.SpeechOut:
    text = growth.brief_speech(db, ctx.merchant, "hi-IN" if lang == "hi-IN" else "en-IN")
    language = lang
    if lang not in ("hi-IN", "en-IN"):
        ratelimit.check(ctx.merchant_id, "translate")
        # Other languages: translate the English brief with Mayura, then speak it. If the translation
        # altered any number, fall back to the English brief rather than speak a wrong amount.
        try:
            text = sarvam.translate(text, lang, source="en-IN")
        except ApiError as exc:
            if exc.code != "TRANSLATION_UNSAFE":
                raise
            language = lang = "en-IN"
    if not audio or not sarvam.enabled():
        return s.SpeechOut(text=text, language=language, voice="LIVE" if sarvam.enabled() else "OFF")
    ratelimit.check(ctx.merchant_id, "speech")
    return s.SpeechOut(text=text, language=language, voice="LIVE", audio_base64=sarvam.speak(text, lang), mime="audio/wav")


@growth_api.get("/languages", response_model=list[s.LanguageOut])
def languages() -> list[s.LanguageOut]:
    return [s.LanguageOut(code=code, name=name) for code, name in sarvam.LANGUAGES.items()]


# ---------- slow movers + offers ----------

@growth_api.get("/growth/slow-movers", response_model=list[s.SlowMoverOut])
def slow_movers(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.SlowMoverOut]:
    return [s.SlowMoverOut(**item) for item in growth.slow_movers(db, ctx.merchant_id)]


@growth_api.get("/offers", response_model=list[s.OfferOut])
def list_offers(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.OfferOut]:
    rows = db.execute(select(Offer, Product).join(Product, Product.id == Offer.product_id)
                      .where(Offer.merchant_id == ctx.merchant_id).order_by(Offer.created_at.desc()).limit(50)).all()
    return [_offer_out(o, p) for o, p in rows]


@growth_api.post("/offers", response_model=s.OfferOut)
def create_offer(body: s.OfferRequest, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.OfferOut:
    try:
        product_id = uuid.UUID(body.product_id)
    except ValueError as exc:
        raise ApiError(404, "NOT_FOUND", "Item not found") from exc
    offer = growth.draft_offer(db, ctx.merchant, ctx.user.id, ctx.actor, product_id, body.discount_pct)
    db.commit()
    return _offer_out(offer, db.get(Product, offer.product_id))


@growth_api.post("/offers/{offer_id}/shared", response_model=s.OfferOut)
def offer_shared(offer_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.OfferOut:
    offer = db.scalars(select(Offer).where(Offer.id == offer_id, Offer.merchant_id == ctx.merchant_id)).first()
    if offer is None:
        raise ApiError(404, "NOT_FOUND", "Offer not found")
    offer.status = "SHARED"
    audit.record(db, ctx.merchant_id, ctx.actor, "OFFER_SHARED", "offer", offer.id,
                 "Merchant opened the share sheet for the offer (Saathi did not send it)")
    db.commit()
    return _offer_out(offer, db.get(Product, offer.product_id))


# ---------- translation of merchant-owned drafts ----------

@growth_api.post("/translate", response_model=s.TranslateOut)
def translate(body: s.TranslateRequest, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TranslateOut:
    """Only drafts Saathi wrote for this merchant can be translated (no open text proxy)."""
    # Hinglish original for hi-IN; every other language is translated from a clear English source.
    if body.kind == "OFFER":
        offer = db.scalars(select(Offer).where(Offer.merchant_id == ctx.merchant_id, Offer.id == _uuid(body.ref))).first()
        original = offer.message if offer else None
        english = (growth.offer_message(ctx.merchant, db.get(Product, offer.product_id), offer.offer_price,
                                        offer.discount_pct, "en-IN") if offer else None)
    elif body.kind == "INVOICE":
        inv = db.scalars(select(Invoice).where(Invoice.merchant_id == ctx.merchant_id, Invoice.id == _uuid(body.ref))).first()
        original = inv.draft_message if inv else None
        english = dues_flow.draft_message_en(inv, ctx.merchant) if inv else None
    else:
        match = next((c for c in growth.khata_insights(db, ctx.merchant_id)["customers"]
                      if c["customer_name"] == body.ref), None)
        original = match["reminder"] if match else None
        english = match["reminder_en"] if match else None
    if not original or not english:
        raise ApiError(404, "NOT_FOUND", "Nothing to translate")
    if body.target == "hi-IN":
        return s.TranslateOut(text=original, language="hi-IN", engine="ORIGINAL")
    if body.target == "en-IN":
        return s.TranslateOut(text=english, language="en-IN", engine="TEMPLATE")
    ratelimit.check(ctx.merchant_id, "translate")
    return s.TranslateOut(text=sarvam.translate(english, body.target), language=body.target, engine="SARVAM_MAYURA")


def _uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise ApiError(404, "NOT_FOUND", "Not found") from exc


# ---------- khata ----------

@growth_api.get("/khata", response_model=s.KhataOut)
def khata(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.KhataOut:
    return s.KhataOut(**growth.khata_insights(db, ctx.merchant_id))


# ---------- cash flow ----------

@growth_api.get("/cashflow", response_model=s.CashflowOut)
def cashflow(days: int = Query(14, ge=7, le=30), include_pending: bool = True, ctx: Ctx = Depends(current_ctx),
             db: Session = Depends(get_db)) -> s.CashflowOut:
    return s.CashflowOut(**growth.cashflow(db, ctx.merchant, days=days, include_pending=include_pending))


@growth_api.get("/settings/business", response_model=s.BusinessSettingsOut)
def business_settings(ctx: Ctx = Depends(current_ctx)) -> s.BusinessSettingsOut:
    m = ctx.merchant
    fmt = lambda v: f"{v:.2f}" if v is not None else None  # noqa: E731
    return s.BusinessSettingsOut(cash_on_hand=fmt(m.cash_on_hand), cash_on_hand_at=m.cash_on_hand_at,
                                 weekly_expenses=fmt(m.weekly_expenses), default_restock_budget=fmt(m.default_restock_budget))


@growth_api.post("/settings/business", response_model=s.BusinessSettingsOut)
def update_business_settings(body: s.BusinessSettingsRequest, ctx: Ctx = Depends(current_ctx),
                             db: Session = Depends(get_db)) -> s.BusinessSettingsOut:
    growth.update_cash_settings(db, ctx.merchant, ctx.actor, _money(body.cash_on_hand, "Cash in hand"),
                                _money(body.weekly_expenses, "Weekly expenses"),
                                _money(body.default_restock_budget, "Restock budget"))
    db.commit()
    return business_settings(ctx)


# ---------- benchmarks ----------

@growth_api.get("/benchmarks", response_model=s.BenchmarksOut)
def benchmarks(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.BenchmarksOut:
    return s.BenchmarksOut(**growth.benchmarks(db, ctx.merchant_id))


# ---------- proactive scan ----------

@growth_api.post("/agent/scan", response_model=s.ScanOut)
def agent_scan(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.ScanOut:
    ratelimit.check(ctx.merchant_id, "scan")
    return s.ScanOut(**growth.proactive_scan(db, ctx))


# ---------- bills ----------

@growth_api.get("/bills", response_model=list[s.ReceiptOut])
def list_bills(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.ReceiptOut]:
    rows = db.scalars(select(GoodsReceipt).where(GoodsReceipt.merchant_id == ctx.merchant_id)
                      .order_by(GoodsReceipt.created_at.desc()).limit(30)).all()
    return [_receipt_out(r) for r in rows]


@growth_api.post("/bills/text", response_model=s.ReceiptOut)
def bill_from_text(body: s.ReceiptTextRequest, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.ReceiptOut:
    receipt, extras = bills.create_receipt(db, ctx.merchant_id, ctx.user.id, ctx.actor, body.text, "TEXT", body.supplier_name)
    db.commit()
    return _receipt_out(receipt, extras)


@growth_api.post("/bills/scan", response_model=s.ReceiptOut)
async def bill_from_photo(file: UploadFile = File(...), supplier_name: str | None = Form(default=None, max_length=120),
                          ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.ReceiptOut:
    if (file.content_type or "") not in ALLOWED_BILL_TYPES:
        raise ApiError(415, "UNSUPPORTED_FILE", "Send a JPG, PNG, WEBP, HEIC photo or a PDF")
    data = await file.read(10 * 1024 * 1024 + 1)
    if len(data) > 10 * 1024 * 1024:
        raise ApiError(413, "FILE_TOO_LARGE", "Photo too large; keep it under 10 MB")
    filename, content_type = file.filename or "bill.jpg", file.content_type or "image/jpeg"

    def work() -> s.ReceiptOut:
        # Document AI polls for up to ~25 s: keep it off the event loop.
        ratelimit.check(ctx.merchant_id, "bill_scan")
        text = sarvam.parse_document(data, filename, content_type)
        receipt, extras = bills.create_receipt(db, ctx.merchant_id, ctx.user.id, ctx.actor, text, "PHOTO", supplier_name)
        db.commit()
        return _receipt_out(receipt, extras)

    return await run_in_threadpool(work)


@growth_api.post("/bills/{receipt_id}/confirm", response_model=s.ReceiptOut)
def confirm_bill(receipt_id: uuid.UUID, body: s.ConfirmReceiptRequest, ctx: Ctx = Depends(current_ctx),
                 db: Session = Depends(get_db)) -> s.ReceiptOut:
    receipt = bills.confirm_receipt(db, ctx.merchant_id, ctx.user.id, ctx.actor, receipt_id,
                                    [line.model_dump() for line in body.lines], body.supplier_name)
    return _receipt_out(receipt)


@growth_api.post("/bills/{receipt_id}/discard", response_model=s.ReceiptOut)
def discard_bill(receipt_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.ReceiptOut:
    receipt = db.scalars(select(GoodsReceipt).where(GoodsReceipt.id == receipt_id,
                                                    GoodsReceipt.merchant_id == ctx.merchant_id)).first()
    if receipt is None:
        raise ApiError(404, "NOT_FOUND", "Bill not found")
    if receipt.status != "DRAFT":
        raise ApiError(409, "INVALID_TRANSITION", f"This bill is already {receipt.status.lower()}")
    receipt.status = "DISCARDED"
    db.commit()
    return _receipt_out(receipt)
