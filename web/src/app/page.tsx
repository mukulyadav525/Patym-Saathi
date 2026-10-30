"use client";

import { AlertCircle, AlertTriangle, ArrowRight, Info, Mic, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { DuesDonut, SalesBars } from "@/components/charts";
import { Badge, Button, Card, ErrorBox, PageTitle, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, ApiError, rupees, when } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createRecognizer, speak, stopSpeaking, type Recognizer } from "@/lib/voice";

const SEV = { high: AlertCircle, medium: AlertTriangle, info: Info } as const;
const SEV_COLOR = { high: "text-red", medium: "text-amber", info: "text-cyan" } as const;

export default function Overview() {
  const { session } = useAuth();
  const router = useRouter();
  const dash = useLoad(api.dashboard, [], 15000);
  const tasks = useLoad(api.tasks, [], 15000);
  const audit = useLoad(() => api.audit(), [], 15000);
  const growth = useLoad(api.growth, [], 30000);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (value: string, spoken = false) => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      const res = await api.ask(value, spoken);
      setReply(res.reply);
      setText("");
      if (spoken) speak(res.speech || res.reply);
      if (res.task) router.push(`/tasks/${res.task.id}`);
      else void dash.reload();
    } catch (err) {
      setReply(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const ask = (e: FormEvent) => {
    e.preventDefault();
    void send(text);
  };

  // Voice: speak a question ("Hey Saathi, atta kitna bacha hai?"); the answer is shown and read aloud.
  const recRef = useRef<Recognizer | null>(null);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const toggleMic = () => {
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = createRecognizer();
    if (!rec) {
      setMicError("Voice needs Chrome or Edge. You can type your question instead.");
      return;
    }
    stopSpeaking();
    setMicError(null);
    let finalText = "";
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setText((finalText + interim).trim());
    };
    rec.onerror = (ev) => setMicError(ev.error === "not-allowed" ? "Microphone permission is blocked for this site." : `Didn't catch that (${ev.error}).`);
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) void send(finalText.trim(), true);
    };
    recRef.current = rec;
    setListening(true);
    rec.start();
  };
  useEffect(() => () => recRef.current?.abort(), []);

  // Each brief priority has a quick action: collect starts a payment-link draft, restock asks Saathi for a plan.
  const act = async (p: NonNullable<typeof dash.data>["brief"]["priorities"][number]) => {
    if (!p.action) return;
    setBusy(true);
    try {
      if (p.action.type === "COLLECT" && p.action.invoice_id) {
        const task = await api.paymentLink(p.action.invoice_id);
        router.push(`/tasks/${task.id}`);
      } else if (p.action.type === "RESTOCK") {
        const res = await api.ask("Weekend ke liye ₹5,000 ke andar stock arrange karo");
        if (res.task) router.push(`/tasks/${res.task.id}`);
        else setReply(res.reply);
      }
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
        <button type="button" onClick={toggleMic} aria-label={listening ? "Stop listening" : "Ask by voice"}
          className={`flex size-11 items-center justify-center rounded-full ${listening ? "animate-pulse bg-red text-white" : "bg-cyan-soft text-navy hover:bg-[#d4f1fb]"}`}>
          <Mic className="size-5" />
        </button>
        <Button type="submit" loading={busy}><Send className="size-4" /> Ask</Button>
      </form>
      {listening && <p className="-mt-4 mb-6 px-2 text-sm font-semibold text-red">Listening… bolein jaise “atta kitna bacha hai?”</p>}
      {micError && <p className="-mt-4 mb-6 px-2 text-sm text-red">{micError}</p>}
      {reply && <p className="-mt-4 mb-6 px-2 text-sm text-ink-soft">Saathi: {reply}</p>}

      {dash.error && !d ? <ErrorBox error={dash.error} onRetry={dash.reload} /> : !d ? <Skeleton /> : (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-extrabold">Business overview</h2>
            <span className="hidden text-xs text-muted sm:inline">From connected records · refreshes every 15 s</span>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Dues to collect", value: rupees(d.outstanding_dues), sub: `${d.outstanding_count} open invoices`, href: "/invoices", color: "text-amber", tint: "from-[#FFF6E6]" },
              { label: "Last week sales", value: rupees(d.last_week_sales), sub: `~${rupees(d.last_week_margin)} gross margin`, href: "/inventory", color: "text-green", tint: "from-[#E9F8EF]" },
              { label: "Low-stock items", value: String(d.low_stock_count), sub: "below half a week's demand", href: "/inventory", color: "text-red", tint: "from-[#FDEEEE]" },
              { label: "Needs approval", value: String(d.needs_approval), sub: `${d.in_progress} in progress`, href: "/inbox", color: "text-[#0083AD]", tint: "from-cyan-soft" },
            ].map((k) => (
              <Link key={k.label} href={k.href} className={`card bg-linear-to-br ${k.tint} to-white p-5 transition hover:-translate-y-0.5`}>
                <p className="text-xs font-semibold text-ink-soft">{k.label}</p>
                <p className="num mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">{k.value}</p>
                <p className={`mt-1 text-xs font-semibold ${k.color}`}>{k.sub}</p>
              </Link>
            ))}
          </div>

          {growth.data && (growth.data.festival || Number(growth.data.cash_shortfall) > 0 || growth.data.slow_movers > 0) && (
            <Link href="/grow" className="card mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 bg-[#3B1D5E] p-4 text-white transition hover:-translate-y-0.5">
              {growth.data.festival && <span className="font-extrabold">🪔 {growth.data.festival.name} in {growth.data.festival.days_left} days: plan festival stock</span>}
              {growth.data.slow_movers > 0 && <span className="text-sm text-[#E6D8F5]">{growth.data.slow_movers} slow items · {rupees(growth.data.slow_cash_tied_up)} tied up</span>}
              {Number(growth.data.cash_shortfall) > 0 && <span className="text-sm text-[#FFC9C9]">Cash may fall short by {rupees(growth.data.cash_shortfall)}</span>}
              <span className="ml-auto text-sm font-bold">Grow with Saathi →</span>
            </Link>
          )}

          <div className="mb-6 grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="font-extrabold">Sales trend</h2>
                  <p className="text-xs text-muted">Weekly · sell price × packs sold · POS records (SAMPLE)</p>
                </div>
                <Link href="/inventory" className="text-sm font-bold text-[#0083AD]">By item →</Link>
              </div>
              <SalesBars weeks={d.weekly_sales} />
            </Card>
            <Card className="lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-extrabold">Customer dues</h2>
                  <p className="text-xs text-muted">Paid counts only after status verification</p>
                </div>
                <Link href="/payments" className="text-sm font-bold text-[#0083AD]">Payments →</Link>
              </div>
              <DuesDonut dues={d.dues} />
            </Card>
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
                        {p.action && (
                          <button onClick={() => void act(p)} disabled={busy}
                            className="h-9 shrink-0 self-center rounded-xl border border-cyan px-3 text-sm font-bold text-[#0083AD] hover:bg-cyan-soft disabled:opacity-50">
                            {p.action.label}
                          </button>
                        )}
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
