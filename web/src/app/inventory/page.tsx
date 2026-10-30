"use client";

import { Badge, Card, ErrorBox, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, rupees, when } from "@/lib/api";

export default function Inventory() {
  const { data, error, reload } = useLoad(api.inventory, [], 15000);
  const low = (data ?? []).filter((i) => i.low);
  return (
    <>
      <PageTitle title="Inventory" sub="Stock changes only when goods are received — never when an order is placed." />
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : (
        <>
          {low.length > 0 && (
            <Card className="mb-6 border border-[#FFD48A] bg-amber-soft">
              <p className="font-extrabold text-amber">{low.length} items below half a week&apos;s demand</p>
              <p className="text-sm text-ink-soft">{low.map((i) => i.name).join(", ")} — ask Saathi to plan a restock.</p>
            </Card>
          )}
          <div className="card overflow-x-auto">
            <table className="num w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="p-4">Item</th><th>Pack</th><th className="text-right">Stock (packs)</th><th className="text-right">Avg / week</th><th className="text-right">Sell price</th><th className="px-4">Source</th>
                </tr>
              </thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.product_id} className="border-b border-[#F1F4F8] last:border-0">
                    <td className="p-4"><b>{i.name}</b> <span className="text-muted">{i.name_hi}</span></td>
                    <td>{i.pack_label}</td>
                    <td className={`text-right text-base font-extrabold ${i.low ? "text-red" : ""}`}>{i.usable_packs} {i.low && <Badge tone="red">Low</Badge>}</td>
                    <td className="text-right">{i.avg_weekly}</td>
                    <td className="text-right">{rupees(i.sell_price)}</td>
                    <td className="px-4"><Badge tone={i.source === "SAMPLE" ? "violet" : "green"}>{i.source}</Badge> <span className="text-[11px] text-muted">{when(i.updated_at)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
