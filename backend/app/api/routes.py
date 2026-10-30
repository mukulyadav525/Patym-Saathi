import math
import uuid
from datetime import timedelta
from decimal import Decimal

from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, Header, Query, Request, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import schemas as s
from app.adapters import sarvam
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError, parse_money
from app.models import Invoice, MerchantMembership, Order, Task, User, utcnow
from app.security import Ctx, current_ctx, hash_password, issue_token, verify_password
from app.services import approvals, assistant, audit, dues_flow, ratelimit, readback, restock_flow, views
from app.services.common import move_task
from app.tools import registry

VERSION = "0.1.0"
public = APIRouter()
api = APIRouter(prefix="/api/v1")


@public.get("/health", response_model=s.Health)
def health(db: Session = Depends(get_db)) -> s.Health:
    try:
        db.execute(text("select 1"))
        database = "ok"
    except Exception:  # noqa: BLE001
        database = "unavailable"
    settings = get_settings()
    return s.Health(status="ok" if database == "ok" else "degraded", version=VERSION, database=database,
                    paytm_mode=settings.paytm_env.upper(), voice="LIVE" if sarvam.enabled() else "OFF")


LOGIN_MAX_TRIES = 5
LOGIN_LOCK = timedelta(minutes=15)


def audit_login_lock(db: Session, user: User) -> None:
    membership = db.scalars(select(MerchantMembership).where(MerchantMembership.user_id == user.id)).first()
    if membership:
        audit.record(db, membership.merchant_id, "system", "LOGIN_LOCKED", "user", user.id,
                     "Sign-in locked for 15 minutes after repeated wrong passwords")


def user_out(user: User, role: str) -> s.UserOut:
    return s.UserOut(id=str(user.id), email=user.email, display_name=user.display_name, role=role,
                     has_approval_pin=bool(user.approval_pin_hash))


@api.post("/auth/login", response_model=s.LoginResponse)
def login(body: s.LoginRequest, db: Session = Depends(get_db)) -> s.LoginResponse:
    user = db.scalars(select(User).where(User.email == body.email.strip().lower()).with_for_update()).first()
    now = utcnow()
    if user is not None and user.login_locked_until and user.login_locked_until > now:
        raise ApiError(429, "LOGIN_LOCKED", "Too many wrong passwords. Try again in 15 minutes")
    if user is None or not verify_password(body.password, user.password_hash):
        if user is not None:
            user.login_failed_count += 1
            if user.login_failed_count >= LOGIN_MAX_TRIES:
                user.login_failed_count, user.login_locked_until = 0, now + LOGIN_LOCK
                audit_login_lock(db, user)
            db.commit()
        raise ApiError(401, "BAD_CREDENTIALS", "Email or password is incorrect")
    if user.login_failed_count or user.login_locked_until:
        user.login_failed_count, user.login_locked_until = 0, None
        db.commit()
    membership = db.scalars(select(MerchantMembership).where(MerchantMembership.user_id == user.id,
                                                             MerchantMembership.status == "ACTIVE")).first()
    if membership is None:
        raise ApiError(403, "FORBIDDEN", "No merchant access")
    ctx = current_ctx(f"Bearer {issue_token(user, membership.merchant_id)}", db)
    return s.LoginResponse(
        token=issue_token(user, membership.merchant_id),
        user=user_out(user, membership.role),
        merchant=views.merchant_out(ctx.merchant), demo_mode=get_settings().demo_mode,
    )


@api.get("/me", response_model=s.LoginResponse)
def me(ctx: Ctx = Depends(current_ctx), authorization: str = Header()) -> s.LoginResponse:
    return s.LoginResponse(
        token=authorization.split(" ", 1)[1],
        user=user_out(ctx.user, ctx.role),
        merchant=views.merchant_out(ctx.merchant), demo_mode=get_settings().demo_mode,
    )


@api.post("/me/approval-pin", response_model=s.SimpleResult)
def set_approval_pin(body: s.ApprovalPinRequest, ctx: Ctx = Depends(current_ctx),
                     db: Session = Depends(get_db)) -> s.SimpleResult:
    user = db.get(User, ctx.user.id)
    if not verify_password(body.password, user.password_hash):
        raise ApiError(403, "BAD_PASSWORD", "Password is incorrect")  # not 401: the session itself is fine
    user.approval_pin_hash = hash_password(body.pin) if body.pin else None
    user.pin_failed_count, user.pin_locked_until = 0, None
    audit.record(db, ctx.merchant_id, ctx.actor, "APPROVAL_PIN_SET" if body.pin else "APPROVAL_PIN_CLEARED",
                 "user", user.id, f"{user.display_name} {'set' if body.pin else 'removed'} an approval PIN")
    db.commit()
    return s.SimpleResult(ok=True, message="Approval PIN set" if body.pin else "Approval PIN removed")


@api.get("/dashboard", response_model=s.DashboardOut)
def dashboard(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.DashboardOut:
    result = views.dashboard(db, ctx.merchant, get_settings().demo_mode)
    db.commit()  # persists any simulated quote refresh
    return result


@api.get("/brief", response_model=s.Brief)
def get_brief(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.Brief:
    from app.services import brief

    return s.Brief(**brief.build(db, ctx.merchant_id))


@api.post("/assistant/message", response_model=s.AssistantResponse)
def assistant_message(body: s.AssistantRequest, ctx: Ctx = Depends(current_ctx),
                      db: Session = Depends(get_db)) -> s.AssistantResponse:
    ratelimit.check(ctx.merchant_id, "assistant")
    original = body.text
    # On-device speech recognition sends Hindi in Devanagari; the parser and name matching work on Latin Hinglish.
    if sarvam.INDIC.search(body.text):
        body = body.model_copy(update={"text": sarvam.romanize(body.text)[:500]})
    resp = assistant.handle(db, ctx, body, transcript=original if original != body.text else None)
    if body.speak:
        resp.speech = assistant.speech_for(resp)
    return resp


@api.post("/assistant/voice", response_model=s.AssistantResponse)
async def assistant_voice(audio: UploadFile = File(...), language: str = Query("unknown", max_length=10),
                          ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.AssistantResponse:
    data = await audio.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise ApiError(413, "AUDIO_TOO_LARGE", "Recording too long; keep it under a minute")
    filename, content_type = audio.filename or "audio.m4a", audio.content_type or "audio/mp4"

    def work() -> s.AssistantResponse:
        # Blocking Sarvam + DB work runs in the thread pool so one recording never stalls other requests.
        ratelimit.check(ctx.merchant_id, "voice")
        transcript = sarvam.transcribe(data, filename, content_type, language)
        # Saaras returns Devanagari for Hindi; the parser works on Latin/Hinglish. Show the original, parse the romanized.
        parse_text = sarvam.romanize(transcript)
        resp = assistant.handle(db, ctx, s.AssistantRequest(text=parse_text[:500]), channel="VOICE", transcript=transcript)
        resp.speech = assistant.speech_for(resp)
        return resp

    return await run_in_threadpool(work)


@api.get("/tasks/{task_id}/readback", response_model=s.ReadbackOut)
def task_readback(task_id: uuid.UUID, lang: str = Query("hi-IN", pattern="^(hi|en)-IN$"), audio: bool = False,
                  ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.ReadbackOut:
    text = readback.text_for(_task_or_404(db, ctx, task_id), lang)
    if text is None:
        raise ApiError(409, "NOTHING_TO_APPROVE", "This task has nothing waiting for approval")
    if not audio or not sarvam.enabled():
        return s.ReadbackOut(text=text, voice="LIVE" if sarvam.enabled() else "OFF")
    ratelimit.check(ctx.merchant_id, "speech")
    return s.ReadbackOut(text=text, voice="LIVE", audio_base64=sarvam.speak(text, lang), mime="audio/mpeg")


@api.get("/tasks", response_model=list[s.TaskSummary])
def list_tasks(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.TaskSummary]:
    return views.tasks(db, ctx.merchant_id)


def _task_or_404(db: Session, ctx: Ctx, task_id: uuid.UUID) -> s.TaskDetail:
    detail = views.task_detail(db, ctx.merchant_id, task_id)
    if detail is None:
        raise ApiError(404, "NOT_FOUND", "Task not found")
    return detail


@api.get("/tasks/{task_id}", response_model=s.TaskDetail)
def get_task(task_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TaskDetail:
    return _task_or_404(db, ctx, task_id)


@api.post("/tasks/{task_id}/replan", response_model=s.TaskDetail)
def replan(task_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TaskDetail:
    """Re-draft a plan that has not been executed yet (e.g. quotes changed). Supersedes the old approval."""
    task = db.scalars(select(Task).where(Task.id == task_id, Task.merchant_id == ctx.merchant_id)).first()
    if task is None or task.task_type != "RESTOCK":
        raise ApiError(404, "NOT_FOUND", "Restock task not found")
    if task.state != "AWAITING_APPROVAL" or restock_flow.committed_spend(db, task.id) > 0:
        raise ApiError(409, "INVALID_TRANSITION", "Only an unexecuted plan awaiting approval can be re-planned")
    move_task(db, task, "PLAN_DRAFTED", ctx.actor, "Merchant asked for a fresh plan")
    plan = restock_flow.draft_plan(db, task, ctx.actor, Decimal(task.parsed_intent["budget"]), "Re-plan with fresh quotes")
    restock_flow.request_approval(db, task, plan)
    move_task(db, task, "AWAITING_APPROVAL", "saathi", "Waiting for merchant approval")
    db.commit()
    return _task_or_404(db, ctx, task_id)


@api.post("/approvals/{approval_id}/confirm", response_model=s.TaskDetail)
def confirm_approval(approval_id: uuid.UUID, idempotency_key: str = Header(alias="Idempotency-Key"),
                     approval_pin: str | None = Header(default=None, alias="X-Approval-Pin", max_length=8),
                     ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TaskDetail:
    task_id = approvals.confirm(db, ctx, approval_id, idempotency_key, approval_pin)
    return _task_or_404(db, ctx, task_id)


@api.post("/tasks/{task_id}/renew-approval", response_model=s.TaskDetail)
def renew_approval(task_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TaskDetail:
    return _task_or_404(db, ctx, approvals.renew(db, ctx, task_id))


@api.post("/approvals/{approval_id}/reject", response_model=s.TaskDetail)
def reject_approval(approval_id: uuid.UUID, ctx: Ctx = Depends(current_ctx),
                    db: Session = Depends(get_db)) -> s.TaskDetail:
    task_id = approvals.reject(db, ctx, approval_id)
    return _task_or_404(db, ctx, task_id)


@api.get("/approvals", response_model=list[s.ApprovalOut])
def list_approvals(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.ApprovalOut]:
    return views.approvals(db, ctx.merchant_id)


@api.get("/inventory", response_model=list[s.InventoryItem])
def inventory(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.InventoryItem]:
    return views.inventory(db, ctx.merchant_id)


@api.get("/orders", response_model=list[s.OrderOut])
def orders(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.OrderOut]:
    return views.orders(db, ctx.merchant_id)


@api.get("/invoices", response_model=list[s.InvoiceOut])
def invoices(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.InvoiceOut]:
    return views.invoices(db, ctx.merchant_id)


def _invoice(db: Session, ctx: Ctx, invoice_id: uuid.UUID) -> Invoice:
    invoice = db.scalars(select(Invoice).where(Invoice.id == invoice_id, Invoice.merchant_id == ctx.merchant_id)).first()
    if invoice is None:
        raise ApiError(404, "NOT_FOUND", "Invoice not found")
    return invoice


@api.post("/invoices/{invoice_id}/payment-link", response_model=s.TaskDetail)
def payment_link(invoice_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TaskDetail:
    task = assistant.start_collect_for_invoice(db, ctx, _invoice(db, ctx, invoice_id))
    return _task_or_404(db, ctx, task.id)


@api.post("/invoices/{invoice_id}/recheck", response_model=s.SimpleResult)
def recheck_invoice(invoice_id: uuid.UUID, ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.SimpleResult:
    invoice = _invoice(db, ctx, invoice_id)
    outcome = dues_flow.recheck_payment(db, invoice, ctx.actor)
    db.commit()
    messages = {
        "PAID": f"{invoice.invoice_number}: payment verified (4/4 checks) and marked paid",
        "FAILED": f"{invoice.invoice_number}: the payment failed; you can send a new link",
        "RECONCILIATION_REQUIRED": "Payment details still don't match the invoice; not marked paid",
        "WAITING": "No payment received for this link yet",
    }
    return s.SimpleResult(ok=outcome == "PAID", outcome=outcome, message=messages[outcome])


@api.post("/invoices/{invoice_id}/not-received", response_model=s.SimpleResult)
def invoice_not_received(invoice_id: uuid.UUID, ctx: Ctx = Depends(current_ctx),
                         db: Session = Depends(get_db)) -> s.SimpleResult:
    invoice = _invoice(db, ctx, invoice_id)
    dues_flow.mark_not_received(db, invoice, ctx.actor)
    db.commit()
    return s.SimpleResult(ok=True, outcome=invoice.status,
                          message=f"{invoice.invoice_number} marked not received; you can collect it again")


@api.post("/invoices/{invoice_id}/withdraw-link", response_model=s.SimpleResult)
def withdraw_invoice_link(invoice_id: uuid.UUID, ctx: Ctx = Depends(current_ctx),
                          db: Session = Depends(get_db)) -> s.SimpleResult:
    invoice = _invoice(db, ctx, invoice_id)
    dues_flow.withdraw_link(db, invoice, ctx.actor)
    db.commit()
    return s.SimpleResult(ok=True, outcome=invoice.status,
                          message=f"Link for {invoice.invoice_number} withdrawn; you can create a new one")


@api.post("/webhooks/paytm")
async def paytm_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    body = await request.body()
    if len(body) > 64 * 1024:
        raise ApiError(413, "PAYLOAD_TOO_LARGE", "Webhook body too large")
    result = dues_flow.process_webhook(db, dict(request.headers), body)
    db.commit()
    return {"outcome": result["outcome"]}


@api.get("/connections", response_model=list[s.ConnectionOut])
def connections(ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> list[s.ConnectionOut]:
    return views.connections(db, ctx.merchant_id)


@api.get("/audit", response_model=s.Page)
def audit_events(task_id: uuid.UUID | None = None, cursor: str | None = Query(None, max_length=40),
                 limit: int = Query(50, ge=1, le=200), ctx: Ctx = Depends(current_ctx),
                 db: Session = Depends(get_db)) -> s.Page:
    if cursor:
        try:
            valid = math.isfinite(float(cursor)) and float(cursor) > 0
        except ValueError:
            valid = False
        if not valid:
            raise ApiError(400, "BAD_CURSOR", "Invalid cursor")
    return views.audit_page(db, ctx.merchant_id, task_id, cursor, limit)


@api.get("/tools", response_model=list[s.ToolOut])
def tools(ctx: Ctx = Depends(current_ctx)) -> list[s.ToolOut]:
    return [s.ToolOut(**t) for t in registry.catalogue()]


# ---------- demo controls (DEMO_MODE + DEMO_ADMIN only) ----------

def demo_admin(ctx: Ctx = Depends(current_ctx)) -> Ctx:
    if not get_settings().demo_mode:
        raise ApiError(404, "NOT_FOUND", "Demo controls are disabled")
    if ctx.role != "DEMO_ADMIN":
        raise ApiError(403, "FORBIDDEN", "Demo controls need the demo admin role")
    return ctx


@api.post("/demo/reset", response_model=s.SimpleResult)
def demo_reset(ctx: Ctx = Depends(demo_admin), db: Session = Depends(get_db)) -> s.SimpleResult:
    from app.seed import reset

    reset(db)
    return s.SimpleResult(ok=True, message="Demo data restored to the known starting state")


@api.post("/demo/simulate-delivery/{order_id}", response_model=s.SimpleResult)
def demo_delivery(order_id: uuid.UUID, ctx: Ctx = Depends(demo_admin), db: Session = Depends(get_db)) -> s.SimpleResult:
    order = db.scalars(select(Order).where(Order.id == order_id, Order.merchant_id == ctx.merchant_id)).first()
    if order is None:
        raise ApiError(404, "NOT_FOUND", "Order not found")
    packs = restock_flow.receive_goods(db, order, ctx.actor)
    db.commit()
    return s.SimpleResult(ok=True, message=f"{order.reference}: {packs} packs received (simulated)",
                          task_id=str(order.task_id))


@api.post("/demo/tasks/{task_id}/simulate-delivery", response_model=s.TaskDetail)
def demo_task_delivery(task_id: uuid.UUID, ctx: Ctx = Depends(demo_admin), db: Session = Depends(get_db)) -> s.TaskDetail:
    open_orders = db.scalars(select(Order).where(Order.task_id == task_id, Order.merchant_id == ctx.merchant_id,
                                                 Order.status.in_(restock_flow.OPEN_ORDER_STATES))).all()
    if not open_orders:
        raise ApiError(409, "NOTHING_TO_RECEIVE", "No accepted orders waiting for delivery")
    for order in open_orders:
        restock_flow.receive_goods(db, order, ctx.actor)
    db.commit()
    return _task_or_404(db, ctx, task_id)


@api.post("/demo/simulate-payment/{invoice_id}", response_model=s.SimpleResult)
def demo_payment(invoice_id: uuid.UUID, body: s.SimulatePaymentRequest | None = None,
                 ctx: Ctx = Depends(demo_admin), db: Session = Depends(get_db)) -> s.SimpleResult:
    invoice = _invoice(db, ctx, invoice_id)
    amount = None
    if body and body.amount:
        amount = parse_money(body.amount, "Amount", "0.01", "10000000")
    result = dues_flow.simulate_payment(db, invoice, amount)
    db.commit()
    task = db.scalar(select(Task.id).where(Task.invoice_id == invoice.id).order_by(Task.created_at.desc()).limit(1))
    messages = {
        "PAID": f"{invoice.invoice_number} verified (4/4 checks) and marked PAID — DEMO payment",
        "RECONCILIATION_REQUIRED": "Payment details did not match; invoice NOT marked paid",
    }
    return s.SimpleResult(ok=result["outcome"] == "PAID", outcome=result["outcome"],
                          message=messages.get(result["outcome"], result["outcome"]),
                          task_id=str(task) if task else None)
