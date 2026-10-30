"""Read-back of what the merchant is about to approve. Built from stored plan/invoice records only
(never from model output), so the spoken numbers are the ones the approval is bound to."""

from decimal import Decimal

from app import schemas as s


def _r(amount: str) -> str:
    return f"₹{Decimal(amount):,.0f}"


def text_for(task: s.TaskDetail, lang: str) -> str | None:
    if task.pending_approval_id is None:
        return None
    hi = lang.startswith("hi")
    if task.task_type == "RESTOCK" and task.plans:
        plan = task.plans[-1]
        items = ", ".join(f"{ln.name} {ln.packs} {'pack' if hi else 'packs'}" for ln in plan.lines)
        suppliers = ", ".join(sorted({ln.supplier_name for ln in plan.lines}))
        changes = "; ".join(
            f"{d.name} {d.packs} {'pack ab' if hi else 'packs now from'} {d.to_supplier} (+{_r(d.delta)})" for d in plan.diff)
        if hi:
            return (f"Kharid plan: {items}. Supplier: {suppliers}. "
                    + (f"Badlaav: {changes}. " if changes else "")
                    + f"Kul {_r(plan.total)}, budget {_r(plan.budget)}. Approve karne ke liye screen par button dabaiye.")
        return (f"Purchase plan: {items}. Supplier: {suppliers}. "
                + (f"Change: {changes}. " if changes else "")
                + f"Total {_r(plan.total)} against a budget of {_r(plan.budget)}. Tap approve on screen to go ahead.")
    if task.invoice is not None:
        inv = task.invoice
        if hi:
            return (f"{inv.customer_name} ko {_r(inv.amount)} ka payment link, invoice {inv.invoice_number}. "
                    f"Approve karne ke liye screen par button dabaiye.")
        return (f"Payment link for {_r(inv.amount)} to {inv.customer_name}, invoice {inv.invoice_number}. "
                f"Tap approve on screen to go ahead.")
    return None
