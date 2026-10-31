"use client";

import { Link2, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";

import { Badge, Button, ErrorBox, Note, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, ApiError, plural, rupees } from "@/lib/api";
import { shareText } from "@/lib/share";

const TONE: Record<string, "green" | "amber" | "red" | "violet"> = { "Pays on time": "green", "Sometimes late": "amber", "Pays late": "red", "New customer": "violet" };

export default function Khata() {
  const router = useRouter();
  const { data, error, reload } = useLoad(api.khata);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const collect = async (invoiceId: string) => {
    setBusy(invoiceId);
    try {
      const task = await api.paymentLink(invoiceId);
      router.push(`/tasks/${task.id}`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const remind = async (text: string) => {
    const how = await shareText(text);
    if (how === "copied") setNotice("Reminder copied. Paste it into your message app.");
    if (how === "failed") setNotice("Couldn't share or copy the reminder.");
  };

  return (
    <>
      <PageTitle title="Khata insights" sub="Who owes you, who pays late, and a sensible credit limit for each customer."
        right={data && <div className="card bg-navy px-5 py-3 text-white"><p className="text-xs text-[#C9DDF5]">Total udhaar</p><p className="num text-2xl font-extrabold">{rupees(data.total_outstanding)}</p></div>} />
      {notice && <p className="mb-4 rounded-xl bg-cyan-soft p-3 text-sm text-navy">{notice}</p>}
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : (
        <>
          <div className="card overflow-x-auto">
            <table className="num w-full min-w-[820px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line"><th className="p-4">Customer</th><th>Status</th><th className="text-right">Outstanding</th><th className="text-right">Avg days to pay</th><th className="text-right">Late</th><th className="text-right">Suggested limit</th><th className="p-4 text-right">Action</th></tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <Fragment key={c.customer_name}>
                    <tr className="cursor-pointer border-b border-line hover:bg-bg" onClick={() => setOpen(open === c.customer_name ? null : c.customer_name)}>
                      <td className="p-4"><p className="font-bold">{c.customer_name}</p><p className="text-xs text-muted">{c.phone_masked}</p></td>
                      <td><Badge tone={TONE[c.label] ?? "muted"}>{c.label}</Badge></td>
                      <td className="text-right font-extrabold">{rupees(c.outstanding)}{c.oldest_open_days != null && <p className="text-[11px] font-normal text-muted">{c.oldest_open_days === 0 ? "since today" : `oldest ${plural(c.oldest_open_days, "day")}`}</p>}{Number(c.advance) > 0 && <p className="text-[11px] font-semibold text-green">{rupees(c.advance)} advance</p>}</td>
                      <td className="text-right">{c.avg_days_to_pay ?? "—"}</td>
                      <td className="text-right">{c.late_payments}/{c.payments}</td>
                      <td className="text-right">{rupees(c.suggested_limit)}</td>
                      <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                        {Number(c.outstanding) > 0 && (c.open_invoice_id
                          ? <Button loading={busy === c.open_invoice_id} onClick={() => void collect(c.open_invoice_id!)}><Link2 className="size-4" /> Paytm link</Button>
                          : <Button kind="secondary" onClick={() => void remind(c.reminder ?? "")}><Share2 className="size-4" /> Reminder</Button>)}
                      </td>
                    </tr>
                    {open === c.customer_name && (
                      <tr className="bg-bg">
                        <td colSpan={7} className="px-4 py-3">
                          {c.history.map((h, i) => (
                            <p key={i} className="flex justify-between py-0.5 text-xs">
                              <span>{h.date} · {h.kind === "CREDIT" ? "Udhaar given" : "Payment received"} · {h.note}</span>
                              <span className={`font-bold ${h.kind === "CREDIT" ? "text-amber" : "text-green"}`}>{rupees(h.amount)}</span>
                            </p>
                          ))}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {data.rules.map((r) => <Note key={r}>{r}</Note>)}
          <Note>Source: {data.source}</Note>
        </>
      )}
    </>
  );
}
