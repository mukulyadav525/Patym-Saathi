"use client";

import { BookOpen, CheckCircle2, Keyboard, Loader2, Mic, MicOff, Power, ScanLine, ShieldCheck, Undo2, Volume2, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { useLoad } from "@/components/ui";
import { api, ApiError, rupees, type S } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { ding, CounterListener, playMp3 } from "@/lib/listener";
import { onLive, startLive } from "@/lib/live";

type Result = S["SoundboxResult"];
type Entry = S["CounterSaleOut"];
type Phase = "idle" | "hearing" | "checking" | "thinking" | "speaking";
type Mic = "off" | "on" | "insecure" | "denied" | "error";
type Screen = { big: string; small: string; tone: "idle" | "ok" | "ask" | "money" | "warn" };

const FOLLOWUP_MS = 12000;
const MODE_LABEL: Record<string, string> = { UPI: "Paytm UPI", CASH: "Cash", UDHAAR: "Khata" };
const STATUS_LABEL: Record<string, string> = { PAID: "Paid", AWAITED: "UPI awaited", ON_KHATA: "On khata" };
const IDLE: Screen = { big: "Saathi", small: "Bolein: “Saathi, atta liya Mukul ne”", tone: "idle" };
const SETTLED_MS = 12000; // a paid / khata bill stays on the standee this long, then the shop QR returns
const QR_STYLE = { margin: 1, width: 560, color: { dark: "#002E6E", light: "#FFFFFF" } };

// A counter sale with items is a bill: the standee shows it, with a QR for its exact amount while it is due.
const isBill = (s: Entry | null | undefined): s is Entry => !!s && s.kind === "SALE" && s.lines.length > 0 && s.status !== "CANCELLED";
const isDue = (s: Entry) => s.status === "PENDING" || s.payment_status === "AWAITED";

function screenFor(r: Result): Screen {
  const sale = r.sale;
  if (r.action === "RECORDED" && sale?.kind === "BUY") return { big: rupees(sale.total), small: "Order drafted · approve it in the app or dashboard", tone: "ask" };
  if (r.action === "RECORDED" && sale) {
    const big = sale.kind === "PAYMENT" ? `+${rupees(sale.total)}` : rupees(sale.total);
    const small = `${sale.bill_number} · ${sale.customer_name ?? "Walk-in"} · ${sale.payment_status === "AWAITED" ? "UPI awaited" : MODE_LABEL[sale.payment_mode ?? ""] ?? ""}`;
    return { big, small, tone: "ok" };
  }
  if (r.action === "ASKED") {
    const billTotal = sale?.kind === "SALE" && (sale.question === "PAYMENT" || sale.question === "PAYMENT_NOW");
    return { big: billTotal ? rupees(sale.total) : "?", small: r.reply, tone: "ask" };
  }
  if (r.action === "CANCELLED") return { big: "Undo", small: r.reply, tone: "warn" };
  if (r.action === "NOT_UNDERSTOOD") return { big: "…", small: r.reply, tone: "warn" };
  return { big: "Saathi", small: r.reply, tone: "idle" };
}

export default function SoundboxPage() {
  const { session } = useAuth();
  const today = useLoad(api.soundboxToday);
  const reloadToday = today.reload;
  const qr = useLoad(api.soundboxQr);
  const [qrImage, setQrImage] = useState<string | null>(null);
  // The QR opens the DEMO pay page on this same site, so a phone that scans it can "pay" the shop.
  const payUrl = qr.data && typeof window !== "undefined" ? `${window.location.origin}${qr.data.pay_path}` : "";

  const listener = useRef<CounterListener | null>(null);
  const [started, setStarted] = useState(false);
  const [mic, setMic] = useState<Mic>("off");
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [screen, setScreen] = useState<Screen>(IDLE);
  const [log, setLog] = useState<{ id: number; heard: string; reply: string; by: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const followUntil = useRef(0);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const [typed, setTyped] = useState("");
  const [showType, setShowType] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [paying, setPaying] = useState(false);
  const [bill, setBill] = useState<Entry | null>(null); // the bill from the last voice entry here
  // A plan or purchase Saathi drafted that waits for the merchant's tap (in the app, the dashboard, or here).
  const [approval, setApproval] = useState<{ taskId: string; title: string; amount: string } | null>(null);
  const [closedId, setClosedId] = useState<string | null>(null);
  const [billQr, setBillQr] = useState<{ url: string; image: string } | null>(null);

  // After a reload: the bill Saathi is still asking about, or the latest one still waiting for its UPI payment.
  const t = today.data;
  const waiting = t && (isBill(t.pending) ? t.pending : isBill(t.entries[0]) && t.entries[0].payment_status === "AWAITED" ? t.entries[0] : null);
  const shown = bill ?? (waiting && waiting.id !== closedId ? waiting : null);
  const billUrl = shown && payUrl && isDue(shown) ? `${payUrl}?bill=${shown.id}` : "";
  const billImage = billQr?.url === billUrl ? billQr.image : null;

  const closeBill = useCallback((id: string) => {
    setClosedId(id);
    setBill((b) => (b?.id === id ? null : b));
  }, []);

  useEffect(() => {
    if (!payUrl) return;
    void QRCode.toDataURL(payUrl, QR_STYLE).then(setQrImage);
  }, [payUrl]);

  useEffect(() => {
    if (!billUrl) return;
    let current = true;
    void QRCode.toDataURL(billUrl, QR_STYLE).then((image) => current && setBillQr({ url: billUrl, image }));
    return () => {
      current = false;
    };
  }, [billUrl]);

  // A settled bill (paid, or written in the khata) gives the standee back to the shop QR after a while.
  useEffect(() => {
    if (!shown || isDue(shown)) return;
    const id = shown.id;
    const timer = setTimeout(() => closeBill(id), SETTLED_MS);
    return () => clearTimeout(timer);
  }, [shown, closeBill]);

  const audioCtx = () => listener.current?.ctx ?? null;

  // Speak through the unlocked AudioContext; the microphone is ignored meanwhile so Saathi doesn't hear itself.
  const say = useCallback(async (audio: string | null | undefined, fallbackText: string) => {
    const ctx = audioCtx();
    setPhase("speaking");
    listener.current?.mute(true);
    try {
      if (audio && ctx) await playMp3(ctx, audio);
      else if (fallbackText && "speechSynthesis" in window) {
        await new Promise<void>((done) => {
          const u = new SpeechSynthesisUtterance(fallbackText);
          u.lang = "hi-IN";
          u.onend = u.onerror = () => done();
          speechSynthesis.speak(u);
        });
      }
    } catch {
      // A reply that can't be played is still on screen.
    } finally {
      listener.current?.mute(false);
      setPhase("idle");
    }
  }, []);

  const show = useCallback(async (r: Result) => {
    setScreen(screenFor(r));
    if (r.action === "CANCELLED") {
      // "Cancel karo" undoes the entry it names, or drops the bill still being asked about (no sale in the reply).
      if (r.sale) closeBill(r.sale.id);
      else setBill((b) => (b?.status === "PENDING" ? null : b));
      reloadToday();
    } else if (isBill(r.sale)) {
      const sale = r.sale;
      setBill(sale);
      if (isDue(sale)) setPayAmount(String(Number(sale.total)));
    }
    setLog((cur) => [{ id: Date.now(), heard: r.heard || r.command, reply: r.reply, by: r.understood_by }, ...cur].slice(0, 6));
    if (r.task_id) setApproval({ taskId: r.task_id, title: r.reply.split(".")[0], amount: r.sale ? r.sale.total : "" });
    if (r.expects_reply) {
      followUntil.current = Date.now() + FOLLOWUP_MS;
      setAwaitingReply(true);
      if (r.sale) setPayAmount(String(Number(r.sale.total)));
    } else {
      followUntil.current = 0;
      setAwaitingReply(false);
    }
    await say(r.audio, r.speech || r.reply);
    if (r.expects_reply) followUntil.current = Date.now() + FOLLOWUP_MS; // the clock starts after Saathi finishes asking
  }, [say, closeBill, reloadToday]);

  const handleUtterance = useCallback((wav: Blob) => {
    queue.current = queue.current.then(async () => {
      setPhase("checking");
      setError(null);
      const form = new FormData();
      form.append("audio", wav, "speech.wav");
      form.append("followup", String(Date.now() < followUntil.current));
      form.append("speak", "true");
      try {
        const r = await api.soundboxListen(form);
        if (r.action === "IGNORED") {
          setPhase("idle");
          return;
        }
        await show(r);
      } catch (e) {
        setPhase("idle");
        setError(e instanceof ApiError ? e.message : "Couldn't reach Saathi");
      }
    });
  }, [show]);

  const start = async () => {
    setStarted(true);
    const l = new CounterListener({
      onUtterance: handleUtterance,
      onLevel: (v, speaking) => {
        setLevel(v);
        setPhase((p) => (p === "idle" && speaking ? "hearing" : p === "hearing" && !speaking ? "idle" : p));
      },
    });
    listener.current = l;
    try {
      await l.start();
      setMic("on");
    } catch (e) {
      const name = e instanceof Error ? e.message || e.name : "";
      setMic(name === "INSECURE" ? "insecure" : /NotAllowed|Permission|denied/i.test(String((e as Error)?.name) + name) ? "denied" : "error");
      await l.ctx.resume().catch(() => undefined); // payments can still be announced
    }
    // Keep the screen on while the Soundbox runs (it is the counter device).
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<unknown> } };
      await nav.wakeLock?.request("screen");
    } catch {
      // Not supported: the iPad's auto-lock setting applies.
    }
  };

  useEffect(() => () => listener.current?.stop(), []);

  // Re-take the wake lock when the page comes back to the front.
  useEffect(() => {
    if (!started) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<unknown> } };
      void nav.wakeLock?.request("screen").catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [started]);

  // Payments to the QR are announced the way a soundbox does: ding, then the amount.
  useEffect(() => {
    const stop = startLive();
    const off = onLive((events) => {
      for (const e of events) {
        if (e.kind === "COUNTER_UNDO") setBill((b) => (b?.id === e.data.sale_id ? null : b));
        if (e.kind === "APPROVAL_NEEDED") {
          setApproval({ taskId: e.data.task_id as string, title: e.title.replace(/^Approve: /, ""), amount: e.data.amount as string });
          continue;
        }
        if (e.kind === "APPROVED" || e.kind === "REJECTED") {
          setApproval((a) => (a?.taskId === e.data.task_id ? null : a));
          setLog((cur) => [{ id: e.id, heard: e.title, reply: e.announce ?? e.body, by: "" }, ...cur].slice(0, 6));
          if (e.kind === "APPROVED" && e.announce) {
            // The merchant approved on their phone or the dashboard: the Soundbox says so.
            queue.current = queue.current.then(async () => {
              setScreen({ big: "Approved", small: e.title.replace(/^Approved: /, ""), tone: "ok" });
              const ctx = audioCtx();
              if (!ctx) return;
              listener.current?.mute(true);
              setPhase("speaking");
              try {
                await playMp3(ctx, (await api.announcement(e.id)).audio);
              } catch {
                // On screen anyway.
              } finally {
                listener.current?.mute(false);
                setPhase("idle");
              }
            });
          }
          continue;
        }
        if (e.kind !== "QR_PAYMENT") continue;
        if (e.data.sale_id) {
          const paid = { status: "RECORDED", payment_mode: "UPI", payment_status: "PAID", bill_number: e.data.bill_number as string } as const;
          setBill((b) => (b && b.id === e.data.sale_id ? { ...b, ...paid } : b));
          // The payment answered "paise diye ya udhaar?": stop waiting for a spoken answer.
          followUntil.current = 0;
          setAwaitingReply(false);
        }
        setLog((cur) => [{ id: e.id, heard: e.title, reply: e.announce ?? "", by: "" }, ...cur].slice(0, 6));
        queue.current = queue.current.then(async () => {
          setScreen({ big: rupees(e.data.amount as string), small: e.data.bill_number ? `Received · ${e.data.bill_number}` : "Received on Paytm", tone: "money" });
          const ctx = audioCtx();
          if (!ctx) return;
          listener.current?.mute(true);
          setPhase("speaking");
          try {
            await ding(ctx);
            const a = await api.announcement(e.id);
            await playMp3(ctx, a.audio);
          } catch {
            // The amount is on screen even if the voice can't play.
          } finally {
            listener.current?.mute(false);
            setPhase("idle");
          }
        });
      }
    });
    return () => {
      off();
      stop();
    };
  }, []);

  const sendTyped = async (e: FormEvent) => {
    e.preventDefault();
    const value = typed.trim();
    if (!value) return;
    setTyped("");
    queue.current = queue.current.then(async () => {
      setPhase("thinking");
      try {
        const followup = Date.now() < followUntil.current;
        // Typing stands in for the wake word.
        await show(await api.soundboxText(followup || /^\s*(hey\s+)?saa?thi\b/i.test(value) ? value : `Saathi, ${value}`, followup));
      } catch (err) {
        setPhase("idle");
        setError(err instanceof ApiError ? err.message : String(err));
      }
    });
  };

  const tapToTalk = () => {
    followUntil.current = Date.now() + FOLLOWUP_MS;
    setAwaitingReply(true);
    setScreen({ big: "Boliye", small: "Ab “Saathi” bolne ki zaroorat nahi", tone: "ask" });
  };

  const simulatePay = async () => {
    const amount = payAmount.trim();
    if (!amount) return;
    setPaying(true);
    try {
      // Paying the bill's amount pays that bill, like scanning its QR.
      const forBill = shown && isDue(shown) && Number(amount) === Number(shown.total) ? shown.id : undefined;
      await api.soundboxPay(amount, "Customer (DEMO)", forBill);
      setPayAmount("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPaying(false);
    }
  };

  const undo = async (entry: Entry) => {
    try {
      await api.soundboxUndo(entry.id);
      closeBill(entry.id);
      setScreen({ big: "Undo", small: `${entry.bill_number} hata diya`, tone: "warn" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  const ring = phase === "hearing" ? "ring-cyan" : phase === "checking" || phase === "thinking" ? "ring-amber" : phase === "speaking" ? "ring-green" : "ring-white/10";

  return (
    <div className="min-h-screen bg-linear-to-br from-[#EAF5FC] via-[#F5FAFE] to-[#E3EFFA] px-4 py-5 sm:px-8 sm:py-8">
      <header className="mx-auto mb-6 flex max-w-6xl items-center gap-3">
        <span className="text-2xl font-black tracking-tight text-navy">Pay<span className="text-cyan">tm</span></span>
        <span className="h-6 w-px bg-line" />
        <div className="min-w-0">
          <p className="truncate font-extrabold text-navy">{session?.merchant.display_name}</p>
          <p className="truncate text-xs text-muted">Soundbox &amp; QR · counter</p>
        </div>
        <span className="ml-auto rounded-full bg-violet-soft px-2.5 py-1 text-[11px] font-bold text-violet">DEMO PAYMENTS</span>
        <MicBadge mic={mic} started={started} />
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-12">
        {/* QR standee */}
        <section className="lg:col-span-5">
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between bg-navy px-6 py-4 text-white">
              <span className="text-2xl font-black tracking-tight">Pay<span className="text-cyan">tm</span></span>
              <span className="text-sm font-bold text-[#C9DDF5]">{shown ? "Your bill" : "Accepted here"}</span>
            </div>
            {shown ? (
              <BillCard key={shown.id} bill={shown} qr={billImage} shop={qr.data?.shop_name ?? session?.merchant.display_name ?? ""}
                onClose={() => closeBill(shown.id)} />
            ) : (
            <div className="flex flex-col items-center px-6 pt-6 pb-5">
              <p className="text-center text-lg font-extrabold">{qr.data?.shop_name ?? session?.merchant.display_name}</p>
              <p className="mb-4 text-xs text-muted">{qr.data?.upi_label}</p>
              <div className="relative rounded-3xl border-4 border-cyan p-3">
                {qrImage
                  // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing for next/image to optimise
                  ? <img src={qrImage} alt="Shop payment QR (demo)" className="size-56 sm:size-64" />
                  : <div className="shimmer size-56 rounded-2xl sm:size-64" />}
              </div>
              <p className="mt-4 flex items-center gap-1.5 text-sm font-bold text-navy"><ScanLine className="size-4 text-cyan" /> Scan &amp; pay with any UPI app</p>
              <p className="mt-1 text-center text-[11px] text-muted">DEMO: scanning opens a practice pay page on this network. No real money moves.</p>
              <div className="mt-4 flex gap-2">
                {["UPI", "Paytm", "RuPay", "BHIM"].map((x) => <span key={x} className="rounded-md border border-line px-2 py-1 text-[11px] font-bold text-ink-soft">{x}</span>)}
              </div>
            </div>
            )}
            <div className="border-t border-line bg-bg px-5 py-4">
              <p className="mb-2 text-xs font-bold text-ink-soft">No phone handy? Simulate a customer payment</p>
              <div className="flex gap-2">
                <div className="flex h-11 min-w-0 flex-1 items-center rounded-xl border border-line bg-white px-3">
                  <span className="text-muted">₹</span>
                  <input value={payAmount} onChange={(e) => setPayAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal"
                    placeholder="420" aria-label="Payment amount" className="num h-full min-w-0 flex-1 bg-transparent pl-1 outline-none" />
                </div>
                <button onClick={() => void simulatePay()} disabled={!payAmount || paying}
                  className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-cyan px-4 text-sm font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
                  {paying && <Loader2 className="size-4 animate-spin" />} Customer pays
                </button>
              </div>
              {payUrl && <p className="mt-2 truncate text-[11px] text-muted">Pay page: {payUrl}</p>}
            </div>
          </div>
        </section>

        {/* Soundbox device + conversation */}
        <section className="space-y-6 lg:col-span-7">
          <div className="relative rounded-[32px] bg-linear-to-b from-[#1B2433] to-[#0E141F] p-5 text-white shadow-xl sm:p-6">
            <div className="flex items-center justify-between">
              <span className="text-lg font-black tracking-tight">Pay<span className="text-cyan">tm</span> <span className="font-semibold text-white/70">Soundbox</span></span>
              <span className="flex items-center gap-1.5 text-[11px] font-bold text-white/60"><Volume2 className="size-3.5" /> Saathi inside</span>
            </div>
            <div className={`mt-4 rounded-2xl border border-white/10 bg-[#0A2A3A] px-5 py-4 transition ${screen.tone === "money" ? "bg-[#0B3A2A]" : screen.tone === "ask" ? "bg-[#2E2A12]" : ""}`}>
              <p className={`num truncate text-4xl font-black tracking-tight sm:text-5xl ${screen.tone === "money" ? "text-[#5CF0A4]" : screen.tone === "ask" ? "text-[#FFD166]" : "text-[#7FE3FF]"}`}>{screen.big}</p>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm text-white/75">{screen.small}</p>
            </div>
            <div className="mt-5 flex items-center gap-5">
              <div className={`relative flex size-20 shrink-0 items-center justify-center rounded-full bg-white/5 ring-4 transition ${ring}`}>
                <span className="absolute inset-0 rounded-full bg-cyan/20 transition-transform duration-100" style={{ transform: `scale(${0.6 + level * 0.6})`, opacity: phase === "hearing" ? 1 : 0 }} />
                {phase === "checking" || phase === "thinking" ? <Loader2 className="relative size-7 animate-spin text-amber" />
                  : mic === "on" ? <Mic className="relative size-7" /> : <MicOff className="relative size-7 text-white/50" />}
              </div>
              <div className="speaker-grille h-20 flex-1 rounded-2xl" aria-hidden />
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <button onClick={tapToTalk} disabled={mic !== "on"}
                className={`inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition active:scale-[0.98] disabled:opacity-40 ${awaitingReply ? "bg-amber text-ink" : "bg-white text-navy"}`}>
                <Mic className="size-4" /> {awaitingReply ? "Listening for your answer" : "Tap to talk"}
              </button>
              <button onClick={() => setShowType((v) => !v)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-bold text-white transition hover:bg-white/15">
                <Keyboard className="size-4" /> Type
              </button>
            </div>
            {showType && (
              <form onSubmit={(e) => void sendTyped(e)} className="mt-3 flex gap-2">
                <input value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={300} autoFocus
                  placeholder={awaitingReply ? "Jawab, e.g. udhaar" : "atta liya Mukul ne"} aria-label="Type a command"
                  className="h-11 min-w-0 flex-1 rounded-xl bg-white/10 px-3 text-sm text-white outline-none placeholder:text-white/40 focus:bg-white/15" />
                <button type="submit" className="h-11 rounded-xl bg-cyan px-4 text-sm font-bold">Send</button>
              </form>
            )}
            {error && <p className="mt-3 rounded-lg bg-red/20 px-3 py-2 text-sm text-[#FFC9C9]">{error}</p>}
          </div>

          {approval && (
            <div className="reply-in card flex flex-wrap items-center gap-3 border border-[#FFD48A] bg-amber-soft p-4">
              <ShieldCheck className="size-6 shrink-0 text-amber" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-extrabold text-ink">Waiting for your approval</p>
                <p className="truncate text-sm text-ink-soft">{approval.title}{approval.amount ? ` · ${rupees(approval.amount)}` : ""}</p>
                <p className="text-[11px] text-muted">Nothing is ordered until you tap Approve (with your PIN) in the app or the dashboard.</p>
              </div>
              <a href={`/tasks/${approval.taskId}`} target="_blank" rel="noopener"
                className="inline-flex h-10 shrink-0 items-center rounded-xl bg-cyan px-4 text-sm font-bold text-white">Review &amp; approve</a>
            </div>
          )}

          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-extrabold">Conversation</h2>
              <span className="text-[11px] text-muted">Speech: Sarvam Saaras · understanding: Sarvam LLM · voice: Sarvam Bulbul</span>
            </div>
            {log.length === 0 ? (
              <p className="text-sm text-muted">Try: “Saathi, atta liya Mukul ne” · “Saathi, Priya ko do kilo cheeni di, paise de diye” · “Saathi, Mukul ne 200 diye” · “Saathi, cancel karo”</p>
            ) : (
              <ul className="space-y-3">
                {log.map((x) => (
                  <li key={x.id} className="reply-in text-sm">
                    <p className="text-ink-soft">“{x.heard}”</p>
                    <p className="mt-0.5 font-semibold text-navy">Saathi: {x.reply}</p>
                    {x.by && <p className="text-[10px] text-muted">understood by {x.by}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Today at the counter */}
        <section className="lg:col-span-12">
          <div className="card p-5">
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-extrabold">Today at the counter</h2>
              <span className="text-xs text-muted">Stock, khata and payments update in the app and dashboard instantly</span>
            </div>
            <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ["Sales", t?.total_sales, "text-ink"], ["Paytm UPI", t?.upi, "text-[#0083AD]"], ["Cash", t?.cash, "text-green"],
                ["On khata", t?.udhaar, "text-amber"], ["Khata collected", t?.khata_collected, "text-violet"],
              ].map(([label, value, color]) => (
                <div key={label} className="rounded-2xl bg-bg p-3">
                  <p className="text-[11px] font-semibold text-ink-soft">{label}</p>
                  <p className={`num mt-0.5 text-xl font-extrabold ${color}`}>{value == null ? "—" : rupees(value)}</p>
                </div>
              ))}
            </div>
            {!t ? <div className="shimmer h-24 rounded-2xl" /> : t.entries.length === 0 ? (
              <p className="text-sm text-muted">No counter entries yet today.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="num w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr className="border-b border-line"><th className="py-2 pr-3">Bill</th><th>Customer</th><th>Items</th><th className="text-right">Amount</th><th className="px-3">Payment</th><th /></tr>
                  </thead>
                  <tbody>
                    {t.entries.map((e) => (
                      <tr key={e.id} className={`border-b border-[#F1F4F8] last:border-0 ${e.status === "CANCELLED" ? "text-muted line-through" : ""}`}>
                        <td className="py-3 pr-3 font-bold whitespace-nowrap">{e.bill_number}</td>
                        <td className="whitespace-nowrap">{e.customer_name ?? "Walk-in"}</td>
                        <td>{e.kind === "PAYMENT" ? "Khata payment" : `${e.kind === "RETURN" ? "Return: " : ""}${e.lines.map((l) => `${l.name} ×${l.packs}`).join(", ")}`}</td>
                        <td className="text-right font-extrabold">{rupees(e.total)}</td>
                        <td className="px-3 whitespace-nowrap">
                          {e.status === "CANCELLED" ? "Undone" : <PayBadge mode={e.payment_mode} status={e.payment_status} />}
                        </td>
                        <td className="text-right">
                          {e.can_undo && (
                            <button onClick={() => void undo(e)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-red hover:bg-red-soft">
                              <Undo2 className="size-3.5" /> Undo
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </main>

      {!started && <StartOverlay onStart={() => void start()} />}
    </div>
  );
}

function BillCard({ bill, qr, shop, onClose }: { bill: Entry; qr: string | null; shop: string; onClose: () => void }) {
  const due = isDue(bill);
  return (
    <div className="reply-in px-6 pt-5 pb-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold">{shop}</p>
          <p className="num truncate text-xs text-muted">{bill.bill_number ?? "New bill"} · {bill.customer_name ?? "Walk-in"}</p>
        </div>
        <button onClick={onClose} aria-label="Close the bill and show the shop QR" className="-mt-1 -mr-2 rounded-lg p-2 text-muted hover:bg-bg">
          <X className="size-4" />
        </button>
      </div>
      <table className="num mt-4 w-full text-sm">
        <thead className="text-left text-[11px] text-muted">
          <tr className="border-b border-line"><th className="py-1.5 font-semibold">Item</th><th className="text-right font-semibold">Qty</th>
            <th className="text-right font-semibold">Rate</th><th className="text-right font-semibold">Amount</th></tr>
        </thead>
        <tbody>
          {bill.lines.map((l) => (
            <tr key={l.product_id} className="border-b border-[#F1F4F8]">
              <td className="py-2 pr-2"><p className="font-bold">{l.name}</p><p className="text-[11px] text-muted">{l.pack_label}</p></td>
              <td className="text-right">×{l.packs}</td>
              <td className="pl-2 text-right text-ink-soft">{rupees(l.unit_price)}</td>
              <td className="pl-2 text-right font-bold">{rupees(l.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="font-bold text-ink-soft">Total</span>
        <span className="num text-3xl font-black text-navy">{rupees(bill.total)}</span>
      </div>
      {due ? (
        <div className="mt-4 flex flex-col items-center">
          <div className="rounded-3xl border-4 border-cyan p-2.5">
            {qr
              // eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, nothing for next/image to optimise
              ? <img src={qr} alt={`Payment QR for ${rupees(bill.total)} (demo)`} className="size-44 sm:size-52" />
              : <div className="shimmer size-44 rounded-2xl sm:size-52" />}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-sm font-bold text-navy"><ScanLine className="size-4 text-cyan" /> Scan to pay {rupees(bill.total)}</p>
          <p className="mt-1 text-center text-[11px] text-muted">
            {bill.status === "PENDING" ? "Or tell Saathi: cash, or udhaar" : "UPI awaited · paying this QR closes the bill"}
          </p>
        </div>
      ) : bill.payment_mode === "UDHAAR" ? (
        <div className="toast-in mt-5 flex items-center gap-3 rounded-2xl bg-amber-soft p-4">
          <BookOpen className="size-8 shrink-0 text-amber" />
          <p className="text-sm font-bold">Written in {bill.customer_name}&apos;s khata</p>
        </div>
      ) : (
        <div className="toast-in mt-5 flex items-center gap-3 rounded-2xl bg-green-soft p-4">
          <CheckCircle2 className="size-8 shrink-0 text-green" />
          <p className="text-sm font-bold">Paid · {MODE_LABEL[bill.payment_mode ?? ""] ?? "Cash"}</p>
        </div>
      )}
    </div>
  );
}

function PayBadge({ mode, status }: { mode: string | null; status: string | null }) {
  const tone = status === "AWAITED" ? "bg-amber-soft text-amber" : mode === "UDHAAR" ? "bg-amber-soft text-amber" : mode === "UPI" ? "bg-cyan-soft text-[#0083AD]" : "bg-green-soft text-green";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${tone}`}>{status === "AWAITED" ? STATUS_LABEL.AWAITED : MODE_LABEL[mode ?? ""] ?? "—"}</span>;
}

function MicBadge({ mic, started }: { mic: Mic; started: boolean }) {
  if (!started) return null;
  const map: Record<Mic, [string, string]> = {
    on: ["Listening for “Saathi”", "bg-green-soft text-green"],
    off: ["Mic off", "bg-bg text-muted"],
    insecure: ["Mic needs https", "bg-red-soft text-red"],
    denied: ["Mic blocked", "bg-red-soft text-red"],
    error: ["Mic unavailable", "bg-red-soft text-red"],
  };
  const [label, cls] = map[mic];
  return <span className={`hidden rounded-full px-2.5 py-1 text-[11px] font-bold sm:inline ${cls}`}>{label}</span>;
}

function StartOverlay({ onStart }: { onStart: () => void }) {
  const secure = typeof window !== "undefined" && window.isSecureContext;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/70 p-4 backdrop-blur-sm">
      <div className="card toast-in w-full max-w-md p-7 text-center">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-2xl bg-cyan text-white"><Power className="size-8" /></span>
        <h1 className="text-xl font-extrabold">Start the Soundbox</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Saathi listens while this screen is open and acts only when a sentence starts with “Saathi”. Keep the iPad unlocked on its stand.
        </p>
        {!secure && (
          <p className="mt-3 rounded-xl bg-amber-soft p-3 text-left text-xs text-ink">
            This page is not on https, so the browser won’t allow the microphone. Payments and typed commands still work.
            Open the https address shown by <b>npm run soundbox</b> on the laptop to use voice.
          </p>
        )}
        <button onClick={onStart} className="mt-5 h-12 w-full rounded-xl bg-cyan text-base font-bold text-white transition active:scale-[0.98]">Start</button>
      </div>
    </div>
  );
}
