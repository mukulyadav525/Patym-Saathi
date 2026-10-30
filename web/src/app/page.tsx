"use client";

import { AlertCircle, AlertTriangle, ArrowRight, Info, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Badge, Button, Card, ErrorBox, PageTitle, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, ApiError, rupees, when } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const SEV = { high: AlertCircle, medium: AlertTriangle, info: Info } as const;
const SEV_COLOR = { high: "text-red", medium: "text-amber", info: "text-cyan" } as const;

export default function Overview() {
  const { session } = useAuth();
  const router = useRouter();
  const dash = useLoad(api.dashboard, [], 15000);
  const tasks = useLoad(api.tasks, [], 15000);
  const audit = useLoad(() => api.audit(), [], 15000);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await api.ask(text);
      setReply(res.reply);
      setText("");
      if (res.task) router.push(`/tasks/${res.task.id}`);
      else void dash.reload();
    } catch (err) {
      setReply(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const d = dash.data;
  const needs = (tasks.data ?? []).filter((t) => t.group === "NEEDS_APPROVAL");

  return (
    <>
      <PageTitle title={`Namaste, ${session?.merchant.owner_name.split(" ")[0]}`} sub={`${session?.merchant.display_name} · ${session?.merchant.locality}`}
        right={d?.demo_mode && <Badge tone="violet">DEMO DATA</Badge>} />

      <form onSubmit={ask} className="card mb-6 flex items-center gap-2 p-2 pl-4">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Ask Saathi"
          placeholder='Ask Saathi — e.g. "Weekend ke liye ₹5,000 ke andar stock arrange karo"' className="h-11 flex-1 bg-transparent text-sm outline-none" />
        <Button type="submit" loading={busy}><Send className="size-4" /> Ask</Button>
      </form>
      {reply && <p className="-mt-4 mb-6 px-2 text-sm text-ink-soft">Saathi: {reply}</p>}

      {dash.error && !d ? <ErrorBox error={dash.error} onRetry={dash.reload} /> : !d ? <Skeleton /> : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Dues to collect", value: rupees(d.outstanding_dues), sub: `${d.outstanding_count} open invoices`, href: "/invoices", color: "text-amber" },
              { label: "Last week sales", value: rupees(d.last_week_sales), sub: `~${rupees(d.last_week_margin)} gross margin`, href: "/inventory", color: "text-green" },
              { label: "Low-stock items", value: String(d.low_stock_count), sub: "below half a week's demand", href: "/inventory", color: "text-red" },
              { label: "Needs approval", value: String(d.needs_approval), sub: `${d.in_progress} in progress`, href: "/inbox", color: "text-cyan" },
            ].map((k) => (
              <Link key={k.label} href={k.href} className="card p-5 transition hover:-translate-y-0.5">
                <p className="text-xs font-semibold text-ink-soft">{k.label}</p>
                <p className="num mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{k.value}</p>
                <p className={`mt-1 text-xs font-semibold ${k.color}`}>{k.sub}</p>
              </Link>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-3">
              <Card className="border border-[#FBE1E1] bg-[#FFF8F8]">
                <p className="text-sm font-extrabold text-navy">✦ Saathi AI · daily brief</p>
                <h2 className="mt-1 mb-3 text-lg font-extrabold">{d.brief.priorities.length} things need your attention</h2>
                <ul className="divide-y divide-[#F5E3E3]">
                  {d.brief.priorities.map((p) => {
                    const Icon = SEV[p.severity as keyof typeof SEV] ?? Info;
                    return (
                      <li key={p.title} className="flex gap-3 py-3">
                        <Icon className={`mt-0.5 size-5 shrink-0 ${SEV_COLOR[p.severity as keyof typeof SEV_COLOR] ?? "text-cyan"}`} />
                        <div className="flex-1">
                          <p className="font-bold">{p.title}</p>
                          <p className="text-sm text-ink-soft">{p.detail}</p>
                          <p className="mt-1 text-[11px] text-muted">Source: {p.sources.join(" · ")}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {d.brief.missing.map((m) => <p key={m} className="mt-2 text-xs text-muted">ⓘ {m}</p>)}
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-extrabold">Needs your approval</h2>
                  <Link href="/inbox" className="text-sm font-bold text-[#0083AD]">Inbox →</Link>
                </div>
                {needs.length === 0 ? <p className="text-sm text-muted">Nothing waiting. Nothing is ordered or sent without approval.</p> : needs.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between rounded-xl border border-line p-3 hover:bg-bg">
                    <div>
                      <p className="font-bold">{t.title}</p>
                      <p className="text-xs text-muted">{when(t.updated_at)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num text-lg font-extrabold">{rupees(t.amount)}</span>
                      <ArrowRight className="size-4 text-muted" />
                    </div>
                  </Link>
                ))}
              </Card>
            </div>

            <div className="space-y-6 lg:col-span-2">
              <Card>
                <h2 className="mb-3 font-extrabold">Connected records</h2>
                {d.connections.map((c) => (
                  <div key={c.source} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="font-semibold">{c.source.charAt(0) + c.source.slice(1).toLowerCase()}</span>
                    <Badge tone={c.mode === "OFF" ? "red" : c.mode === "LIVE" ? "green" : "violet"}>{c.mode}</Badge>
                  </div>
                ))}
              </Card>
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-extrabold">Recent activity</h2>
                  <Link href="/audit" className="text-sm font-bold text-[#0083AD]">All →</Link>
                </div>
                <ul className="space-y-2">
                  {(audit.data?.items ?? []).filter((e) => e.event_type !== "TASK_STATE").slice(0, 8).map((e) => (
                    <li key={e.id} className="text-sm">
                      <p className="font-medium">{e.summary}</p>
                      <p className="text-[11px] text-muted">{when(e.created_at)}</p>
                    </li>
                  ))}
                  {audit.data?.items.length === 0 && <p className="text-sm text-muted">No activity yet.</p>}
                </ul>
              </Card>
              {tasks.data && tasks.data.length > 0 && (
                <Card>
                  <h2 className="mb-3 font-extrabold">Latest tasks</h2>
                  {tasks.data.slice(0, 4).map((t) => (
                    <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between py-1.5 text-sm hover:text-navy">
                      <span className="truncate pr-2">{t.title}</span><StateBadge state={t.state} />
                    </Link>
                  ))}
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
