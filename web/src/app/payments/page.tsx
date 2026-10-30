"use client";

import { ArrowDownLeft, Clock } from "lucide-react";
import Link from "next/link";

import { Badge, Card, Empty, ErrorBox, PageTitle, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, rupees, when } from "@/lib/api";

// Payments received through Saathi payment links. Bank settlement is outside this prototype and not simulated.
export default function Payments() {
  const { data, error, reload } = useLoad(api.invoices, [], 10000);
  const paid = (data ?? []).filter((i) => i.status === "PAID");
  const awaiting = (data ?? []).filter((i) => i.link_url && i.status !== "PAID");
  const received = paid.reduce((s, i) => s + Number(i.amount), 0);

  return (
    <>
      <PageTitle title="Payments & settlements" sub="Only payments confirmed by a signed callback and a server-side status check appear as received."
        right={<Badge tone="violet">DEMO PAYMENTS</Badge>} />
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton stats /> : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div className="card bg-navy p-5 text-white">
              <p className="text-xs font-semibold text-[#C9DDF5]">Received via payment links</p>
              <p className="num mt-1 text-3xl font-extrabold">{rupees(String(received))}</p>
              <p className="mt-1 text-xs text-[#C9DDF5]">{paid.length} verified {paid.length === 1 ? "payment" : "payments"}</p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold text-ink-soft">Links awaiting payment</p>
              <p className="num mt-1 text-3xl font-extrabold">{awaiting.length}</p>
              <p className="mt-1 text-xs font-semibold text-amber">{rupees(String(awaiting.reduce((s, i) => s + Number(i.amount), 0)))} outstanding</p>
            </div>
            <div className="card p-5">
              <p className="text-xs font-semibold text-ink-soft">Bank settlement</p>
              <p className="mt-1 text-lg font-extrabold">Not part of this prototype</p>
              <p className="mt-1 text-xs text-muted">Settlement runs inside Paytm; nothing is simulated here.</p>
            </div>
          </div>

          <Card>
            <h2 className="mb-3 font-extrabold">Transactions</h2>
            {paid.length + awaiting.length === 0 ? (
              <Empty title="No payments yet" body="Create a payment link from Invoices; verified payments show up here." />
            ) : (
              <ul className="divide-y divide-line">
                {[...paid, ...awaiting].map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-3">
                    <span className={`flex size-10 items-center justify-center rounded-full ${i.status === "PAID" ? "bg-green-soft text-green" : "bg-amber-soft text-amber"}`}>
                      {i.status === "PAID" ? <ArrowDownLeft className="size-5" /> : <Clock className="size-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{i.customer_name}</p>
                      <p className="truncate text-xs text-muted">
                        {i.invoice_number} · {i.paid_at ? `paid ${when(i.paid_at)}` : `link ${i.link_mode ?? ""}`} · UPI
                      </p>
                    </div>
                    <span className="num text-lg font-extrabold">{rupees(i.amount)}</span>
                    <StateBadge state={i.status} />
                    {i.open_task_id && <Link href={`/tasks/${i.open_task_id}`} className="text-sm font-bold text-[#0083AD]">View</Link>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </>
  );
}
