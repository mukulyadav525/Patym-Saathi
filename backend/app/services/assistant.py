"""Orchestrator: text/voice -> intent -> workflow. The LLM only proposes; workflows decide."""

import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app import schemas as s
from app.adapters import sarvam
from app.errors import ApiError, parse_money
from app.models import Invoice, Task
from app.security import Ctx
from app.services import audit, brief, dues_flow, growth, intent, restock_flow, views
from app.services.common import move_task, new_correlation_id
from app.services.states import UNPAID

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
    return parse_money(value, "Budget", str(MIN_BUDGET), str(MAX_BUDGET))


def handle(db: Session, ctx: Ctx, req: s.AssistantRequest, channel: str = "TEXT",
           transcript: str | None = None) -> s.AssistantResponse:
    text = req.text.strip()
    open_invoices = db.scalars(select(Invoice).where(Invoice.merchant_id == ctx.merchant_id,
                                                     Invoice.status.in_(UNPAID))).all()
    parsed = intent.parse(text, [i.customer_name for i in open_invoices])
    if parsed.intent == "UNKNOWN" or (parsed.intent == "RESTOCK" and parsed.budget is None):
        parsed = intent.merge_llm_candidate(parsed, sarvam.extract_intent(text))
    if req.confirmed_budget:
        parsed.budget = _budget(req.confirmed_budget)
        parsed.budget_from_words = False
        parsed.confidence = "high"

    if parsed.intent == "GROWTH":
        reply, screen = growth_answer(db, ctx, parsed.topic or "")
        return s.AssistantResponse(reply=reply, intent="GROWTH", transcript=transcript, open_screen=screen)

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
            festive = parsed.festival is not None
            return s.AssistantResponse(
                reply=("Diwali ke stock ke liye kitna budget rakhein? (e.g. ₹10,000)" if festive
                       else "Kitne budget ke andar stock chahiye? (e.g. ₹5,000)"),
                intent="RESTOCK", transcript=transcript,
                suggestions=["₹8,000", "₹10,000", "₹12,000"] if festive else ["₹3,000", "₹5,000", "₹8,000"],
                needs_confirmation={"field": "budget", "value": None})
        budget = _budget(str(parsed.budget))
        if parsed.needs_budget_confirmation:
            return s.AssistantResponse(
                reply=f"Budget ₹{budget:,.0f} samjha. Sahi hai?", intent="RESTOCK", transcript=transcript,
                needs_confirmation={"field": "budget", "value": f"{budget:.2f}"},
            )
        title = (f"Diwali stock within ₹{budget:,.0f}" if parsed.festival == "DIWALI"
                 else f"Restock within ₹{budget:,.0f}")
        task = new_task(db, ctx, "RESTOCK", title, text, channel,
                        {"intent": "RESTOCK", "budget": f"{budget:.2f}", "horizon_days": parsed.horizon_days,
                         **({"festival": parsed.festival} if parsed.festival else {})})
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
        reply = (f"{'Diwali plan' if parsed.festival else 'Plan'} taiyaar: {len(lines)} items, "
                 f"{plan.payload['total_packs']} packs, ₹{plan.total:,.0f} (budget ₹{plan.budget:,.0f}). "
                 + ("Pichhli Diwali ki bikri ke hisaab se maang badhai hai. " if parsed.festival else "")
                 + "Dekh kar approve karein.")
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

    return s.AssistantResponse(reply="Main stock planning, Diwali stock, dues, khata, cash flow, offers aur daily brief "
                                     "mein madad kar sakta hoon.",
                               intent="UNKNOWN", transcript=transcript, suggestions=SUGGESTIONS)


def growth_answer(db: Session, ctx: Ctx, topic: str) -> tuple[str, str]:
    """Short Hinglish answer computed from records, plus the screen that shows the detail. Read-only."""
    mid = ctx.merchant_id
    if topic == "OFFERS":
        slow = growth.slow_movers(db, mid)
        if not slow:
            return "Abhi koi item atka hua nahi hai. Sab theek bik raha hai.", "offers"
        top = slow[0]
        return (f"{len(slow)} items dheere bik rahe hain. {top['name']}: {top['stock']} packs pade hain, "
                f"pichhle hafte {top['last_week']} bike. {top['suggested_discount']}% chhoot ka offer ₹{Decimal(top['offer_price']):,.0f} "
                "mein bana sakte hain; aap khud share karenge.", "offers")
    if topic == "KHATA":
        k = growth.khata_insights(db, mid)
        late = [c for c in k["customers"] if c["label"] == "Pays late" and Decimal(c["outstanding"]) > 0]
        reply = f"Khate mein kul ₹{Decimal(k['total_outstanding']):,.0f} baaki hai."
        if late:
            reply += f" {late[0]['customer_name']} aksar der se dete hain (average {late[0]['avg_days_to_pay']:.0f} din)."
        return reply, "khata"
    if topic == "CASHFLOW":
        c = growth.cashflow(db, ctx.merchant)
        if Decimal(c["shortfall"]) > 0:
            return (f"Andaaza: {c['first_negative_on']} tak cash ₹{Decimal(c['shortfall']):,.0f} kam pad sakta hai. "
                    "Detail aur assumptions dekhiye.", "cashflow")
        return (f"Agle {c['days']} din cash theek dikh raha hai; sabse kam ₹{Decimal(c['lowest_balance']):,.0f} "
                f"({c['lowest_on']}).", "cashflow")
    if topic == "BENCHMARKS":
        b = growth.benchmarks(db, mid)
        if not b["insights"]:
            return "Aas-paas ki dukaanon jaisa hi chal raha hai.", "benchmarks"
        return b["insights"][0]["text"], "benchmarks"
    if topic == "IMPACT":
        i = growth.impact(db, mid)
        return (f"Saathi ne ab tak {i['restocks_completed']} restock poore kiye, budget se ₹{Decimal(i['under_budget']):,.0f} "
                f"kam kharch hua aur sahi supplier chun kar ₹{Decimal(i['supplier_savings']):,.0f} bache.", "impact")
    if topic == "BILLS":
        return "Supplier ka bill photo ya text se daaliye; har line dekh kar confirm karne par hi stock badhega.", "bills"
    f = growth.upcoming_festival(db, mid)
    if f:
        return f"{f['name']} {f['days_left']} din mein hai. Festival stock plan banaun?", "festival"
    return "Agle 30 din mein koi bada tyohar nahi hai.", "festival"


def start_collect_for_invoice(db: Session, ctx: Ctx, invoice: Invoice) -> Task:
    existing = views.invoice_out(db, invoice).open_task_id
    if existing:
        return db.get(Task, uuid.UUID(existing))
    task = new_task(db, ctx, "COLLECT_DUE", f"Collect {invoice.invoice_number} from {invoice.customer_name}",
                    f"Collect {invoice.invoice_number}", "TEXT", {"intent": "COLLECT_DUE", "customer": invoice.customer_name})
    dues_flow.start_collect(db, task, invoice, ctx.merchant, ctx.actor)
    db.commit()
    return task
