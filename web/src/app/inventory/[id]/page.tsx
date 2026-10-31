"use client";

import { ArrowLeft, Lightbulb, ShoppingCart, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, Button, Card, ErrorBox, Note, PageTitle, SimBadge, Skeleton, useLoad } from "@/components/ui";
import { api, ApiError, rupees, type S } from "@/lib/api";

type Offer = S["VendorOffer"];
const QUALITY: Record<string, { label: string; tone: "violet" | "cyan" | "amber" }> = {
  PREMIUM: { label: "Premium", tone: "violet" }, STANDARD: { label: "Standard", tone: "cyan" }, ECONOMY: { label: "Economy", tone: "amber" },
};
const paise = (v: string | null | undefined) => rupees(v, v && Number(v) % 1 ? 2 : 0);

/** Every brand and quality the suppliers offer for one item, ranked by profit; buying one waits for approval. */
export default function CompareVendors() {
  const { id } = useParams<{ id: string }>();
  const { data, error, reload } = useLoad(() => api.sourcing(id), [id]);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <>
      <Link href="/inventory" className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-[#0083AD]"><ArrowLeft className="size-4" /> Inventory</Link>
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton stats /> : (
        <>
          <PageTitle title={`${data.name} · compare vendors`} sub={`${data.pack_label}${data.brand ? ` · you stock ${data.brand}` : ""}`} />
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[
              ["In stock", `${data.stock} packs`], ["Sells", `~${Number(data.avg_weekly).toFixed(0)} / week`],
              ["Your cost price", `${paise(data.cost_price)}${data.cost_estimated ? " *" : ""}`], ["Your selling price", rupees(data.sell_price)],
              ["Profit / pack now", paise(data.profit_per_pack)],
            ].map(([label, value]) => (
              <Card key={label} className="p-4!">
                <p className="text-xs font-semibold text-ink-soft">{label}</p>
                <p className="num mt-1 text-xl font-extrabold">{value}</p>
              </Card>
            ))}
          </div>
          {data.cost_estimated && <Note className="-mt-4 mb-4">* No purchase on record yet: cost price is the supplier price for this brand.</Note>}

          <Card className="mb-6 border border-[#BDE6F7] bg-cyan-soft">
            <p className="flex items-start gap-2 font-extrabold text-navy"><Lightbulb className="mt-0.5 size-5 shrink-0 text-cyan" /> {data.recommendation}</p>
            {data.notes.map((n) => <p key={n} className="mt-1.5 pl-7 text-sm text-ink-soft">{n}</p>)}
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {data.offers.map((o) => (
              <OfferCard key={o.quote_id} offer={o} packLabel={data.pack_label} suggested={data.suggested_packs}
                open={picked === o.quote_id} onPick={() => setPicked(picked === o.quote_id ? null : o.quote_id)} />
            ))}
          </div>
          <Note className="mt-4">
            Selling price: yours for the brand you stock; for other brands, what nearby shops charge (never above MRP).
            Per month = profit per pack × your usual {Number(data.avg_weekly).toFixed(0)} a week × 4. Sources: {data.sources.join(" · ")}.
          </Note>
        </>
      )}
    </>
  );
}

function OfferCard({ offer: o, packLabel, suggested, open, onPick }: {
  offer: Offer; packLabel: string; suggested: number; open: boolean; onPick: () => void;
}) {
  const q = QUALITY[o.quality] ?? QUALITY.STANDARD;
  const out = o.available_packs === 0;
  const profit = Number(o.profit_per_pack);
  return (
    <div className={`card flex flex-col p-5 ${o.best ? "ring-2 ring-green" : ""} ${out ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {o.best && <Badge tone="green"><Trophy className="size-3" /> Best profit</Badge>}
        {o.current_brand && <Badge tone="navy">You stock this</Badge>}
        <Badge tone={q.tone}>{q.label}</Badge>
        {o.connector_mode === "SIMULATED" && <SimBadge />}
      </div>
      <h3 className="mt-2 text-lg font-extrabold">{o.brand}</h3>
      <p className="text-sm text-ink-soft">{o.quality_note}</p>
      <p className="mt-1 text-xs text-muted">{o.supplier_name} · {out ? "not available now" : `${o.available_packs} packs available`} · {o.eta}{o.min_order_packs > 1 && ` · min ${o.min_order_packs}`}</p>
      <dl className="num mt-4 grid grid-cols-4 gap-2 rounded-xl bg-bg p-3 text-center">
        <div><dt className="text-[11px] text-muted">Cost</dt><dd className="font-extrabold">{rupees(o.cost_price)}</dd></div>
        <div><dt className="text-[11px] text-muted">Sell at</dt><dd className="font-extrabold">{rupees(o.sell_price)}</dd>{o.mrp && <dd className="text-[10px] text-muted">MRP {rupees(o.mrp)}</dd>}</div>
        <div><dt className="text-[11px] text-muted">Profit / pack</dt><dd className={`font-extrabold ${profit < 0 ? "text-red" : "text-green"}`}>{rupees(o.profit_per_pack)}</dd><dd className="text-[10px] text-muted">{Number(o.margin_pct).toFixed(0)}% margin</dd></div>
        <div><dt className="text-[11px] text-muted">Per month</dt><dd className="font-extrabold">{rupees(o.monthly_profit)}</dd></div>
      </dl>
      <div className="mt-4 flex-1" />
      {open ? <BuyPanel offer={o} packLabel={packLabel} suggested={suggested} onCancel={onPick} /> : (
        <Button kind={o.best ? "primary" : "secondary"} disabled={out} onClick={onPick}><ShoppingCart className="size-4" /> Buy from {o.supplier_name.split(" ")[0]}</Button>
      )}
    </div>
  );
}

function BuyPanel({ offer: o, packLabel, suggested, onCancel }: { offer: Offer; packLabel: string; suggested: number; onCancel: () => void }) {
  const router = useRouter();
  const max = Math.min(o.available_packs, 500);
  const [packs, setPacks] = useState(String(Math.min(max, Math.max(o.min_order_packs, suggested))));
  const [sell, setSell] = useState(String(Number(o.sell_price)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(packs);
  const valid = Number.isInteger(n) && n >= o.min_order_packs && n <= max && Number(sell) > 0 && (!o.mrp || Number(sell) <= Number(o.mrp));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const task = await api.buy(o.quote_id, n, sell);
      router.push(`/tasks/${task.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="toast-in rounded-xl border border-line p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-bold text-ink-soft">Packs ({packLabel})
          <input value={packs} onChange={(e) => setPacks(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric"
            className="num mt-1 h-11 w-full rounded-xl border border-line px-3 text-base font-bold text-ink outline-cyan" />
        </label>
        <label className="text-xs font-bold text-ink-soft">Your selling price
          <span className="mt-1 flex h-11 items-center rounded-xl border border-line px-3 focus-within:outline-2 focus-within:outline-cyan">
            <span className="text-muted">₹</span>
            <input value={sell} onChange={(e) => setSell(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))} inputMode="decimal"
              className="num h-full min-w-0 flex-1 bg-transparent pl-1 text-base font-bold text-ink outline-none" />
          </span>
        </label>
      </div>
      <p className="num mt-3 text-sm">
        Pay <b>{rupees(Number(o.cost_price) * (n || 0))}</b> · profit <b className="text-green">{rupees(Number(sell) - Number(o.cost_price))}</b> per pack at {rupees(sell)}
      </p>
      {o.mrp && Number(sell) > Number(o.mrp) && <p className="mt-1 text-xs text-red">Can&apos;t sell above the MRP of {rupees(o.mrp)}</p>}
      {(n < o.min_order_packs || n > max) && packs !== "" && <p className="mt-1 text-xs text-red">Order {o.min_order_packs}–{max} packs</p>}
      {error && <p className="mt-2 rounded-lg bg-red-soft p-2 text-sm text-red">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button loading={busy} disabled={!valid} onClick={() => void send()} className="flex-1">Send for approval</Button>
        <Button kind="secondary" onClick={onCancel}>Cancel</Button>
      </div>
      <p className="mt-2 text-[11px] text-muted">Nothing is ordered until you approve it with your PIN. Stock, cost price and selling price change when the goods arrive.</p>
    </div>
  );
}
