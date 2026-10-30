"""Orchestrator: text/voice -> intent -> workflow. The LLM only proposes; workflows decide."""

import uuid
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app.adapters import sarvam
from app.errors import ApiError
from app.models import Invoice, Task
from app.security import Ctx
from app.services import audit, brief, dues_flow, intent, restock_flow, views
from app.services.common import move_task, new_correlation_id

MIN_BUDGET = Decimal("100")
MAX_BUDGET = Decimal("500000")
SUGGESTIONS = [
    "Weekend ke liye ₹5,000 ke andar stock arrange karo",
    "Aman Stores ka pending payment collect karo",
    "Aaj mere business mein kya important hai?",
]


def new_task(db: Session, ctx: Ctx, task_type: str, title: str, text: str, channel: str, parsed: dict) -> Task:
    task = Task(merchant_id=ctx.merchant_id, task_type=task_type, state="NEW", title=title, input_text=text,
                input_channel=channel, parsed_intent=parsed, created_by=ctx.user.id,
                correlation_id=new_correlation_id())
    db.add(task)
    db.flush()
    audit.record(db, ctx.merchant_id, ctx.actor, "TASK_CREATED", "task", task.id, f"Request ({channel.lower()}): {text}",
                 task_id=task.id, correlation_id=task.correlation_id)
    return task


def _budget(value: str) -> Decimal:
    try:
        budget = Decimal(value.replace(",", "").replace("₹", "").strip())
    except InvalidOperation as exc:
        raise ApiError(422, "BAD_BUDGET", "Budget must be a number") from exc
    if not MIN_BUDGET <= budget <= MAX_BUDGET:
        raise ApiError(422, "BAD_BUDGET", f"Budget must be between ₹{MIN_BUDGET:,.0f} and ₹{MAX_BUDGET:,.0f}")
    return budget.quantize(Decimal("0.01"))


def handle(db: Session, ctx: Ctx, req: s.AssistantRequest, channel: str = "TEXT",
           transcript: str | None = None) -> s.AssistantResponse:
    text = req.text.strip()
    open_invoices = db.scalars(select(Invoice).where(Invoice.merchant_id == ctx.merchant_id,
                                                     Invoice.status.in_(dues_flow.COLLECTABLE + ("DRAFTED", "SENT")))).all()
    parsed = intent.parse(text, [i.customer_name for i in open_invoices])
    if parsed.intent == "UNKNOWN" or (parsed.intent == "RESTOCK" and parsed.budget is None):
        parsed = intent.merge_llm_candidate(parsed, sarvam.extract_intent(text))
    if req.confirmed_budget:
        parsed.budget = _budget(req.confirmed_budget)
        parsed.budget_from_words = False
        parsed.confidence = "high"

    if parsed.intent == "BRIEF":
        task = new_task(db, ctx, "BRIEF", "Daily brief", text, channel, {"intent": "BRIEF"})
        move_task(db, task, "UNDERSTANDING", "saathi", "Understood: daily brief")
        move_task(db, task, "EVIDENCE_READY", "saathi", "Read invoices, stock and sales records")
        data = s.Brief(**brief.build(db, ctx.merchant_id))
        move_task(db, task, "COMPLETED", "saathi", f"Brief ready with {len(data.priorities)} priorities")
        db.commit()
        return s.AssistantResponse(reply=f"Aaj ke {len(data.priorities)} zaroori kaam:", intent="BRIEF",
                                   transcript=transcript, brief=data)

    if parsed.intent == "RESTOCK":
        if parsed.budget is None:
            return s.AssistantResponse(reply="Kitne budget ke andar stock chahiye? (e.g. ₹5,000)", intent="RESTOCK",
                                       transcript=transcript, suggestions=["₹3,000", "₹5,000", "₹8,000"],
                                       needs_confirmation={"field": "budget", "value": None})
        budget = _budget(str(parsed.budget))
        if parsed.needs_budget_confirmation:
            return s.AssistantResponse(
                reply=f"Budget ₹{budget:,.0f} samjha. Sahi hai?", intent="RESTOCK", transcript=transcript,
                needs_confirmation={"field": "budget", "value": f"{budget:.2f}"},
            )
        task = new_task(db, ctx, "RESTOCK", f"Restock within ₹{budget:,.0f}", text, channel,
                        {"intent": "RESTOCK", "budget": f"{budget:.2f}", "horizon_days": parsed.horizon_days})
        try:
            plan = restock_flow.start_restock(db, task, ctx.actor, budget)
        except ApiError as exc:
            if exc.code != "BUDGET_EXCEEDED":
                raise
            db.rollback()
            return s.AssistantResponse(
                reply=f"Is budget mein poora stock nahi aayega: plan ₹{exc.details['total']} ka hai, budget "
                      f"₹{exc.details['budget']}. Budget badhayein ya kam items chunein.",
                intent="RESTOCK", transcript=transcript)
        db.commit()
        lines = plan.payload["lines"]
        reply = (f"Plan taiyaar: {len(lines)} items, {plan.payload['total_packs']} packs, ₹{plan.total:,.0f} "
                 f"(budget ₹{plan.budget:,.0f}). Dekh kar approve karein.")
        return s.AssistantResponse(reply=reply, intent="RESTOCK", transcript=transcript,
                                   task=views.task_detail(db, ctx.merchant_id, task.id))

    if parsed.intent == "COLLECT_DUE":
        if parsed.customer is None:
            names = [i.customer_name for i in open_invoices if i.status in dues_flow.COLLECTABLE]
            return s.AssistantResponse(reply="Kis customer se payment lena hai?", intent="COLLECT_DUE",
                                       transcript=transcript,
                                       suggestions=[f"{n} ka pending payment collect karo" for n in names])
        invoice = next((i for i in open_invoices if i.customer_name == parsed.customer), None)
        existing = views.invoice_out(db, invoice).open_task_id if invoice else None
        if existing:
            return s.AssistantResponse(reply=f"{invoice.invoice_number} par kaam pehle se chal raha hai.",
                                       intent="COLLECT_DUE", transcript=transcript,
                                       task=views.task_detail(db, ctx.merchant_id, uuid.UUID(existing)))
        if invoice is None or invoice.status not in dues_flow.COLLECTABLE:
            return s.AssistantResponse(reply=f"{parsed.customer} ka koi pending bill nahi mila.", intent="COLLECT_DUE",
                                       transcript=transcript)
        task = new_task(db, ctx, "COLLECT_DUE", f"Collect {invoice.invoice_number} from {invoice.customer_name}",
                        text, channel, {"intent": "COLLECT_DUE", "customer": invoice.customer_name})
        dues_flow.start_collect(db, task, invoice, ctx.merchant, ctx.actor)
        db.commit()
        return s.AssistantResponse(
            reply=f"{invoice.customer_name}: {invoice.invoice_number}, ₹{invoice.amount:,.0f} pending. "
                  "Payment link aur message taiyaar hai, approve karein.",
            intent="COLLECT_DUE", transcript=transcript, task=views.task_detail(db, ctx.merchant_id, task.id))

    return s.AssistantResponse(reply="Main stock planning, dues collection aur daily brief mein madad kar sakta hoon.",
                               intent="UNKNOWN", transcript=transcript, suggestions=SUGGESTIONS)


def start_collect_for_invoice(db: Session, ctx: Ctx, invoice: Invoice) -> Task:
    existing = views.invoice_out(db, invoice).open_task_id
    if existing:
        return db.get(Task, uuid.UUID(existing))
    task = new_task(db, ctx, "COLLECT_DUE", f"Collect {invoice.invoice_number} from {invoice.customer_name}",
                    f"Collect {invoice.invoice_number}", "TEXT", {"intent": "COLLECT_DUE", "customer": invoice.customer_name})
    dues_flow.start_collect(db, task, invoice, ctx.merchant, ctx.actor)
    db.commit()
    return task
