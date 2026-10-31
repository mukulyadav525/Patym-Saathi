"use client";

import { AlertTriangle, ArrowLeftRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, Button, Card, ErrorBox, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, ApiError, plural, rupees, when } from "@/lib/api";

const RESTOCK_ASK = "Weekend ke liye ₹5,000 ke andar stock arrange karo";

export default function Inventory() {
  const router = useRouter();
  const { data, error, reload } = useLoad(api.inventory, [], 15000);
  const low = (data ?? []).filter((i) => i.low);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Same request as saying it to Saathi: drafts a plan that waits for approval; nothing is ordered here.
  const planRestock = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.ask(RESTOCK_ASK);
      if (res.task) router.push(`/tasks/${res.task.id}`);
      else setNotice(res.reply);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageTitle title="Inventory & vendors" sub="Stock and cost price change only when goods are received — never when an order is placed." />
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : (
        <>
          {low.length > 0 && (
            <Card className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-3 border border-[#FFD48A] bg-amber-soft">
              <AlertTriangle className="size-5 shrink-0 text-amber" />
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-amber">{plural(low.length, "item")} below half a week&apos;s demand</p>
                <p className="text-sm text-ink-soft">{low.map((i) => i.name).join(", ")}</p>
                {notice && <p className="mt-1 text-sm text-ink">{notice}</p>}
              </div>
              <Button loading={busy} onClick={() => void planRestock()}>Plan restock within ₹5,000</Button>
            </Card>
          )}
          <div className="card overflow-x-auto">
            <table className="num w-full min-w-[860px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="p-4">Item</th><th>Pack</th><th className="text-right">Stock (packs)</th><th className="text-right">Avg / week</th>
                  <th className="text-right">Cost price</th><th className="text-right">Sell price</th><th className="text-right">Profit / pack</th><th className="px-4">Source</th><th />
                </tr>
              </thead>
              <tbody>
                {data.map((i) => (
                  <tr key={i.product_id} className="border-b border-[#F1F4F8] last:border-0">
                    <td className="p-4">
                      <b>{i.name}</b> <span className="text-muted">{i.name_hi}</span>
                      {i.brand && <p className="text-xs text-ink-soft">{i.brand}</p>}
                    </td>
                    <td>{i.pack_label}</td>
                    <td className="text-right">
                      <span className="inline-flex items-center justify-end gap-2">
                        {i.low && <Badge tone="red">Low</Badge>}
                        <span className={`w-8 text-base font-extrabold ${i.low ? "text-red" : ""}`}>{i.usable_packs}</span>
                      </span>
                    </td>
                    <td className="text-right">{i.avg_weekly}</td>
                    <td className="text-right">{rupees(i.cost_price, i.cost_price && Number(i.cost_price) % 1 ? 2 : 0)}{i.cost_estimated && <span className="text-muted" title="No purchase on record; supplier price"> *</span>}</td>
                    <td className="text-right">{rupees(i.sell_price)}</td>
                    <td className={`text-right font-bold ${Number(i.profit_per_pack) < 0 ? "text-red" : "text-green"}`}>{rupees(i.profit_per_pack, i.profit_per_pack && Number(i.profit_per_pack) % 1 ? 2 : 0)}</td>
                    <td className="px-4"><Badge tone={i.source === "SAMPLE" ? "violet" : "green"}>{i.source}</Badge> <span className="text-[11px] text-muted">{when(i.updated_at)}</span></td>
                    <td className="pr-4 text-right">
                      <Link href={`/inventory/${i.product_id}`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-xs font-bold text-[#0083AD] hover:bg-cyan-soft">
                        <ArrowLeftRight className="size-3.5" /> Compare vendors
                      </Link>
                    </td>
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
