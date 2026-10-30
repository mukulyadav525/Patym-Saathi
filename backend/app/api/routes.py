import uuid
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, Depends, File, Header, Query, Request, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import schemas as s
from app.adapters import sarvam
from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.models import Invoice, MerchantMembership, Order, Task, User
from app.security import Ctx, current_ctx, issue_token, verify_password
from app.services import approvals, assistant, dues_flow, restock_flow, views
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


@api.post("/auth/login", response_model=s.LoginResponse)
def login(body: s.LoginRequest, db: Session = Depends(get_db)) -> s.LoginResponse:
    user = db.scalars(select(User).where(User.email == body.email.strip().lower())).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise ApiError(401, "BAD_CREDENTIALS", "Email or password is incorrect")
    membership = db.scalars(select(MerchantMembership).where(MerchantMembership.user_id == user.id,
                                                             MerchantMembership.status == "ACTIVE")).first()
    if membership is None:
        raise ApiError(403, "FORBIDDEN", "No merchant access")
    ctx = current_ctx(f"Bearer {issue_token(user, membership.merchant_id)}", db)
    return s.LoginResponse(
        token=issue_token(user, membership.merchant_id),
        user=s.UserOut(id=str(user.id), email=user.email, display_name=user.display_name, role=membership.role),
        merchant=views.merchant_out(ctx.merchant), demo_mode=get_settings().demo_mode,
    )


@api.get("/me", response_model=s.LoginResponse)
def me(ctx: Ctx = Depends(current_ctx), authorization: str = Header()) -> s.LoginResponse:
    return s.LoginResponse(
        token=authorization.split(" ", 1)[1],
        user=s.UserOut(id=str(ctx.user.id), email=ctx.user.email, display_name=ctx.user.display_name, role=ctx.role),
        merchant=views.merchant_out(ctx.merchant), demo_mode=get_settings().demo_mode,
    )


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
    return assistant.handle(db, ctx, body)


@api.post("/assistant/voice", response_model=s.AssistantResponse)
async def assistant_voice(audio: UploadFile = File(...), language: str = Query("unknown", max_length=10),
                          ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.AssistantResponse:
    data = await audio.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        raise ApiError(413, "AUDIO_TOO_LARGE", "Recording too long; keep it under a minute")
    transcript = sarvam.transcribe(data, audio.filename or "audio.m4a", audio.content_type or "audio/mp4", language)
    return assistant.handle(db, ctx, s.AssistantRequest(text=transcript[:500]), channel="VOICE", transcript=transcript)


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
                     ctx: Ctx = Depends(current_ctx), db: Session = Depends(get_db)) -> s.TaskDetail:
    task_id = approvals.confirm(db, ctx, approval_id, idempotency_key)
    return _task_or_404(db, ctx, task_id)


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
            float(cursor)
        except ValueError:
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
        try:
            amount = Decimal(body.amount).quantize(Decimal("0.01"))
        except InvalidOperation:
            raise ApiError(422, "BAD_AMOUNT", "Amount must be a number")
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
