"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button, Card, ErrorBox, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, ApiError, rupees, type S } from "@/lib/api";

const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function Cashflow() {
  const [pending, setPending] = useState(true);
  const { data, error, reload } = useLoad(() => api.cashflow(pending), [pending]);
  const settings = useLoad(api.businessSettings);

  const values = (data?.series ?? []).map((p) => Number(p.balance));
  const max = Math.max(...values.map(Math.abs), 1);
  const shortfall = data ? Number(data.shortfall) : 0;

  return (
    <>
      <PageTitle title="Cash flow forecast" sub="Next 14 days from your sales, purchases, dues and expenses. An estimate to plan with, not a bank balance." />
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className={`card flex items-center gap-3 border p-5 ${shortfall > 0 ? "border-[#F3C5C5] bg-red-soft" : "border-[#BFE6CC] bg-green-soft"}`}>
              {shortfall > 0 ? <AlertTriangle className="size-6 text-red" /> : <CheckCircle2 className="size-6 text-green" />}
              <div className="flex-1">
                <p className="font-extrabold">{shortfall > 0 ? `You may be short ${rupees(data.shortfall)} by ${short(data.first_negative_on!)}` : `Cash looks fine for ${data.days} days`}</p>
                <p className="text-sm text-ink-soft">Lowest point {rupees(data.lowest_balance)} on {short(data.lowest_on)}</p>
              </div>
              {shortfall > 0 && <Link href="/payments" className="text-sm font-bold text-[#0083AD]">Collect dues →</Link>}
            </div>
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-extrabold">Projected balance</h2>
                <label className="flex items-center gap-2 text-sm text-ink-soft">
                  <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} className="size-4 accent-cyan" />
                  Include plan awaiting approval
                </label>
              </div>
              <div className="flex h-56 items-stretch gap-1" role="img" aria-label="Projected daily balance">
                {data.series.map((p, i) => {
                  const v = values[i];
                  return (
                    <div key={p.date} className="flex flex-1 flex-col" title={`${short(p.date)}: ${rupees(p.balance)}`}>
                      <div className="flex flex-1 items-end">{v >= 0 && <div className={`w-full rounded-t ${i === 0 ? "bg-navy" : "bg-cyan"}`} style={{ height: `${(v / max) * 100}%` }} />}</div>
                      <div className="h-px bg-line" />
                      <div className="flex-1">{v < 0 && <div className="w-full rounded-b bg-red" style={{ height: `${(-v / max) * 100}%` }} />}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted"><span>Today</span><span>{short(data.series[data.series.length - 1].date)}</span></div>
            </Card>
            <Card>
              <h2 className="mb-2 font-extrabold">Known money in and out</h2>
              {data.series.flatMap((p) => p.events.map((e, i) => (
                <p key={`${p.date}-${i}`} className="num flex justify-between border-t border-line py-2 text-sm first:border-0">
                  <span><span className="mr-3 text-muted">{short(p.date)}</span>{e.label}</span>
                  <span className={`font-bold ${Number(e.amount) < 0 ? "text-red" : "text-green"}`}>{Number(e.amount) < 0 ? "" : "+"}{rupees(e.amount)}</span>
                </p>
              )))}
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <div className="num grid grid-cols-3 gap-2 text-center text-sm">
                <div><p className="text-xs text-muted">Cash today</p><p className="font-extrabold">{rupees(data.opening)}</p></div>
                <div><p className="text-xs text-muted">Sales/day</p><p className="font-extrabold text-green">{rupees(data.daily_sales)}</p></div>
                <div><p className="text-xs text-muted">Buying/day</p><p className="font-extrabold text-amber">{rupees(data.daily_purchases)}</p></div>
              </div>
            </Card>
            {settings.data && (
              <FiguresForm key={`${settings.data.cash_on_hand}|${settings.data.weekly_expenses}`} initial={settings.data}
                missing={data.missing} onSaved={() => { void settings.reload(); void reload(); }} />
            )}
            <div>{data.assumptions.map((a) => <p key={a} className="mb-1 text-xs text-muted">ⓘ {a}</p>)}</div>
          </div>
        </div>
      )}
    </>
  );
}

// Keyed on the saved values, so the inputs start from what the server has without copying state in an effect.
function FiguresForm({ initial, missing, onSaved }: {
  initial: S["BusinessSettingsOut"]; missing: string[]; onSaved: () => void;
}) {
  const whole = (v: string | null) => (v ? String(Math.round(Number(v))) : "");
  const [cash, setCash] = useState(whole(initial.cash_on_hand));
  const [expenses, setExpenses] = useState(whole(initial.weekly_expenses));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await api.saveBusinessSettings({ cash_on_hand: cash || undefined, weekly_expenses: expenses || undefined });
      onSaved();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="mb-3 font-extrabold">Your figures</h2>
      <label className="text-xs font-bold text-ink-soft" htmlFor="cash">Cash in hand today (₹)</label>
      <input id="cash" inputMode="numeric" value={cash} onChange={(e) => setCash(e.target.value.replace(/\D/g, "").slice(0, 8))}
        className="mt-1 mb-3 h-11 w-full rounded-xl border border-line px-3 outline-cyan" />
      <label className="text-xs font-bold text-ink-soft" htmlFor="exp">Weekly expenses: rent, salary, bills (₹)</label>
      <input id="exp" inputMode="numeric" value={expenses} onChange={(e) => setExpenses(e.target.value.replace(/\D/g, "").slice(0, 8))}
        className="mt-1 mb-4 h-11 w-full rounded-xl border border-line px-3 outline-cyan" />
      <Button className="w-full" loading={busy} onClick={() => void save()}>Update forecast</Button>
      {notice && <p className="mt-2 text-xs font-semibold text-red">{notice}</p>}
      {missing.map((m) => <p key={m} className="mt-2 text-xs text-amber">{m}</p>)}
    </Card>
  );
}
