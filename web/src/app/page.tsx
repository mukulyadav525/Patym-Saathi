"use client";

import { AlertCircle, AlertTriangle, ChevronRight, Flame, Info, Mic, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { DuesDonut, SalesBars } from "@/components/charts";
import { Badge, Button, Card, ErrorBox, MoreLink, Note, PageTitle, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, ApiError, plural, rupees, SOURCE_LABEL, when } from "@/lib/api";
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
  const counter = useLoad(api.soundboxToday);
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

      <div className="mb-6">
        <form onSubmit={ask} className="card flex items-center gap-2 p-2 pl-4">
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} aria-label="Ask Saathi"
            placeholder="Ask Saathi anything…" className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          <button type="button" onClick={toggleMic} aria-label={listening ? "Stop listening" : "Ask by voice"}
            className={`relative flex size-11 shrink-0 items-center justify-center rounded-full transition ${listening ? "bg-red text-white" : "bg-cyan-soft text-navy hover:bg-[#d4f1fb]"}`}>
            {listening && <span className="absolute inset-0 animate-ping rounded-full bg-red/40" />}
            <Mic className="relative size-5" />
          </button>
          <Button type="submit" loading={busy} className="shrink-0" aria-label="Ask"><Send className="size-4" /><span className="hidden sm:inline">Ask</span></Button>
        </form>
        {listening && <p className="mt-2 px-2 text-sm font-semibold text-red">Listening… bolein jaise “atta kitna bacha hai?”</p>}
        {micError && <p className="mt-2 px-2 text-sm text-red">{micError}</p>}
        {reply && (
          <div className="reply-in mt-2 flex gap-2 rounded-2xl bg-cyan-soft px-4 py-3 text-sm text-ink">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-[#0083AD]" />
            <p className="min-w-0"><b className="text-navy">Saathi:</b> {reply}</p>
          </div>
        )}
      </div>

      {dash.error && !d ? <ErrorBox error={dash.error} onRetry={dash.reload} /> : !d ? <Skeleton stats /> : (
        <>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-extrabold">Business overview</h2>
            <span className="hidden text-xs text-muted sm:inline">From connected records · refreshes every 15 s</span>
          </div>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              { label: "Dues to collect", value: rupees(d.outstanding_dues), sub: plural(d.outstanding_count, "open invoice"), href: "/invoices", color: "text-amber", tint: "from-[#FFF6E6]" },
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
              {growth.data.festival && <span className="flex items-center gap-2 font-extrabold"><Flame className="size-5 text-[#FFB300]" /> {growth.data.festival.name} in {growth.data.festival.days_left} days: plan festival stock</span>}
              {growth.data.slow_movers > 0 && <span className="text-sm text-[#E6D8F5]">{growth.data.slow_movers} slow items · {rupees(growth.data.slow_cash_tied_up)} tied up</span>}
              {Number(growth.data.cash_shortfall) > 0 && <span className="text-sm text-[#FFC9C9]">Cash may fall short by {rupees(growth.data.cash_shortfall)}</span>}
              <span className="ml-auto flex items-center gap-0.5 text-sm font-bold">Grow with Saathi <ChevronRight className="size-4" /></span>
            </Link>
          )}

          <div className="mb-6 grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <h2 className="font-extrabold">Sales trend</h2>
                  <p className="text-xs text-muted">Weekly · sell price × packs sold · POS records (SAMPLE)</p>
                </div>
                <MoreLink href="/inventory">By item</MoreLink>
              </div>
              <SalesBars weeks={d.weekly_sales} />
            </Card>
            <Card className="lg:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="font-extrabold">Customer dues</h2>
                  <p className="text-xs text-muted">Paid counts only after status verification</p>
                </div>
                <MoreLink href="/payments">Payments</MoreLink>
              </div>
              <DuesDonut dues={d.dues} />
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <div className="space-y-6 lg:col-span-3">
              <Card>
                <p className="flex items-center gap-1.5 text-sm font-extrabold text-navy"><Sparkles className="size-4 text-cyan" /> Saathi AI · daily brief</p>
                <h2 className="mt-1 mb-3 text-lg font-extrabold">{d.brief.priorities.length} things need your attention</h2>
                <ul className="divide-y divide-line">
                  {d.brief.priorities.map((p) => {
                    const Icon = SEV[p.severity as keyof typeof SEV] ?? Info;
                    return (
                      <li key={p.title} className="grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 sm:grid-cols-[20px_minmax(0,1fr)_auto]">
                        <Icon className={`mt-0.5 size-5 ${SEV_COLOR[p.severity as keyof typeof SEV_COLOR] ?? "text-cyan"}`} />
                        <div>
                          <p className="font-bold">{p.title}</p>
                          <p className="text-sm text-ink-soft">{p.detail}</p>
                          <p className="mt-1 text-[11px] text-muted">Source: {p.sources.join(" · ")}</p>
                        </div>
                        {p.action && (
                          <button onClick={() => void act(p)} disabled={busy}
                            className="col-start-2 h-9 justify-self-start rounded-xl border border-cyan px-3 text-sm font-bold whitespace-nowrap text-[#0083AD] transition hover:bg-cyan-soft disabled:opacity-50 sm:col-start-3 sm:self-center">
                            {p.action.label}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {d.brief.missing.map((m) => <Note key={m}>{m}</Note>)}
              </Card>

              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-extrabold">Needs your approval</h2>
                  <MoreLink href="/inbox">Inbox</MoreLink>
                </div>
                {needs.length === 0 ? <p className="text-sm text-muted">Nothing waiting. Nothing is ordered or sent without approval.</p> : needs.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between rounded-xl border border-line p-3 hover:bg-bg">
                    <div>
                      <p className="font-bold">{t.title}</p>
                      <p className="text-xs text-muted">{when(t.updated_at)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num text-lg font-extrabold">{rupees(t.amount)}</span>
                      <ChevronRight className="size-4 text-muted" />
                    </div>
                  </Link>
                ))}
              </Card>
            </div>

            <div className="space-y-6 lg:col-span-2">
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h2 className="font-extrabold">Counter today</h2>
                    <p className="text-xs text-muted">Spoken to the Soundbox · updates live</p>
                  </div>
                  <MoreLink href="/soundbox">Soundbox</MoreLink>
                </div>
                {!counter.data ? <div className="shimmer h-16 rounded-xl" /> : (
                  <>
                    <div className="mb-3 grid grid-cols-3 gap-2 text-center">
                      {[["Sales", counter.data.total_sales], ["UPI", counter.data.upi], ["Khata", counter.data.udhaar]].map(([label, v]) => (
                        <div key={label} className="rounded-xl bg-bg py-2">
                          <p className="text-[11px] text-muted">{label}</p>
                          <p className="num font-extrabold">{rupees(v)}</p>
                        </div>
                      ))}
                    </div>
                    {counter.data.entries.length === 0 ? <p className="text-sm text-muted">No entries yet. Say “Saathi, atta liya Mukul ne”.</p> : (
                      <ul className="divide-y divide-line">
                        {counter.data.entries.slice(0, 4).map((e) => (
                          <li key={e.id} className={`reply-in flex items-center justify-between gap-3 py-2 text-sm ${e.status === "CANCELLED" ? "text-muted line-through" : ""}`}>
                            <span className="min-w-0 truncate">
                              <b>{e.customer_name ?? "Walk-in"}</b> · {e.kind === "PAYMENT" ? "khata payment" : e.lines.map((l) => `${l.name} ×${l.packs}`).join(", ")}
                            </span>
                            <span className="num shrink-0 font-bold">{rupees(e.total)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </Card>
              <Card>
                <h2 className="mb-3 font-extrabold">Connected records</h2>
                {d.connections.map((c) => (
                  <div key={c.source} className="flex items-center justify-between py-1.5 text-sm">
                    <span className="font-semibold">{SOURCE_LABEL[c.source] ?? c.source}</span>
                    <Badge tone={c.mode === "OFF" ? "red" : c.mode === "LIVE" ? "green" : "violet"}>{c.mode}</Badge>
                  </div>
                ))}
              </Card>
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-extrabold">Recent activity</h2>
                  <MoreLink href="/audit">View all</MoreLink>
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
