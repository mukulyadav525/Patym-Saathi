"use client";

import { ArrowLeft, ArrowLeftRight, CheckCircle2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Badge, Button, Card, ErrorBox, SimBadge, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, ApiError, newKey, plural, rupees, when, type S, type TaskDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { copyText } from "@/lib/share";

export default function TaskPage() {
  const { id } = useParams<{ id: string }>();
  const { session } = useAuth();
  const { data: task, setData, error, reload } = useLoad(() => api.task(id), [id], 8000);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNoticeState] = useState<{ ok: boolean; text: string } | null>(null);
  const setNotice = (text: string | null, ok = false) => setNoticeState(text ? { ok, text } : null);
  const demo = session?.demo_mode && session.user.role === "DEMO_ADMIN";

  const act = async (label: string, fn: () => Promise<TaskDetail | void>) => {
    setBusy(label);
    setNotice(null);
    try {
      const res = await fn();
      if (res) setData(res);
      else await reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
      await reload();
    } finally {
      setBusy(null);
    }
  };

  if (error && !task) return <ErrorBox error={error} onRetry={reload} />;
  if (!task) return <Skeleton rows={6} />;

  const plan = task.plans[task.plans.length - 1];
  const pending = task.approvals.find((a) => a.id === task.pending_approval_id);
  const openOrders = task.orders.some((o) => o.status === "ACCEPTED" || o.status === "PARTIALLY_ACCEPTED");
  const checks = [...task.events].reverse().find((e) => e.event_type === "STATUS_CHECKED")?.details?.checks as Record<string, boolean> | undefined;

  return (
    <>
      <Link href="/inbox" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-ink-soft hover:text-navy"><ArrowLeft className="size-4" /> Inbox</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2"><StateBadge state={task.state} /><span className="text-xs text-muted">{when(task.created_at)} · {task.input_channel.toLowerCase()}</span></div>
          <h1 className="text-2xl font-extrabold tracking-tight">{task.title}</h1>
          <p className="mt-1 text-sm italic text-ink-soft">“{task.input_text}”</p>
          {task.result_note && <p className={`mt-3 rounded-xl px-3 py-2 text-sm font-semibold ${task.state === "COMPLETED" ? "bg-green-soft text-green" : "bg-cyan-soft text-navy"}`}>{task.result_note}</p>}
        </div>
        {pending && (
          <Card className="w-full border border-[#FFE1A8] bg-[#FFFBF2] sm:w-auto">
            <p className="text-xs font-semibold text-ink-soft">Approve to {pending.action_type === "SUPPLIER_ORDER" ? "place order" : "send link"}</p>
            <p className="num text-3xl font-extrabold">{rupees(pending.amount)}</p>
            <div className="mt-3 flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
              <Button kind="danger" loading={busy === "reject"} onClick={() => act("reject", () => api.reject(pending.id))}>Reject</Button>
              <Button onClick={() => setConfirming(true)}><ShieldCheck className="size-4" /> Review & approve</Button>
            </div>
          </Card>
        )}
      </div>
      {notice && <p className={`mb-4 rounded-xl p-3 text-sm ${notice.ok ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>{notice.text}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {plan && (
            <>
              {plan.diff.length > 0 && (
                <Card className="border border-[#FFD48A] bg-amber-soft">
                  <p className="flex items-center gap-2 font-extrabold text-amber"><ArrowLeftRight className="size-4" /> {pending ? "Plan changed — needs approval again" : "Plan changed after a supplier shortage"}</p>
                  {plan.diff.map((d) => (
                    <p key={d.name} className="mt-1 text-sm">
                      {d.name} × {d.packs}: {d.from_supplier} {rupees(d.from_unit_price)} is out of stock, now from {d.to_supplier} {rupees(d.to_unit_price)} <b className="text-red">(+{rupees(d.delta)})</b>
                    </p>
                  ))}
                </Card>
              )}
              <Card>
                <div className="flex items-center justify-between">
                  <h2 className="font-extrabold">Plan v{plan.version}</h2>
                  <Badge tone={plan.status === "ACTIVE" ? "cyan" : "muted"}>{plan.status}</Badge>
                </div>
                <p className="num mt-2 text-3xl font-extrabold">{rupees(plan.total)} <span className="text-sm font-medium text-muted">of {rupees(plan.budget)} · {rupees(plan.remaining_budget)} left</span></p>
                <div className="relative mt-3 h-2 overflow-hidden rounded bg-line">
                  <div className="absolute inset-y-0 left-0 bg-cyan" style={{ width: `${(Number(plan.total) / Number(plan.budget)) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 bg-navy" style={{ width: `${(Number(plan.committed_total) / Number(plan.budget)) * 100}%` }} />
                </div>
                {plan.purchase && <PurchaseChange p={plan.purchase} />}
                <ul className="num mt-4 divide-y divide-line text-sm sm:hidden">
                  {plan.lines.map((l) => (
                    <li key={`${l.product_id}-${l.supplier_name}`} className="flex items-start justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p><b>{l.name}</b> <span className="text-xs text-muted">{l.pack_label}{l.brand && ` · ${l.brand}`}</span> {l.status === "COMMITTED" && <Badge tone="navy">ordered</Badge>}</p>
                        <p className="text-xs text-muted">{l.packs} × {rupees(l.unit_price)} · {l.supplier_name}{l.status !== "COMMITTED" && ` · ${l.stock} in stock, ${Number(l.sold_per_week).toFixed(0)}/wk`}</p>
                      </div>
                      <span className="shrink-0 font-bold">{rupees(l.line_total)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between py-2.5 font-extrabold"><span>{plan.total_packs} packs</span><span>{rupees(plan.total)}</span></li>
                </ul>
                <div className="mt-4 hidden overflow-x-auto sm:block">
                  <table className="num w-full min-w-[560px] text-sm">
                    <thead className="text-left text-xs text-muted">
                      <tr className="border-b border-line">
                        <th className="py-2">Item</th><th className="text-center">Sold/wk</th><th className="text-center">Stock</th><th className="text-center">Order</th><th>Supplier</th><th className="text-right">Unit ₹</th><th className="text-right">Total ₹</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.lines.map((l) => (
                        <tr key={`${l.product_id}-${l.supplier_name}`} className="border-b border-[#F1F4F8]">
                          <td className="py-2.5"><b>{l.name}</b> <span className="text-xs text-muted">{l.pack_label}{l.brand && ` · ${l.brand}`}</span> {l.status === "COMMITTED" && <Badge tone="navy">ordered</Badge>}</td>
                          <td className="text-center">{l.status === "COMMITTED" ? "–" : Number(l.sold_per_week).toFixed(0)}</td>
                          <td className="text-center">{l.status === "COMMITTED" ? "–" : l.stock}</td>
                          <td className="text-center font-extrabold">{l.packs}</td>
                          <td className="text-xs">{l.supplier_name}</td>
                          <td className="text-right">{rupees(l.unit_price)}</td>
                          <td className="text-right font-bold">{rupees(l.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td className="py-2 font-extrabold">{plan.total_packs} packs</td><td colSpan={5} /><td className="text-right text-base font-extrabold">{rupees(plan.total)}</td></tr></tfoot>
                  </table>
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-bold text-[#0083AD]">Evidence & assumptions</summary>
                  <ul className="mt-2 space-y-1 rounded-xl bg-bg p-3 text-xs">
                    {plan.sources.map((x) => <li key={x}>• {x}</li>)}
                    {plan.assumptions.map((x) => <li key={x} className="text-ink-soft">• {x}</li>)}
                    {plan.missing.map((x) => <li key={x} className="text-red">• Missing: {x}</li>)}
                  </ul>
                </details>
                {task.plans.length > 1 && (
                  <p className="mt-3 text-xs text-muted">Earlier: {task.plans.slice(0, -1).map((p) => `v${p.version} ${rupees(p.total)} (${p.status.toLowerCase()})`).join(" · ")}</p>
                )}
              </Card>
            </>
          )}

          {task.invoice && (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-extrabold">{task.invoice.customer_name} · {task.invoice.invoice_number}</h2>
                <StateBadge state={task.invoice.status} />
              </div>
              <p className="num mt-2 text-3xl font-extrabold">{rupees(task.invoice.amount)}</p>
              <p className={`text-sm ${task.invoice.days_overdue > 0 ? "font-semibold text-red" : "text-muted"}`}>
                {task.invoice.status === "PAID" ? "Paid" : task.invoice.days_overdue > 0 ? `${plural(task.invoice.days_overdue, "day")} overdue` : `Due ${task.invoice.due_date}`}
              </p>
              {task.invoice.draft_message && <p className="mt-3 rounded-xl bg-bg p-3 text-sm"><span className="block text-xs text-muted">Message to customer</span>{task.invoice.draft_message}</p>}
              {task.invoice.link_url && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <SimBadge>{task.invoice.link_mode}</SimBadge>
                  <code className="min-w-0 max-w-full flex-1 truncate rounded bg-bg px-2 py-1 text-xs">{task.invoice.link_url}</code>
                  <Button kind="secondary" onClick={() => void copyText(`${task.invoice!.draft_message ?? ""}\n${task.invoice!.link_url}`.trim()).then((ok) => setNotice(ok ? "Message and link copied." : "Couldn't copy. Select the link and copy it manually.", ok))}>Copy</Button>
                </div>
              )}
              {checks && (
                <div className={`mt-4 rounded-xl p-3 ${task.invoice.status === "PAID" ? "bg-green-soft" : "bg-red-soft"}`}>
                  <p className={`font-bold ${task.invoice.status === "PAID" ? "text-green" : "text-red"}`}>{task.invoice.status === "PAID" ? "Payment verified" : "Payment did not match — not marked paid"}</p>
                  <p className="mb-1 text-xs text-ink-soft">Signed webhook + server-side status check</p>
                  {Object.entries({ mid: "Merchant ID", order_id: "Order ID", amount: "Amount", status: "Status = success" }).map(([k, label]) => (
                    <p key={k} className="flex items-center gap-2 text-sm">{checks[k] ? <CheckCircle2 className="size-4 text-green" /> : <XCircle className="size-4 text-red" />} {label}</p>
                  ))}
                </div>
              )}
              {(task.invoice.status === "SENT" || task.invoice.status === "RECONCILIATION_REQUIRED") && (
                <div className="mt-4 rounded-xl border border-line p-3">
                  <p className="font-bold">{task.invoice.status === "SENT" ? "Waiting for the customer" : "Payment needs checking"}</p>
                  <p className="mb-2 text-xs text-muted">
                    {task.invoice.status === "SENT"
                      ? "Marked paid only after Paytm confirms it. Customer says they paid? Check again."
                      : "The payment did not match this invoice. Check again, or mark it not received to collect it again."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button kind="secondary" loading={busy === "recheck"}
                      onClick={() => act("recheck", async () => { const r = await api.recheckPayment(task.invoice!.id); setNotice(r.message, r.ok); })}>Check again</Button>
                    {task.invoice.status === "SENT" ? (
                      <Button kind="danger" loading={busy === "withdraw"} onClick={() => {
                        if (confirm("Withdraw this link? You can create a new one after.")) void act("withdraw", async () => { setNotice((await api.withdrawLink(task.invoice!.id)).message, true); });
                      }}>Withdraw link</Button>
                    ) : (
                      <Button kind="danger" loading={busy === "notrec"} onClick={() => {
                        if (confirm("Mark as not received? The invoice becomes collectable again.")) void act("notrec", async () => { setNotice((await api.notReceived(task.invoice!.id)).message, true); });
                      }}>Not received</Button>
                    )}
                  </div>
                </div>
              )}
              {demo && task.invoice.status === "SENT" && (
                <div className="mt-4 rounded-xl border border-dashed border-violet p-3">
                  <SimBadge>DEMO CONTROL</SimBadge>
                  <p className="my-2 text-xs text-muted">Sends a signed DEMO webhook through the real verification path.</p>
                  <Button kind="secondary" loading={busy === "pay"} onClick={() => act("pay", async () => { const r = await api.demoPayment(task.invoice!.id); setNotice(r.ok ? null : r.message); })}>
                    Simulate customer UPI payment
                  </Button>
                </div>
              )}
            </Card>
          )}

          {task.orders.length > 0 && (
            <Card>
              <h2 className="mb-3 font-extrabold">Supplier orders</h2>
              <div className="space-y-3">
                {task.orders.map((o) => (
                  <div key={o.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold">{o.supplier_name} <span className="text-xs font-normal text-muted">{o.reference}</span></p>
                      <div className="flex gap-2"><SimBadge /><StateBadge state={o.status} /></div>
                    </div>
                    <ul className="num mt-2 text-sm">
                      {o.lines.map((l) => (
                        <li key={l.product_id} className="flex justify-between py-0.5">
                          <span className={l.line_status === "UNAVAILABLE" ? "text-muted line-through" : ""}>{l.name} × {l.packs}</span>
                          {l.line_status === "UNAVAILABLE" ? <Badge tone="red">Out of stock</Badge> : <span>{rupees(l.line_total)}</span>}
                        </li>
                      ))}
                    </ul>
                    <p className="num mt-2 flex justify-between border-t border-line pt-2 text-sm font-extrabold"><span>Accepted</span><span>{rupees(o.total)}</span></p>
                  </div>
                ))}
              </div>
              {demo && openOrders && !pending && (
                <div className="mt-4 rounded-xl border border-dashed border-violet p-3">
                  <SimBadge>DEMO CONTROL</SimBadge>
                  <p className="my-2 text-xs text-muted">Orders are placed, not delivered. Inventory changes only on goods receipt.</p>
                  <Button kind="secondary" loading={busy === "deliver"} onClick={() => act("deliver", () => api.demoDelivery(task.id))}>Simulate delivery (goods received)</Button>
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-extrabold">Approval history</h2>
            {task.approvals.length === 0 && <p className="text-sm text-muted">No approvals yet.</p>}
            <ul className="space-y-3">
              {task.approvals.map((a) => (
                <li key={a.id} className="text-sm">
                  <div className="flex items-center justify-between"><b className="num">{rupees(a.amount)}</b><StateBadge state={a.status} /></div>
                  <p className="text-xs text-ink-soft">{a.summary}</p>
                  <p className="text-[11px] text-muted">{a.approved_at ? `Approved ${when(a.approved_at)}` : `Created ${when(a.created_at)}`} · hash {a.payload_hash_short}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <h2 className="mb-3 font-extrabold">Audit trail</h2>
            {task.time_to_plan_seconds != null && <p className="mb-3 text-xs text-muted">Plan ready {task.time_to_plan_seconds < 1 ? "in under a second" : `${task.time_to_plan_seconds.toFixed(1)}s after the request`}</p>}
            <ol className="relative space-y-3 border-l-2 border-line pl-4">
              {task.events.map((e) => {
                const exception = (e.details as { to?: string })?.to === "EXCEPTION";
                return (
                  <li key={e.id} className="text-sm">
                    <span className={`absolute -left-[5px] mt-1.5 size-2 rounded-full ${exception ? "bg-red" : e.event_type === "TASK_STATE" ? "bg-line" : "bg-cyan"}`} />
                    <p className={exception ? "font-bold text-red" : e.event_type === "TASK_STATE" ? "text-ink-soft" : "font-semibold"}>{e.summary}</p>
                    <p className="text-[11px] text-muted">{when(e.created_at)} · {e.actor.length > 20 ? "merchant" : e.actor}</p>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>

      {pending && confirming && (
        <ConfirmDialog task={task} onClose={() => setConfirming(false)} onRenewed={setData}
          onDone={(t) => { setConfirming(false); setData(t); }} onError={(m) => { setConfirming(false); setNotice(m); void reload(); }} />
      )}
    </>
  );
}

function ConfirmDialog({ task, onClose, onDone, onError, onRenewed }: {
  task: TaskDetail; onClose: () => void; onDone: (t: TaskDetail) => void; onError: (m: string) => void;
  onRenewed: (t: TaskDetail) => void;
}) {
  const pending = task.approvals.find((a) => a.id === task.pending_approval_id)!;
  const plan = task.plans[task.plans.length - 1];
  const key = useRef(newKey()); // reused if this exact approval is retried, so it can't double-order
  const { session } = useAuth();
  const needsPin = !!session?.user.has_approval_pin;
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.floor((new Date(pending.expires_at).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [pending.expires_at]);

  const renew = async () => {
    setBusy(true);
    try {
      onRenewed(await api.renewApproval(task.id));
    } catch (e) {
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    setBusy(true);
    try {
      onDone(await api.confirm(pending.id, key.current, needsPin ? pin : undefined));
    } catch (e) {
      if (e instanceof ApiError && (e.code === "PIN_INVALID" || e.code === "PIN_REQUIRED")) {
        setPin("");
        setPinError(e.message);
        return;
      }
      if (e instanceof ApiError && e.code === "QUOTE_CHANGED") {
        // Supplier prices moved since the plan was made: load a fresh plan for the merchant to review.
        try {
          onRenewed(await api.renewApproval(task.id));
          onError("Supplier prices changed since this plan was made. Review the updated plan, then approve.");
        } catch (e2) {
          onError(e2 instanceof ApiError ? e2.message : String(e2));
        }
        return;
      }
      onError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/45 p-4 sm:items-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-extrabold">Confirm approval</h2>
        <p className="text-sm text-muted">Saathi acts only on exactly this.</p>
        <div className="num my-4 space-y-1 rounded-xl bg-bg p-4 text-sm">
          {pending.action_type === "SUPPLIER_ORDER" && plan ? (
            <>
              <p className="flex justify-between font-bold"><span>{plan.version > 1 ? "Revised total" : "Total"}</span><span>{rupees(plan.total)}</span></p>
              {Number(plan.committed_total) > 0 && <p className="flex justify-between text-muted"><span>Already ordered</span><span>{rupees(plan.committed_total)}</span></p>}
              <p className="flex justify-between"><span className="text-muted">New order now</span><span className="font-bold">{rupees(Number(plan.total) - Number(plan.committed_total))} · {Array.from(new Set(plan.lines.filter((l) => l.status === "NEW").map((l) => l.supplier_name))).join(" + ")}</span></p>
              <p className="flex justify-between text-muted"><span>Budget</span><span>{rupees(plan.budget)}</span></p>
            </>
          ) : (
            <p className="flex justify-between font-bold"><span>Payment link to {task.invoice?.customer_name}</span><span>{rupees(pending.amount)}</span></p>
          )}
        </div>
        <div className="mb-4 flex gap-2">
          <SimBadge>{pending.action_type === "SUPPLIER_ORDER" ? "SIMULATED SUPPLIER" : "DEMO PAYMENT LINK"}</SimBadge>
          <Badge tone={left > 60 ? "muted" : "red"}>{left > 0 ? `Expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "Expired"}</Badge>
        </div>
        {needsPin && (
          <div className="mb-4">
            <label htmlFor="pin" className="text-xs font-bold text-ink-soft">Approval PIN</label>
            <input id="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(null); }}
              className="mt-1 h-11 w-full rounded-xl border border-line px-3 tracking-[0.5em] outline-cyan" />
            {pinError && <p className="mt-1 text-xs font-semibold text-red">{pinError}</p>}
          </div>
        )}
        {left === 0 ? (
          <Button className="w-full" loading={busy} onClick={renew}><RefreshCw className="size-4" /> Approval window expired · Renew</Button>
        ) : (
          <Button className="w-full" loading={busy} disabled={needsPin && pin.length !== 4} onClick={approve}><CheckCircle2 className="size-4" /> Approve {rupees(pending.amount)}</Button>
        )}
        <Button kind="ghost" className="mt-2 w-full" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

// A purchase picked in Compare vendors: what changes for the item once its goods arrive (part of what is approved).
function PurchaseChange({ p }: { p: NonNullable<S["PlanOut"]["purchase"]> }) {
  const brand = p.brand !== p.from_brand;
  const price = Number(p.sell_price) !== Number(p.from_sell_price);
  if (!brand && !price) return null;
  return (
    <p className="mt-4 rounded-xl bg-cyan-soft px-3 py-2 text-sm text-navy">
      When the goods arrive:{brand && <> switches from <b>{p.from_brand || "current stock"}</b> to <b>{p.brand}</b></>}
      {brand && price && ";"}{price && <> selling price <b className="num">{rupees(p.from_sell_price)} → {rupees(p.sell_price)}</b></>}.
    </p>
  );
}
