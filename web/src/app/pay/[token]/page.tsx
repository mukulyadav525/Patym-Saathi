"use client";

import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";

import { api, ApiError, rupees, type S } from "@/lib/api";

const QUICK = ["50", "100", "200", "420", "500"];
const CLOSED: Record<string, string> = {
  PAID: "This bill is already paid.",
  ON_KHATA: "This bill was written in your khata. Ask the shopkeeper if you want to pay it now.",
  CANCELLED: "This bill was cancelled. Ask the shopkeeper for a new one.",
};

/** What a customer sees after scanning the shop QR, or a bill's own QR (?bill=, amount fixed to the bill).
 * DEMO: practice payment, no money moves. */
export default function PayPage() {
  const { token } = useParams<{ token: string }>();
  const [shop, setShop] = useState<S["PayPageInfo"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [payer, setPayer] = useState("");
  const [busy, setBusy] = useState(false);
  const [paid, setPaid] = useState<S["QrPaymentOut"] | null>(null);

  useEffect(() => {
    const billId = new URLSearchParams(window.location.search).get("bill");
    api.payInfo(token, billId).then((info) => {
      setShop(info);
      if (info.bill) setAmount(String(Number(info.bill.total)));
    }, (e) => setError(e instanceof ApiError ? e.message : "This QR is not valid"));
  }, [token]);
  const bill = shop?.bill ?? null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setPaid(await api.pay(token, amount, payer.trim(), bill?.id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col bg-bg">
      <header className="flex items-center justify-between bg-navy px-5 py-4 text-white">
        <span className="text-2xl font-black tracking-tight">Pay<span className="text-cyan">tm</span></span>
        <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold">DEMO · no real money</span>
      </header>

      <div className="mx-auto w-full max-w-sm flex-1 px-4 py-6">
        {!shop && !error && <div className="shimmer h-40 rounded-[18px]" />}
        {error && !shop && <p className="card p-5 text-center text-sm text-red">{error}</p>}

        {shop && paid && (
          <div className="card toast-in p-7 text-center">
            <CheckCircle2 className="mx-auto size-16 text-green" />
            <p className="num mt-3 text-4xl font-black">{rupees(paid.amount)}</p>
            <p className="mt-1 font-bold">Paid to {shop.shop_name}</p>
            <p className="mt-1 text-xs text-muted">{paid.bill_number ? `Bill ${paid.bill_number} · ` : ""}{paid.txn_id} · DEMO</p>
            <p className="mt-4 text-sm text-ink-soft">The shop&apos;s Soundbox announces it now.</p>
            {!bill && (
              <button onClick={() => { setPaid(null); setAmount(""); }} className="mt-5 h-11 w-full rounded-xl border border-line text-sm font-bold text-navy">
                Pay again
              </button>
            )}
          </div>
        )}

        {shop && !paid && bill && bill.status !== "DUE" && (
          <p className="card p-5 text-center text-sm text-ink-soft">{CLOSED[bill.status]}</p>
        )}

        {shop && !paid && (!bill || bill.status === "DUE") && (
          <form onSubmit={(e) => void submit(e)} className="card p-6">
            <div className="mb-5 flex items-center gap-3">
              <span className="flex size-12 items-center justify-center rounded-full bg-cyan-soft text-lg font-extrabold text-navy">{shop.shop_name.charAt(0)}</span>
              <div className="min-w-0">
                <p className="truncate font-extrabold">{shop.shop_name}</p>
                <p className="truncate text-xs text-muted">{shop.locality}</p>
              </div>
            </div>
            {bill ? (
              <div className="rounded-2xl bg-bg p-4">
                <p className="mb-2 text-xs font-bold text-ink-soft">{bill.bill_number ? `Bill ${bill.bill_number}` : "Your bill"}</p>
                <ul className="num space-y-1.5 text-sm">
                  {bill.lines.map((l) => (
                    <li key={l.product_id} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{l.name} <span className="text-muted">{l.pack_label} ×{l.packs}</span></span>
                      <span className="shrink-0 font-bold">{rupees(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
                  <span className="font-bold text-ink-soft">Total</span>
                  <span className="num text-3xl font-black">{rupees(bill.total)}</span>
                </div>
              </div>
            ) : (
              <>
                <label htmlFor="amount" className="text-xs font-bold text-ink-soft">Amount</label>
                <div className="mt-1 flex h-16 items-center rounded-2xl border-2 border-cyan bg-white px-4">
                  <span className="text-3xl font-black text-muted">₹</span>
                  <input id="amount" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, "").slice(0, 8))}
                    inputMode="decimal" autoFocus placeholder="0" className="num h-full min-w-0 flex-1 bg-transparent pl-2 text-3xl font-black outline-none" />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK.map((q) => (
                    <button key={q} type="button" onClick={() => setAmount(q)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-bold ${amount === q ? "border-cyan bg-cyan-soft text-navy" : "border-line text-ink-soft"}`}>₹{q}</button>
                  ))}
                </div>
              </>
            )}
            <label htmlFor="payer" className="mt-5 block text-xs font-bold text-ink-soft">Your name (optional)</label>
            <input id="payer" value={payer} onChange={(e) => setPayer(e.target.value)} maxLength={40} placeholder="e.g. Mukul"
              className="mt-1 h-11 w-full rounded-xl border border-line bg-[#FAFCFE] px-3 outline-cyan" />
            {error && <p className="mt-3 rounded-lg bg-red-soft p-2 text-sm text-red">{error}</p>}
            <button type="submit" disabled={!amount || Number(amount) <= 0 || busy}
              className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan text-base font-bold text-white transition active:scale-[0.98] disabled:opacity-50">
              {busy && <Loader2 className="size-5 animate-spin" />} Pay {amount ? rupees(amount) : ""}
            </button>
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted"><ShieldCheck className="size-3.5" /> Practice payment for the prototype. Nothing is charged.</p>
          </form>
        )}
      </div>
    </main>
  );
}
