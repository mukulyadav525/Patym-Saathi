"""Read models: turn DB rows into API schemas. Every query is filtered by merchant_id."""

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import schemas as s
from app.models import (
    today_ist,
    Approval,
    AuditEvent,
    DataConnection,
    Invoice,
    Merchant,
    Order,
    OrderLine,
    Plan,
    Product,
    Supplier,
    Task,
)
from app.services import brief as brief_service
from app.services.states import UNPAID
from app.services.restock_flow import inventory_snapshot, sales_summary

NEEDS_APPROVAL = {"AWAITING_APPROVAL"}
DONE = {"COMPLETED", "PARTIALLY_COMPLETED", "CANCELLED", "FAILED"}


def m(value: Decimal | None) -> str | None:
    return None if value is None else f"{value:.2f}"


def merchant_out(merchant: Merchant) -> s.MerchantOut:
    return s.MerchantOut(id=str(merchant.id), display_name=merchant.display_name, owner_name=merchant.owner_name,
                         locality=merchant.locality)


def inventory(db: Session, merchant_id: uuid.UUID) -> list[s.InventoryItem]:
    sales = sales_summary(db, merchant_id)
    out = []
    for product, inv in inventory_snapshot(db, merchant_id):
        weeks = sales.get(str(product.id), {}).get("weeks", [])[-4:]
        avg = Decimal(sum(weeks)) / len(weeks) if weeks else Decimal("0")
        out.append(s.InventoryItem(
            product_id=str(product.id), sku=product.sku, name=product.name, name_hi=product.name_hi,
            pack_label=product.pack_label, usable_packs=inv.usable_packs, avg_weekly=f"{avg:.0f}",
            sell_price=m(product.sell_price), low=bool(weeks) and Decimal(inv.usable_packs) < avg * brief_service.LOW_STOCK_RATIO,
            source=inv.source, updated_at=inv.source_updated_at,
        ))
    return out


def invoice_out(db: Session, invoice: Invoice, today: date | None = None) -> s.InvoiceOut:
    today = today or today_ist()
    open_task = db.scalar(select(Task.id).where(Task.invoice_id == invoice.id, Task.state.notin_(DONE))
                          .order_by(Task.created_at.desc()).limit(1))
    overdue = (today - invoice.due_date).days if invoice.status not in ("PAID", "CANCELLED", "REFUNDED") else 0
    return s.InvoiceOut(
        id=str(invoice.id), invoice_number=invoice.invoice_number, customer_name=invoice.customer_name,
        customer_phone_masked=invoice.customer_phone_masked, amount=m(invoice.amount), currency=invoice.currency,
        status=invoice.status, due_date=invoice.due_date, days_overdue=max(0, overdue), link_url=invoice.link_url,
        link_mode=invoice.link_mode, draft_message=invoice.draft_message, paid_at=invoice.paid_at,
        open_task_id=str(open_task) if open_task else None,
    )


def invoices(db: Session, merchant_id: uuid.UUID) -> list[s.InvoiceOut]:
    rows = db.scalars(select(Invoice).where(Invoice.merchant_id == merchant_id).order_by(Invoice.due_date)).all()
    return [invoice_out(db, inv) for inv in rows]


def orders(db: Session, merchant_id: uuid.UUID, task_id: uuid.UUID | None = None) -> list[s.OrderOut]:
    query = (select(Order, Supplier).join(Supplier, Supplier.id == Order.supplier_id)
             .where(Order.merchant_id == merchant_id).order_by(Order.created_at.desc()))
    if task_id:
        query = query.where(Order.task_id == task_id)
    out = []
    for order, supplier in db.execute(query).all():
        lines = db.execute(select(OrderLine, Product).join(Product, Product.id == OrderLine.product_id)
                           .where(OrderLine.order_id == order.id).order_by(Product.sort_order)).all()
        out.append(s.OrderOut(
            id=str(order.id), reference=order.reference, task_id=str(order.task_id), supplier_name=supplier.name,
            status=order.status, connector_mode=order.connector_mode, total=m(order.total), created_at=order.created_at,
            lines=[s.OrderLineOut(product_id=str(p.id), name=p.name, pack_label=p.pack_label, packs=l.packs,
                                  unit_price=m(l.unit_price), line_total=m(l.line_total), line_status=l.line_status)
                   for l, p in lines],
        ))
    return out


def plan_out(plan: Plan) -> s.PlanOut:
    payload = plan.payload
    evidence = payload.get("evidence", {})
    return s.PlanOut(
        id=str(plan.id), version=plan.version, status=plan.status, reason=plan.reason, budget=m(plan.budget),
        total=m(plan.total), committed_total=m(plan.committed_total), remaining_budget=m(plan.budget - plan.total),
        total_packs=payload.get("total_packs", 0),
        lines=[s.PlanLineOut(**{k: line.get(k) for k in s.PlanLineOut.model_fields if k in line}) for line in payload["lines"]],
        diff=[s.PlanDiff(**d) for d in payload.get("diff", [])], assumptions=payload.get("assumptions", []),
        sources=evidence.get("sources", []), missing=evidence.get("missing", []), created_at=plan.created_at,
        festival=payload.get("festival"), festival_evidence=evidence.get("festival", []),
    )


def approval_out(approval: Approval) -> s.ApprovalOut:
    snap = approval.payload_snapshot
    if approval.action_type == "SUPPLIER_ORDER":
        summary = f"Supplier order plan v{snap.get('plan_version')} · {', '.join(snap.get('suppliers', []))}"
    else:
        summary = f"Payment link {snap.get('invoice_number')} · {snap.get('customer')}"
    return s.ApprovalOut(
        id=str(approval.id), task_id=str(approval.task_id), action_type=approval.action_type, status=approval.status,
        amount=m(approval.amount), currency=approval.currency, expires_at=approval.expires_at,
        approved_by=str(approval.approved_by) if approval.approved_by else None, approved_at=approval.approved_at,
        created_at=approval.created_at, payload_hash_short=approval.payload_hash[:12],
        plan_version=snap.get("plan_version"), summary=summary,
    )


def audit_out(event: AuditEvent) -> s.AuditOut:
    return s.AuditOut(id=str(event.id), actor=event.actor, event_type=event.event_type, entity_type=event.entity_type,
                      entity_id=event.entity_id, summary=event.summary,
                      task_id=str(event.task_id) if event.task_id else None, details=event.details_redacted,
                      created_at=event.created_at)


def _group(state: str) -> str:
    if state in NEEDS_APPROVAL:
        return "NEEDS_APPROVAL"
    if state in DONE:
        return "DONE"
    return "IN_PROGRESS"


def task_summary(db: Session, task: Task, prefetched: dict | None = None) -> s.TaskSummary:
    if prefetched is not None:
        pending = prefetched["pending"].get(task.id)
        plan = prefetched["plans"].get(task.id)
        invoice = prefetched["invoices"].get(task.invoice_id) if task.invoice_id else None
    else:
        pending = db.scalars(select(Approval).where(Approval.task_id == task.id, Approval.status == "PENDING")
                             .order_by(Approval.created_at.desc())).first()
        plan = (db.scalars(select(Plan).where(Plan.task_id == task.id).order_by(Plan.version.desc())).first()
                if task.task_type == "RESTOCK" else None)
        invoice = db.get(Invoice, task.invoice_id) if task.invoice_id else None
    amount = None
    if task.task_type == "RESTOCK":
        amount = m(plan.total) if plan else None
    elif invoice is not None:
        amount = m(invoice.amount)
    return s.TaskSummary(
        id=str(task.id), task_type=task.task_type, state=task.state, title=task.title, input_text=task.input_text,
        input_channel=task.input_channel, result_note=task.result_note, amount=amount,
        pending_approval_id=str(pending.id) if pending else None, group=_group(task.state),
        created_at=task.created_at, updated_at=task.updated_at,
    )


def tasks(db: Session, merchant_id: uuid.UUID) -> list[s.TaskSummary]:
    rows = db.scalars(select(Task).where(Task.merchant_id == merchant_id, Task.task_type != "BRIEF")
                      .order_by(Task.updated_at.desc())).all()
    if not rows:
        return []
    ids = [t.id for t in rows]
    pending: dict = {}
    for a in db.scalars(select(Approval).where(Approval.task_id.in_(ids), Approval.status == "PENDING")
                        .order_by(Approval.created_at)):
        pending[a.task_id] = a  # latest wins
    plans: dict = {}
    for p in db.scalars(select(Plan).where(Plan.task_id.in_(ids)).order_by(Plan.version)):
        plans[p.task_id] = p  # highest version wins
    invoice_ids = [t.invoice_id for t in rows if t.invoice_id]
    invoices = {i.id: i for i in db.scalars(select(Invoice).where(Invoice.id.in_(invoice_ids)))} if invoice_ids else {}
    prefetched = {"pending": pending, "plans": plans, "invoices": invoices}
    return [task_summary(db, t, prefetched) for t in rows]


def task_detail(db: Session, merchant_id: uuid.UUID, task_id: uuid.UUID) -> s.TaskDetail | None:
    task = db.scalars(select(Task).where(Task.id == task_id, Task.merchant_id == merchant_id)).first()
    if task is None:
        return None
    plans = db.scalars(select(Plan).where(Plan.task_id == task.id).order_by(Plan.version)).all()
    approvals = db.scalars(select(Approval).where(Approval.task_id == task.id).order_by(Approval.created_at)).all()
    events = db.scalars(select(AuditEvent).where(AuditEvent.task_id == task.id, AuditEvent.merchant_id == merchant_id)
                        .order_by(AuditEvent.created_at)).all()
    first_plan = plans[0].created_at if plans else None
    return s.TaskDetail(
        **task_summary(db, task).model_dump(),
        parsed_intent=task.parsed_intent, plans=[plan_out(p) for p in plans],
        approvals=[approval_out(a) for a in approvals], orders=orders(db, merchant_id, task.id),
        invoice=invoice_out(db, db.get(Invoice, task.invoice_id)) if task.invoice_id else None,
        events=[audit_out(e) for e in events],
        time_to_plan_seconds=(first_plan - task.created_at).total_seconds() if first_plan else None,
    )


def connections(db: Session, merchant_id: uuid.UUID) -> list[s.ConnectionOut]:
    rows = db.scalars(select(DataConnection).where(DataConnection.merchant_id == merchant_id)
                      .order_by(DataConnection.source)).all()
    return [s.ConnectionOut(source=c.source, mode=c.mode, description=c.description, status=c.status,
                            consent_granted_at=c.consent_granted_at, last_sync_at=c.last_sync_at) for c in rows]


def dashboard(db: Session, merchant: Merchant, demo_mode: bool) -> s.DashboardOut:
    mid = merchant.id
    open_invoices = db.scalars(select(Invoice).where(
        Invoice.merchant_id == mid, Invoice.status.in_(UNPAID))).all()
    task_rows = tasks(db, mid)
    week = brief_service.last_week_sales(db, mid)
    today = today_ist()
    paid = db.scalars(select(Invoice.amount).where(Invoice.merchant_id == mid, Invoice.status == "PAID")).all()
    overdue = [i.amount for i in open_invoices if i.due_date < today]
    pending = [i.amount for i in open_invoices if i.due_date >= today]
    return s.DashboardOut(
        merchant=merchant_out(merchant),
        outstanding_dues=m(sum((i.amount for i in open_invoices), Decimal("0"))),
        outstanding_count=len(open_invoices),
        low_stock_count=len(brief_service.low_stock(db, mid)),
        needs_approval=sum(1 for t in task_rows if t.group == "NEEDS_APPROVAL"),
        in_progress=sum(1 for t in task_rows if t.group == "IN_PROGRESS"),
        last_week_sales=m(week["revenue"]), last_week_margin=m(week["gross_margin"]),
        weekly_sales=[s.WeekSales(week_start=w["week_start"], revenue=m(w["revenue"]), packs=w["packs"])
                      for w in brief_service.weekly_sales(db, mid)],
        dues=s.DuesBreakdown(paid=m(sum(paid, Decimal("0"))), pending=m(sum(pending, Decimal("0"))),
                             overdue=m(sum(overdue, Decimal("0")))),
        brief=s.Brief(**brief_service.build(db, mid)), connections=connections(db, mid), demo_mode=demo_mode,
    )


def approvals(db: Session, merchant_id: uuid.UUID) -> list[s.ApprovalOut]:
    rows = db.scalars(select(Approval).where(Approval.merchant_id == merchant_id)
                      .order_by(Approval.created_at.desc())).all()
    return [approval_out(a) for a in rows]


def audit_page(db: Session, merchant_id: uuid.UUID, task_id: uuid.UUID | None, cursor: str | None, limit: int) -> s.Page:
    query = select(AuditEvent).where(AuditEvent.merchant_id == merchant_id)
    if task_id:
        query = query.where(AuditEvent.task_id == task_id)
    if cursor:
        query = query.where(AuditEvent.created_at < func.to_timestamp(float(cursor)))
    rows = db.scalars(query.order_by(AuditEvent.created_at.desc()).limit(limit + 1)).all()
    next_cursor = str(rows[limit - 1].created_at.timestamp()) if len(rows) > limit else None
    return s.Page(items=[audit_out(e) for e in rows[:limit]], next_cursor=next_cursor)
