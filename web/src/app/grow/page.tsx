"use client";

import { Flame, ScanLine, TrendingDown, TrendingUp, Trophy, Volume2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge, Button, Card, ErrorBox, MoreLink, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, ApiError, rupees, type S } from "@/lib/api";

export default function Grow() {
  const router = useRouter();
  const overview = useLoad(api.growth, [], 30000);
  const bench = useLoad(api.benchmarks);
  const [budget, setBudget] = useState(10000);
  const [busy, setBusy] = useState<string | null>(null);
  const [scan, setScan] = useState<S["ScanOut"] | null>(null);
  const [speech, setSpeech] = useState<S["SpeechOut"] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const o = overview.data;
  const saved = o ? Number(o.impact.under_budget) + Number(o.impact.supplier_savings) : 0;

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const planFestival = () => run("festival", async () => {
    const res = await api.ask(`Diwali ke liye ₹${budget.toLocaleString("en-IN")} ke andar stock arrange karo`);
    if (res.task) router.push(`/tasks/${res.task.id}`);
    else setNotice(res.reply);
  });
  const check = () => run("scan", async () => {
    setScan(await api.scan());
    void overview.reload();
  });
  const listen = (lang: string) => run("speech", async () => {
    const res = await api.briefSpeech(lang, true);
    setSpeech(res);
    if (res.audio_base64) void new Audio(`data:${res.mime ?? "audio/wav"};base64,${res.audio_base64}`).play();
  });

  return (
    <>
      <PageTitle title="Grow with Saathi" sub="Every number below is computed from your records. Saathi drafts; you decide." />
      {notice && <p className="mb-4 rounded-xl bg-red-soft p-3 text-sm text-red">{notice}</p>}
      {overview.error && !o ? <ErrorBox error={overview.error} onRetry={overview.reload} /> : !o ? <Skeleton /> : (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="space-y-6 lg:col-span-3">
            {o.festival && (
              <div className="card bg-[#3B1D5E] p-6 text-white">
                <div className="flex items-center gap-3">
                  <span className="flex size-11 items-center justify-center rounded-full bg-white/10"><Flame className="size-6 text-[#FFB300]" /></span>
                  <div>
                    <p className="text-xl font-extrabold">{o.festival.name} in {o.festival.days_left} days</p>
                    <p className="text-sm text-[#E6D8F5]">{o.festival.source}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {o.festival.top_items.map((i) => (
                    <div key={i.name} className="rounded-xl bg-white/10 p-3">
                      <p className="text-sm font-bold">{i.name}</p>
                      <p className="text-2xl font-extrabold text-[#FFD54A]">{Number(i.uplift).toFixed(1)}×</p>
                      <p className="text-[11px] text-[#E6D8F5]">{i.last_year_packs} vs ~{Number(i.normal_weekly).toFixed(0)} packs</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {[8000, 10000, 12000].map((b) => (
                    <button key={b} onClick={() => setBudget(b)}
                      className={`h-10 rounded-full px-4 text-sm font-bold ${budget === b ? "bg-white text-[#3B1D5E]" : "bg-white/10 text-white hover:bg-white/20"}`}>
                      ₹{b.toLocaleString("en-IN")}
                    </button>
                  ))}
                  <Button className="ml-auto" loading={busy === "festival"} onClick={() => void planFestival()}>Plan {o.festival.name} stock</Button>
                </div>
              </div>
            )}

            <Card>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="font-extrabold">Stores near you</h2>
                {bench.data && <span className="text-xs text-muted">{bench.data.locality} · {bench.data.peer_count} stores · {bench.data.period}</span>}
              </div>
              {bench.data?.insights.map((i) => (
                <p key={i.name} className="mb-2 flex gap-2 rounded-xl bg-bg p-3 text-sm">
                  {i.diff_pct < 0 ? <TrendingDown className="size-4 shrink-0 text-amber" /> : <TrendingUp className="size-4 shrink-0 text-green" />}
                  {i.text}
                </p>
              ))}
              <div className="overflow-x-auto">
                <table className="num mt-2 w-full min-w-[420px] text-sm">
                  <thead className="text-left text-xs text-muted"><tr><th className="py-2">Item</th><th className="text-right">You / wk</th><th className="text-right">Nearby / wk</th><th className="text-right">Diff</th></tr></thead>
                  <tbody>
                    {bench.data?.items.map((i) => (
                      <tr key={i.product_id} className="border-t border-line">
                        <td className="py-2 font-semibold">{i.name}{i.ran_low && <span className="ml-2 text-[11px] text-red">low stock</span>}</td>
                        <td className="text-right">{i.yours}</td><td className="text-right">{i.peers}</td>
                        <td className={`text-right font-bold ${i.diff_pct <= -20 ? "text-amber" : i.diff_pct >= 20 ? "text-green" : "text-ink-soft"}`}>{i.diff_pct > 0 ? "+" : ""}{i.diff_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {bench.data && <p className="mt-3 text-[11px] text-muted">{bench.data.privacy} {bench.data.source}.</p>}
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-2">
            <div className="card bg-green p-6 text-white">
              <p className="flex items-center gap-2 text-sm font-bold text-[#C9F2DC]"><Trophy className="size-4" /> Saathi&apos;s impact</p>
              {saved > 0 ? (
                <>
                  <p className="num mt-1 text-4xl font-extrabold">{rupees(saved)}</p>
                  <p className="text-sm text-[#E3F7EC]">saved on stock · {rupees(o.impact.collected_via_links)} collected via links</p>
                </>
              ) : (
                <>
                  <p className="num mt-1 text-4xl font-extrabold">{rupees(o.impact.collected_via_links)}</p>
                  <p className="text-sm text-[#E3F7EC]">collected via Paytm links · approve a restock to start saving on stock</p>
                </>
              )}
              <p className="text-sm text-[#E3F7EC]">~{o.impact.minutes_saved_estimate} min of work saved</p>
              <p className="mt-2 text-[11px] text-[#E3F7EC]">{o.impact.restocks_completed} restocks · {o.impact.offers_drafted} offers drafted</p>
            </div>

            <Card>
              <h2 className="font-extrabold">Saathi check</h2>
              <p className="mt-1 text-sm text-muted">Saathi looks for low stock and overdue dues and prepares tasks for your approval. It never orders or sends on its own.</p>
              <Button className="mt-3 w-full" loading={busy === "scan"} onClick={() => void check()}><ScanLine className="size-4" /> Run Saathi check</Button>
              {scan && (
                <div className="mt-3 space-y-1 text-sm">
                  <p className="font-bold">{scan.created.length ? `Prepared ${scan.created.length} task(s):` : "Nothing new to prepare."}</p>
                  {scan.created.map((c) => <Link key={c.task_id} href={`/tasks/${c.task_id}`} className="block text-[#0083AD] underline">{c.title} · {rupees(c.amount)}</Link>)}
                  {scan.notes.map((n) => <p key={n} className="text-ink-soft">• {n}</p>)}
                </div>
              )}
            </Card>

            <Card>
              <h2 className="font-extrabold">Morning voice brief</h2>
              <div className="mt-3 flex gap-2">
                <Button loading={busy === "speech"} onClick={() => void listen("hi-IN")}><Volume2 className="size-4" /> Suno</Button>
                <Button kind="secondary" onClick={() => void listen("en-IN")}>English</Button>
              </div>
              {speech && <p className="mt-3 rounded-xl bg-bg p-3 text-sm text-ink-soft">{speech.text}</p>}
              {speech && speech.voice === "OFF" && <p className="mt-1 text-[11px] text-muted">Voice is off (no Sarvam key on the server); showing text.</p>}
            </Card>

            <Card>
              <h2 className="mb-2 font-extrabold">More tools</h2>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Link href="/offers" className="rounded-xl border border-line p-3 hover:bg-bg"><p className="font-bold">Slow stock offers</p><p className="text-xs text-muted">{o.slow_movers} items · {rupees(o.slow_cash_tied_up)} tied up</p></Link>
                <Link href="/khata" className="rounded-xl border border-line p-3 hover:bg-bg"><p className="font-bold">Khata insights</p><p className="text-xs text-muted">{rupees(o.khata_outstanding)} outstanding</p></Link>
                <Link href="/cashflow" className="rounded-xl border border-line p-3 hover:bg-bg"><p className="font-bold">Cash flow</p><p className={`text-xs ${Number(o.cash_shortfall) > 0 ? "text-red" : "text-muted"}`}>{Number(o.cash_shortfall) > 0 ? `Short ${rupees(o.cash_shortfall)}` : "Looks fine"}</p></Link>
                <Link href="/bills" className="rounded-xl border border-line p-3 hover:bg-bg"><p className="font-bold">Bill to stock</p><p className="text-xs text-muted">Read a supplier bill</p></Link>
              </div>
              {o.proactive_tasks > 0 && <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><Badge tone="amber">{o.proactive_tasks} prepared by Saathi</Badge><MoreLink href="/inbox">Review in inbox</MoreLink></div>}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
