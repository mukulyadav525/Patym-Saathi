"""Restock workflow (prd.txt §5.1): evidence -> plan -> approval -> order -> shortage -> replan ->
second approval -> order -> goods receipt. All numbers come from build_plan; the LLM never edits them."""

import uuid
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.adapters import supplier_sim
from app.config import get_settings
from app.errors import ApiError
from app.models import (
    Approval,
    Inventory,
    Order,
    OrderLine,
    Plan,
    Product,
    SalesEvent,
    SalesWeekly,
    Supplier,
    SupplierQuote,
    Task,
    utcnow,
)
from app.services import audit
from app.services.common import canonical_hash, move_order, move_task
from app.services.restock import (
    BudgetExceeded, ItemInput, PlanLine, PlanResult, QuoteInput, build_plan, festival_uplift, money,
)

OPEN_ORDER_STATES = ("ACCEPTED", "PARTIALLY_ACCEPTED")


# ---------- read tools (evidence) ----------

def sales_summary(db: Session, merchant_id: uuid.UUID) -> dict[str, dict]:
    # Cached on the session (one per request): screens call this several times and the DB may be far away.
    key = ("sales_summary", merchant_id)
    if key not in db.info:
        db.info[key] = _sales_summary(db, merchant_id)
    return db.info[key]


def _sales_summary(db: Session, merchant_id: uuid.UUID) -> dict[str, dict]:
    rows = db.scalars(
        select(SalesWeekly).where(SalesWeekly.merchant_id == merchant_id).order_by(SalesWeekly.week_start)
    ).all()
    out: dict[str, dict] = defaultdict(lambda: {"weeks": [], "source": "SAMPLE", "imported_at": None})
    for row in rows:
        entry = out[str(row.product_id)]
        entry["weeks"].append(row.packs_sold)
        entry["source"] = row.source
        entry["imported_at"] = row.imported_at
    return dict(out)


def inventory_snapshot(db: Session, merchant_id: uuid.UUID) -> list[tuple[Product, Inventory]]:
    return db.execute(
        select(Product, Inventory)
        .join(Inventory, Inventory.product_id == Product.id)
        .where(Product.merchant_id == merchant_id, Product.active.is_(True))
        .order_by(Product.sort_order)
    ).all()


def supplier_quotes(db: Session, merchant_id: uuid.UUID) -> list[tuple[SupplierQuote, Supplier]]:
    rows = db.execute(
        select(SupplierQuote, Supplier)
        .join(Supplier, Supplier.id == SupplierQuote.supplier_id)
        .join(Product, Product.id == SupplierQuote.product_id)
        .where(Product.merchant_id == merchant_id, Supplier.status == "ACTIVE")
    ).all()
    supplier_sim.refresh_quotes(db, [q for q, s in rows if s.connector_mode == "SIMULATED"])
    return rows


def inbound_packs(db: Session, merchant_id: uuid.UUID, exclude_task: uuid.UUID | None = None) -> dict[str, int]:
    query = (
        select(OrderLine.product_id, OrderLine.packs)
        .join(Order, Order.id == OrderLine.order_id)
        .where(Order.merchant_id == merchant_id, Order.status.in_(OPEN_ORDER_STATES), OrderLine.line_status == "ACCEPTED")
    )
    if exclude_task:
        query = query.where(Order.task_id != exclude_task)
    totals: dict[str, int] = defaultdict(int)
    for product_id, packs in db.execute(query).all():
        totals[str(product_id)] += packs
    return dict(totals)


def _inputs(db: Session, merchant_id: uuid.UUID, task_id: uuid.UUID | None) -> tuple[list[ItemInput], list[QuoteInput], dict]:
    sales = sales_summary(db, merchant_id)
    inbound = inbound_packs(db, merchant_id, exclude_task=task_id)
    items: list[ItemInput] = []
    evidence_items = []
    for product, inv in inventory_snapshot(db, merchant_id):
        pid = str(product.id)
        weeks = sales.get(pid, {}).get("weeks", [])
        items.append(ItemInput(pid, product.name, product.pack_label, product.pack_size, inv.usable_packs, weeks,
                               inbound.get(pid, 0)))
        evidence_items.append({
            "product_id": pid, "name": product.name, "stock": inv.usable_packs, "stock_source": inv.source,
            "stock_updated_at": inv.source_updated_at.isoformat(), "weekly_sales": weeks,
            "sales_source": sales.get(pid, {}).get("source", "MISSING"),
        })
    quotes = []
    evidence_quotes = []
    for quote, supplier in supplier_quotes(db, merchant_id):
        quotes.append(QuoteInput(str(quote.id), str(supplier.id), supplier.name, str(quote.product_id),
                                 quote.unit_price, quote.available_packs, quote.min_order_packs, quote.valid_until))
        evidence_quotes.append({
            "supplier": supplier.name, "mode": supplier.connector_mode, "product_id": str(quote.product_id),
            "unit_price": f"{quote.unit_price:.2f}", "available_packs": quote.available_packs,
            "fetched_at": quote.fetched_at.isoformat(), "valid_until": quote.valid_until.isoformat(),
        })
    missing = [e["name"] for e in evidence_items if not e["weekly_sales"]]
    evidence = {
        "items": evidence_items,
        "quotes": evidence_quotes,
        "sources": ["Sales: 4-week POS history (SAMPLE)", "Stock: inventory records (SAMPLE)",
                    "Prices: supplier quotes (SIMULATED)"],
        "missing": [f"No sales history for {name}" for name in missing],
    }
    return items, quotes, evidence


# ---------- plan ----------

def _line_dict(line: PlanLine) -> dict:
    return {
        "product_id": line.product_id, "name": line.name, "pack_label": line.pack_label,
        "sold_per_week": f"{line.sold_per_week}", "stock": line.stock, "forecast": line.forecast,
        "packs": line.packs, "supplier_id": line.supplier_id, "supplier_name": line.supplier_name,
        "quote_id": line.quote_id, "unit_price": f"{line.unit_price:.2f}", "line_total": f"{line.line_total:.2f}",
        "status": line.status, "uplift": f"{line.uplift}" if line.uplift is not None else None,
    }


def festival_uplifts(db: Session, merchant_id: uuid.UUID, code: str) -> tuple[dict[str, Decimal], list[dict], str | None]:
    """Per-item uplift from the merchant's own past festival week. Returns (uplifts, evidence, festival name)."""
    rows = db.execute(select(SalesEvent, Product).join(Product, Product.id == SalesEvent.product_id)
                      .where(SalesEvent.merchant_id == merchant_id, SalesEvent.event_code == code)).all()
    uplifts, evidence, name = {}, [], None
    for event, product in rows:
        u = festival_uplift(event.event_week_packs, event.baseline_weekly_packs)
        uplifts[str(product.id)] = u
        name = event.event_name
        evidence.append({"product_id": str(product.id), "name": product.name, "event_date": event.event_date.isoformat(),
                         "event_week_packs": event.event_week_packs, "baseline_weekly": f"{event.baseline_weekly_packs}",
                         "uplift": f"{u}", "source": event.source})
    return uplifts, evidence, name


def approval_payload(task: Task, plan: Plan) -> dict:
    """The exact thing the merchant approves. Hash binds all of it."""
    lines = plan.payload["lines"]
    return {
        "merchant_id": str(task.merchant_id),
        "task_id": str(task.id),
        "plan_id": str(plan.id),
        "plan_version": plan.version,
        "action_type": "SUPPLIER_ORDER",
        "suppliers": sorted({line["supplier_name"] for line in lines}),
        "lines": [
            {k: line[k] for k in ("product_id", "name", "packs", "supplier_id", "unit_price", "line_total", "status")}
            for line in lines
        ],
        "currency": "INR",
        "total": f"{plan.total:.2f}",
        "committed_total": f"{plan.committed_total:.2f}",
        "budget": f"{plan.budget:.2f}",
    }


def draft_plan(
    db: Session, task: Task, actor: str, budget: Decimal, reason: str,
    committed: list[PlanLine] | None = None, resource_only: dict[str, int] | None = None,
    diff: list[dict] | None = None,
) -> Plan:
    settings = get_settings()
    items, quotes, evidence = _inputs(db, task.merchant_id, task.id)
    horizon = int(task.parsed_intent.get("horizon_days", 7))
    uplifts, festival_name = None, None
    if task.parsed_intent.get("festival"):
        uplifts, festival_evidence, festival_name = festival_uplifts(db, task.merchant_id, task.parsed_intent["festival"])
        evidence["festival"] = festival_evidence
        evidence["sources"].append(f"Festival demand: last {festival_name} week vs the weeks before it (SAMPLE)")
        if not uplifts:
            evidence["missing"].append("No past festival sales found; using normal weekly demand")
    try:
        result: PlanResult = build_plan(
            items, quotes, budget, utcnow(), horizon_days=horizon, safety_packs=settings.restock_safety_packs,
            committed=committed, resource_only=resource_only, uplift=uplifts or None, festival_name=festival_name,
        )
    except BudgetExceeded as exc:
        raise ApiError(422, "BUDGET_EXCEEDED", str(exc), {"total": f"{exc.total:.2f}", "budget": f"{exc.budget:.2f}"})

    previous = db.scalars(select(Plan).where(Plan.task_id == task.id).order_by(Plan.version.desc())).first()
    version = (previous.version + 1) if previous else 1
    for old in db.scalars(select(Plan).where(Plan.task_id == task.id, Plan.status == "ACTIVE")):
        old.status = "SUPERSEDED"
    for pending in db.scalars(select(Approval).where(Approval.task_id == task.id, Approval.status == "PENDING")):
        pending.status = "SUPERSEDED"
        audit.record(db, task.merchant_id, "saathi", "APPROVAL_SUPERSEDED", "approval", pending.id,
                     "Earlier approval invalidated because the plan changed", task_id=task.id)

    payload = {
        "lines": [_line_dict(line) for line in result.lines],
        "total_packs": result.total_packs,
        "unfillable": result.unfillable,
        "assumptions": result.assumptions,
        "evidence": evidence,
        "diff": diff or [],
        "horizon_days": horizon,
        "festival": festival_name,
    }
    plan = Plan(task_id=task.id, version=version, budget=result.budget, total=result.total,
                committed_total=result.committed_total, payload=payload, payload_hash="", status="ACTIVE",
                reason=reason)
    db.add(plan)
    db.flush()
    plan.payload_hash = canonical_hash(approval_payload(task, plan))
    audit.record(db, task.merchant_id, actor, "PLAN_DRAFTED", "plan", plan.id,
                 f"Plan v{version}: {result.total_packs} packs, ₹{result.total:,.2f} of ₹{result.budget:,.2f} budget",
                 task_id=task.id, details={"version": version, "total": f"{result.total:.2f}", "reason": reason})
    return plan


def request_approval(db: Session, task: Task, plan: Plan) -> Approval:
    payload = approval_payload(task, plan)
    approval = Approval(
        merchant_id=task.merchant_id, task_id=task.id, plan_id=plan.id, action_type="SUPPLIER_ORDER",
        payload_hash=canonical_hash(payload), payload_snapshot=payload, amount=plan.total,
        expires_at=utcnow() + timedelta(minutes=get_settings().approval_ttl_minutes), status="PENDING",
    )
    db.add(approval)
    db.flush()
    audit.record(db, task.merchant_id, "saathi", "APPROVAL_REQUESTED", "approval", approval.id,
                 f"Approval needed for ₹{plan.total:,.2f} (plan v{plan.version})", task_id=task.id,
                 details={"amount": f"{plan.total:.2f}", "plan_version": plan.version})
    return approval


def start_restock(db: Session, task: Task, actor: str, budget: Decimal) -> Plan:
    move_task(db, task, "UNDERSTANDING", "saathi", f"Understood: restock within ₹{budget:,.2f}")
    move_task(db, task, "EVIDENCE_READY", "saathi", "Loaded sales, stock and supplier quotes")
    plan = draft_plan(db, task, actor, budget, "Initial plan")
    move_task(db, task, "PLAN_DRAFTED", "saathi", f"Drafted plan v{plan.version}")
    request_approval(db, task, plan)
    move_task(db, task, "AWAITING_APPROVAL", "saathi", "Waiting for merchant approval")
    return plan


def recompute_hash(db: Session, approval: Approval) -> str:
    plan = db.get(Plan, approval.plan_id)
    task = db.get(Task, approval.task_id)
    if plan is None or plan.status != "ACTIVE":
        raise ApiError(409, "APPROVAL_SUPERSEDED", "The plan changed; please review the new plan")
    return canonical_hash(approval_payload(task, plan))


# ---------- execution (only reachable with a consumed approval) ----------

def _committed_lines(db: Session, task: Task) -> list[PlanLine]:
    rows = db.execute(
        select(OrderLine, Order, Product, Supplier)
        .join(Order, Order.id == OrderLine.order_id)
        .join(Product, Product.id == OrderLine.product_id)
        .join(Supplier, Supplier.id == Order.supplier_id)
        .where(Order.task_id == task.id, OrderLine.line_status == "ACCEPTED")
    ).all()
    committed = []
    for line, order, product, supplier in rows:
        committed.append(PlanLine(
            product_id=str(product.id), name=product.name, pack_label=product.pack_label,
            sold_per_week=Decimal("0"), stock=0, forecast=0, packs=line.packs, supplier_id=str(supplier.id),
            supplier_name=supplier.name, quote_id=str(line.quote_id), unit_price=money(line.unit_price),
            line_total=money(line.line_total), status="COMMITTED",
        ))
    return committed


def committed_spend(db: Session, task_id: uuid.UUID) -> Decimal:
    total = Decimal("0")
    for order in db.scalars(select(Order).where(Order.task_id == task_id)):
        if order.status in ("SUBMITTED", "ACCEPTED", "PARTIALLY_ACCEPTED", "GOODS_RECEIVED"):
            total += order.total
    return money(total)


def execute_order(db: Session, task: Task, approval: Approval, actor: str) -> dict:
    plan = db.get(Plan, approval.plan_id)
    now = utcnow()
    new_lines = [line for line in plan.payload["lines"] if line["status"] == "NEW"]
    new_total = money(sum((Decimal(line["line_total"]) for line in new_lines), Decimal("0")))
    if committed_spend(db, task.id) + new_total > plan.budget:
        raise ApiError(422, "BUDGET_EXCEEDED", "Committed spend would exceed the approved budget")
    for line in new_lines:
        quote = db.get(SupplierQuote, uuid.UUID(line["quote_id"]))
        if quote is None or quote.valid_until <= now or money(quote.unit_price) != Decimal(line["unit_price"]):
            raise ApiError(409, "QUOTE_CHANGED", f"Quote for {line['name']} changed; re-plan needed")

    move_task(db, task, "APPROVED", actor, f"Merchant approved ₹{plan.total:,.2f} (plan v{plan.version})")
    move_task(db, task, "EXECUTING", "saathi", "Placing supplier orders")

    by_supplier: dict[str, list[dict]] = defaultdict(list)
    for line in new_lines:
        by_supplier[line["supplier_id"]].append(line)

    unavailable: dict[str, int] = {}
    shortage_notes = []
    for supplier_id, lines in sorted(by_supplier.items(), key=lambda kv: kv[1][0]["supplier_name"]):
        supplier = db.get(Supplier, uuid.UUID(supplier_id))
        count = db.scalar(select(func.count(Order.id)).where(Order.merchant_id == task.merchant_id))
        order = Order(
            merchant_id=task.merchant_id, task_id=task.id, plan_id=plan.id, supplier_id=supplier.id,
            reference=f"PO-{7801 + count}", status="APPROVED",
            total=money(sum((Decimal(line["line_total"]) for line in lines), Decimal("0"))),
            idempotency_key=f"{approval.id}:{supplier.code}", connector_mode=supplier.connector_mode,
        )
        db.add(order)
        db.flush()
        order_lines = []
        for line in lines:
            ol = OrderLine(order_id=order.id, product_id=uuid.UUID(line["product_id"]), packs=line["packs"],
                           unit_price=Decimal(line["unit_price"]), line_total=Decimal(line["line_total"]),
                           quote_id=uuid.UUID(line["quote_id"]))
            db.add(ol)
            order_lines.append(ol)
        db.flush()
        audit.record(db, task.merchant_id, "saathi", "ORDER_CREATED", "order", order.id,
                     f"{order.reference} to {supplier.name}: ₹{order.total:,.2f} ({supplier.connector_mode})",
                     task_id=task.id, details={"tool": "create_supplier_order", "approval_id": str(approval.id)})
        move_order(db, order, "SUBMITTED", "saathi", f"{order.reference} submitted to {supplier.name} (SIMULATED)")

        results = supplier_sim.submit(db, supplier, order_lines)
        accepted_total = Decimal("0")
        for ol, res in zip(order_lines, results):
            ol.line_status = res.status
            if res.status == "ACCEPTED":
                accepted_total += ol.line_total
            else:
                unavailable[str(ol.product_id)] = unavailable.get(str(ol.product_id), 0) + ol.packs
                shortage_notes.append(res.reason)
        order.total = money(accepted_total)
        if accepted_total == 0:
            move_order(db, order, "FAILED", "supplier", f"{supplier.name} could not fulfil {order.reference}")
        elif any(r.status != "ACCEPTED" for r in results):
            move_order(db, order, "PARTIALLY_ACCEPTED", "supplier",
                       f"{supplier.name} accepted ₹{accepted_total:,.2f}; " + "; ".join(r.reason for r in results if r.reason))
        else:
            move_order(db, order, "ACCEPTED", "supplier", f"{supplier.name} accepted {order.reference}")

    if not unavailable:
        move_task(db, task, "VERIFYING", "saathi", "Orders accepted (SIMULATED); waiting for goods receipt")
        return {"shortage": False}

    move_task(db, task, "EXCEPTION", "supplier", "Shortage: " + "; ".join(shortage_notes))
    return replan_after_shortage(db, task, plan, unavailable)


def replan_after_shortage(db: Session, task: Task, old_plan: Plan, unavailable: dict[str, int]) -> dict:
    committed = _committed_lines(db, task)
    old_lines = {line["product_id"]: line for line in old_plan.payload["lines"]}
    try:
        plan = draft_plan(db, task, "saathi", old_plan.budget, "Shortage re-plan", committed=committed,
                          resource_only=unavailable)
    except ApiError as exc:
        task.result_note = f"Could not re-source within budget: {exc.message}"
        move_task(db, task, "VERIFYING", "saathi", task.result_note)
        return {"shortage": True, "replanned": False}

    diff = []
    for line in plan.payload["lines"]:
        if line["status"] == "NEW":
            before = old_lines.get(line["product_id"])
            delta = Decimal(line["line_total"]) - (Decimal(before["line_total"]) if before else Decimal("0"))
            diff.append({
                "name": line["name"], "packs": line["packs"],
                "from_supplier": before["supplier_name"] if before else None,
                "from_unit_price": before["unit_price"] if before else None,
                "to_supplier": line["supplier_name"], "to_unit_price": line["unit_price"],
                "delta": f"{delta:.2f}",
            })
    plan.payload = {**plan.payload, "diff": diff}
    plan.payload_hash = canonical_hash(approval_payload(task, plan))
    move_task(db, task, "PLAN_DRAFTED", "saathi",
              f"Re-planned: new total ₹{plan.total:,.2f} (₹{old_plan.total:,.2f} before)")
    request_approval(db, task, plan)
    move_task(db, task, "AWAITING_APPROVAL", "saathi", "Second approval needed for the changed order")
    return {"shortage": True, "replanned": True, "plan_id": str(plan.id)}


def reject(db: Session, task: Task, approval: Approval, actor: str) -> None:
    plan = db.get(Plan, approval.plan_id)
    plan.status = "REJECTED"
    if committed_spend(db, task.id) > 0:
        task.result_note = f"Revised plan rejected; continuing with ₹{committed_spend(db, task.id):,.2f} already ordered"
        move_task(db, task, "VERIFYING", actor, task.result_note)
    else:
        move_task(db, task, "CANCELLED", actor, "Merchant rejected the plan")


def receive_goods(db: Session, order: Order, actor: str) -> int:
    if order.status not in OPEN_ORDER_STATES:
        raise ApiError(409, "INVALID_TRANSITION", f"{order.reference} is {order.status}, cannot receive goods")
    received = 0
    for line in db.scalars(select(OrderLine).where(OrderLine.order_id == order.id, OrderLine.line_status == "ACCEPTED")):
        inv = db.scalars(select(Inventory).where(Inventory.merchant_id == order.merchant_id,
                                                 Inventory.product_id == line.product_id).with_for_update()).one()
        inv.on_hand_packs += line.packs
        inv.source = "MANUAL"
        inv.source_updated_at = utcnow()
        inv.updated_at = utcnow()
        received += line.packs
    move_order(db, order, "GOODS_RECEIVED", actor, f"{order.reference}: {received} packs received (simulated delivery)",
               details={"packs": received})

    task = db.get(Task, order.task_id)
    open_orders = db.scalars(select(Order).where(Order.task_id == task.id, Order.status.in_(OPEN_ORDER_STATES))).all()
    pending_approval = db.scalars(select(Approval).where(Approval.task_id == task.id, Approval.status == "PENDING")).first()
    if task.state == "VERIFYING" and not open_orders and not pending_approval:
        spent = committed_spend(db, task.id)
        budget = db.scalars(select(Plan).where(Plan.task_id == task.id).order_by(Plan.version.desc())).first().budget
        partial = bool(task.result_note)
        note = f"Final spend ₹{spent:,.2f}: ₹{budget - spent:,.2f} under the ₹{budget:,.2f} limit"
        task.result_note = f"{task.result_note}. {note}" if partial else note
        move_task(db, task, "PARTIALLY_COMPLETED" if partial else "COMPLETED", "saathi", note)
    return received
