"use client";

import Link from "next/link";

import { Empty, ErrorBox, PageTitle, SimBadge, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, rupees, when } from "@/lib/api";

export default function Orders() {
  const { data, error, reload } = useLoad(api.orders, [], 15000);
  return (
    <>
      <PageTitle title="Order history" sub="Supplier orders created from approved plans. Suppliers are SIMULATED in this prototype." />
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : data.length === 0 ? (
        <div className="card"><Empty title="No orders yet" body="Approved purchase plans create supplier orders here." /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="num w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line"><th className="p-4">Order</th><th>Supplier</th><th>Lines</th><th className="text-right">Accepted total</th><th className="px-4">Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} className="border-b border-[#F1F4F8] align-top last:border-0">
                  <td className="p-4"><Link href={`/tasks/${o.task_id}`} className="font-bold text-[#0083AD]">{o.reference}</Link><div className="mt-1"><SimBadge /></div></td>
                  <td className="py-4 font-semibold">{o.supplier_name}</td>
                  <td className="py-4 text-xs">
                    {o.lines.map((l) => (
                      <div key={l.product_id} className={l.line_status === "UNAVAILABLE" ? "text-red line-through" : ""}>{l.name} × {l.packs} · {rupees(l.line_total)}</div>
                    ))}
                  </td>
                  <td className="py-4 text-right text-base font-extrabold">{rupees(o.total)}</td>
                  <td className="px-4 py-4"><StateBadge state={o.status} /></td>
                  <td className="py-4 text-xs text-muted">{when(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
