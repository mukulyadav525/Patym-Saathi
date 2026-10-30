"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, ErrorBox, MoreLink, PageTitle, SimBadge, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, ApiError, day, plural, rupees } from "@/lib/api";

const STARTABLE = ["PENDING", "FAILED", "EXPIRED"];

export default function Invoices() {
  const router = useRouter();
  const { data, error, reload } = useLoad(api.invoices, [], 10000);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const collect = async (id: string) => {
    setBusy(id);
    try {
      const task = await api.paymentLink(id);
      router.push(`/tasks/${task.id}`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageTitle title="Invoices & dues" sub="An invoice is marked paid only after a signed webhook and a verified status check." />
      {notice && <p className="mb-4 rounded-xl bg-red-soft p-3 text-sm text-red">{notice}</p>}
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : (
        <div className="card overflow-x-auto">
          <table className="num w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line"><th className="p-4">Invoice</th><th>Customer</th><th className="text-right">Amount</th><th className="px-4">Due</th><th>Status</th><th className="p-4 text-right">Action</th></tr>
            </thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id} className="border-b border-[#F1F4F8] last:border-0">
                  <td className="p-4 font-bold">{i.invoice_number} {i.link_mode && <SimBadge>{i.link_mode}</SimBadge>}</td>
                  <td>{i.customer_name}<div className="text-[11px] text-muted">{i.customer_phone_masked}</div></td>
                  <td className="text-right text-base font-extrabold">{rupees(i.amount)}</td>
                  <td className={`px-4 whitespace-nowrap ${i.days_overdue > 0 ? "font-semibold text-red" : "text-muted"}`}>{i.days_overdue > 0 ? `${plural(i.days_overdue, "day")} overdue` : `Due ${day(i.due_date)}`}</td>
                  <td><StateBadge state={i.status} /></td>
                  <td className="p-4 text-right">
                    {i.open_task_id ? <MoreLink href={`/tasks/${i.open_task_id}`}>Open task</MoreLink>
                      : STARTABLE.includes(i.status) ? <Button loading={busy === i.id} onClick={() => collect(i.id)}>Create payment link</Button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
