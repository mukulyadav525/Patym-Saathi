"""Soundbox endpoints: counter voice entries, the shop QR (DEMO payments), and the live feed the app, the
dashboard and the Soundbox follow. Speech-to-text, understanding and the spoken reply all run on the server;
the Sarvam key never reaches a client."""

import asyncio
import time
import uuid

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app import schemas as s
from app.adapters import sarvam
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError, parse_money
from app.models import CounterSale, LiveEvent
from app.security import Ctx, current_ctx
from app.services import live, ratelimit, soundbox

soundbox_api = APIRouter(prefix="/api/v1")
MAX_AUDIO = 2 * 1024 * 1024  # a counter command is a few seconds of 16 kHz WAV


def _result_out(result: dict, speak: bool) -> s.SoundboxResult:
    sale = result.pop("sale")
    out = s.SoundboxResult(**result, sale=s.CounterSaleOut(**soundbox.sale_dict(sale)) if sale else None)
    if speak and out.reply and out.action != "IGNORED" and sarvam.enabled():
        out.speech = sarvam.to_devanagari(out.reply)
        try:
            out.audio = sarvam.speak(out.speech)
        except ApiError:
            out.audio = None  # the reply still shows on screen; the Soundbox falls back to the device voice
    return out


@soundbox_api.post("/soundbox/listen", response_model=s.SoundboxResult)
async def listen(audio: UploadFile = File(...), followup: bool = Form(False), speak: bool = Form(True),
                 ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.SoundboxResult:
    """One utterance the Soundbox heard. Without "Saathi" (and no open question) it is ignored, unspoken."""
    data = await audio.read(MAX_AUDIO + 1)
    if len(data) > MAX_AUDIO:
        raise ApiError(413, "AUDIO_TOO_LARGE", "Keep a command under 20 seconds")
    if len(data) < 1000:
        raise ApiError(422, "AUDIO_TOO_SHORT", "Nothing was recorded")
    name, ctype = audio.filename or "speech.wav", audio.content_type or "audio/wav"

    def work() -> s.SoundboxResult:
        ratelimit.check(ctx.merchant_id, "soundbox")
        heard = sarvam.transcribe(data, name, ctype, "hi-IN")
        latin = sarvam.romanize(heard)
        result = soundbox.handle(db, ctx, latin[:500], followup=followup, heard=heard)
        if result["action"] != "IGNORED":
            ratelimit.check(ctx.merchant_id, "speech")
        return _result_out(result, speak)

    return await run_in_threadpool(work)


@soundbox_api.post("/soundbox/text", response_model=s.SoundboxResult)
def say_text(body: s.SoundboxTextIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.SoundboxResult:
    """Typed command (testing, or a noisy shop). Same pipeline after speech-to-text."""
    ratelimit.check(ctx.merchant_id, "assistant")
    latin = sarvam.romanize(body.text.strip())
    result = soundbox.handle(db, ctx, latin[:500], followup=body.followup, heard=body.text.strip())
    if body.speak and result["action"] != "IGNORED":
        ratelimit.check(ctx.merchant_id, "speech")
    return _result_out(result, body.speak)


@soundbox_api.get("/soundbox/today", response_model=s.SoundboxToday)
def today(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.SoundboxToday:
    return s.SoundboxToday(**soundbox.today_summary(db, ctx.merchant_id))


@soundbox_api.post("/soundbox/sales/{sale_id}/undo", response_model=s.CounterSaleOut)
def undo(sale_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.CounterSaleOut:
    sale = db.scalars(select(CounterSale).where(CounterSale.id == sale_id, CounterSale.merchant_id == ctx.merchant_id)
                      .with_for_update()).first()
    if sale is None:
        raise ApiError(404, "NOT_FOUND", "Entry not found")
    soundbox.undo(db, ctx, sale)
    return s.CounterSaleOut(**soundbox.sale_dict(sale))


@soundbox_api.get("/soundbox/qr", response_model=s.SoundboxQr)
def qr_info(ctx: Ctx = Depends(current_ctx)) -> s.SoundboxQr:
    _demo_only()
    name = ctx.merchant.display_name
    return s.SoundboxQr(pay_path=f"/pay/{soundbox.pay_token(ctx.merchant_id)}", shop_name=name,
                        upi_label=f"{name.split()[0].lower()}@paytm (DEMO)", mode="DEMO")


@soundbox_api.post("/soundbox/qr-payments", response_model=s.QrPaymentOut)
def simulate_payment(body: s.QrPaymentIn, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.QrPaymentOut:
    """'Customer pays' button on the Soundbox (DEMO)."""
    _demo_only()
    ratelimit.check(ctx.merchant_id, "qr_pay")
    qr = soundbox.receive_qr_payment(db, ctx.merchant, parse_money(body.amount, "Amount", "1", "100000"), body.payer, ctx.actor,
                                     body.sale_id)
    return s.QrPaymentOut(**soundbox.qr_dict(db, qr))


@soundbox_api.get("/soundbox/announcements/{event_id}", response_model=s.AudioOut)
def announcement(event_id: int, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.AudioOut:
    """Spoken audio for a live event's announcement ("Paytm par ₹420 prapt hue"). Only server-written text is spoken."""
    event = db.scalars(select(LiveEvent).where(LiveEvent.id == event_id, LiveEvent.merchant_id == ctx.merchant_id)).first()
    if event is None or not event.announce:
        raise ApiError(404, "NOT_FOUND", "Nothing to announce")
    ratelimit.check(ctx.merchant_id, "speech")
    spoken = sarvam.to_devanagari(event.announce)
    return s.AudioOut(audio=sarvam.speak(spoken), text=spoken)


@soundbox_api.get("/live", response_model=s.LiveOut)
async def live_feed(after: int | None = Query(None, ge=0), wait: int = Query(25, ge=0, le=25),
                    ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.LiveOut:
    """Long-poll: returns as soon as there are events newer than `after`, or empty after `wait` seconds.
    Without `after` it returns the current cursor, so a client starts from now."""
    merchant_id = ctx.merchant_id
    db.close()  # don't hold a pooled connection while waiting
    if after is None:
        return s.LiveOut(cursor=await run_in_threadpool(live.latest_id, merchant_id), events=[])
    deadline = time.monotonic() + wait
    while True:
        events = await run_in_threadpool(live.since, merchant_id, after)
        if events or time.monotonic() >= deadline:
            break
        await asyncio.sleep(0.4)
    return s.LiveOut(cursor=events[-1].id if events else after, events=[
        s.LiveEventOut(id=e.id, kind=e.kind, title=e.title, body=e.body, announce=e.announce, data=e.data,
                       created_at=e.created_at) for e in events])


# --- public DEMO pay page (the QR a customer scans) -----------------------------------------------------------

pay_public = APIRouter(prefix="/api/v1")


def _demo_only() -> None:
    settings = get_settings()
    if not settings.demo_mode or settings.paytm_env == "production":
        raise ApiError(404, "NOT_FOUND", "Not available")


@pay_public.get("/pay/{token}", response_model=s.PayPageInfo)
def pay_info(token: str, bill: uuid.UUID | None = Query(None, description="A bill's own QR: show that bill"),
             db: Session = Depends(get_db)) -> s.PayPageInfo:
    _demo_only()
    merchant = soundbox.merchant_for_token(db, token)
    found = s.PayBill(**soundbox.bill_dict(soundbox.find_bill(db, merchant.id, bill))) if bill else None
    return s.PayPageInfo(shop_name=merchant.display_name, locality=merchant.locality, mode="DEMO", bill=found)


@pay_public.post("/pay/{token}", response_model=s.QrPaymentOut)
def pay(token: str, body: s.QrPaymentIn, db: Session = Depends(get_db)) -> s.QrPaymentOut:
    """A customer 'pays' from their phone after scanning the shop QR. DEMO: no money moves."""
    _demo_only()
    merchant = soundbox.merchant_for_token(db, token)
    ratelimit.check(merchant.id, "qr_pay")
    qr = soundbox.receive_qr_payment(db, merchant, parse_money(body.amount, "Amount", "1", "100000"),
                                     body.payer or "Customer", "customer", body.sale_id)
    return s.QrPaymentOut(**soundbox.qr_dict(db, qr))
