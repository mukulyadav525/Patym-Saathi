"use client";

import Link from "next/link";

import { Badge, Card, ErrorBox, Note, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, rupees } from "@/lib/api";

const paise = (v: string | null | undefined) => rupees(v, v && Number(v) % 1 ? 2 : 0);
const day = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** Profit per item: what it sold for minus what that stock cost to buy. */
export default function Profit() {
  const { data, error, reload } = useLoad(api.profit);
  return (
    <>
      <PageTitle title="Profit by item" sub={data ? `${day(data.period_from)} – ${day(data.period_to)} · selling price minus what you paid for that stock` : undefined} />
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton stats /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Sales", rupees(data.revenue), ""], ["Cost of goods", rupees(data.cost), ""],
              ["Profit", rupees(data.profit), "text-green"], ["Margin", data.margin_pct ? `${Number(data.margin_pct).toFixed(1)}%` : "—", ""]]
              .map(([label, value, tone]) => (
                <Card key={label} className="p-4!">
                  <p className="text-xs font-semibold text-ink-soft">{label}</p>
                  <p className={`num mt-1 text-2xl font-extrabold ${tone}`}>{value}</p>
                </Card>
              ))}
          </div>
          <div className="card overflow-x-auto">
            <table className="num w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="p-4">Item</th><th className="text-right">Sold</th><th className="text-right">Sales</th><th className="text-right">Cost</th>
                  <th className="text-right">Profit</th><th className="text-right">Per pack</th><th className="text-right">Margin</th><th className="px-4" />
                </tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.product_id} className="border-b border-[#F1F4F8] last:border-0">
                    <td className="p-4">
                      <b>{i.name}</b> <span className="text-xs text-muted">{i.pack_label}</span>
                      {i.brand && <p className="text-xs text-ink-soft">{i.brand} · cost {paise(i.cost_price)} · sells {rupees(i.sell_price)}</p>}
                    </td>
                    <td className="text-right">{i.packs_sold}{i.counter_packs > 0 && <p className="text-[11px] text-muted">{i.counter_packs} at counter</p>}</td>
                    <td className="text-right">{rupees(i.revenue)}</td>
                    <td className="text-right">{rupees(i.cost)}</td>
                    <td className={`text-right font-extrabold ${Number(i.profit) < 0 ? "text-red" : "text-green"}`}>{rupees(i.profit)} {i.estimated && <Badge tone="muted">est.</Badge>}</td>
                    <td className="text-right">{paise(i.profit_per_pack)}</td>
                    <td className="text-right">{i.margin_pct ? `${Number(i.margin_pct).toFixed(1)}%` : "—"}</td>
                    <td className="px-4 text-right">
                      <Link href={`/inventory/${i.product_id}`} className="whitespace-nowrap text-xs font-bold text-[#0083AD] hover:underline">Compare vendors</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {[...data.notes, `Sources: ${data.sources.join("; ")}.`].map((n) => <Note key={n}>{n}</Note>)}
          <Note>Ask Saathi: “Atta pe kitna munafa hua?” or “Kitna munafa hua?”</Note>
        </>
      )}
    </>
  );
}
