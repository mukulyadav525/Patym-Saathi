"use client";

import { Copy, Share2, Tag } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, Empty, ErrorBox, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, ApiError, rupees, when, type S } from "@/lib/api";
import { copyText, shareText } from "@/lib/share";

const LANGS = [["hi-IN", "Hinglish"], ["en-IN", "English"], ["ta-IN", "தமிழ்"], ["bn-IN", "বাংলা"], ["mr-IN", "मराठी"], ["gu-IN", "ગુજરાતી"], ["te-IN", "తెలుగు"], ["kn-IN", "ಕನ್ನಡ"]];

export default function Offers() {
  const slow = useLoad(api.slowMovers);
  const offers = useLoad(api.offers);
  const [discounts, setDiscounts] = useState<Record<string, number>>({});
  const [active, setActive] = useState<S["OfferOut"] | null>(null);
  const [lang, setLang] = useState("hi-IN");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const open = (o: S["OfferOut"]) => { setActive(o); setLang("hi-IN"); setText(o.message); };
  const draft = async (item: S["SlowMoverOut"]) => {
    setBusy(item.product_id);
    setNotice(null);
    try {
      open(await api.createOffer(item.product_id, discounts[item.product_id] ?? item.suggested_discount));
      void offers.reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const translate = async (code: string) => {
    if (!active) return;
    setLang(code);
    if (code === "hi-IN") return setText(active.message);
    setBusy("lang");
    try {
      setText((await api.translate("OFFER", active.id, code)).text);
    } catch (e) {
      setLang("hi-IN");
      setText(active.message);
      setNotice(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const share = async () => {
    if (!active) return;
    const how = await shareText(text);
    if (how === "failed") return setNotice("Couldn't share or copy. Select the message and copy it manually.");
    if (how === "copied") setNotice("Offer copied. Paste it into your message app.");
    await api.offerShared(active.id).catch(() => undefined);
    void offers.reload();
  };

  return (
    <>
      <PageTitle title="Slow stock → offers" sub="Items that stopped selling tie up cash. Saathi drafts the offer; you share it. Saathi never messages customers." />
      {notice && <p className="mb-4 rounded-xl bg-cyan-soft p-3 text-sm text-navy">{notice}</p>}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {slow.error && !slow.data ? <ErrorBox error={slow.error} onRetry={slow.reload} /> : !slow.data ? <Skeleton /> :
            slow.data.length === 0 ? <Card><Empty title="Nothing is stuck" body="All items are selling at their usual pace." /></Card> :
              slow.data.map((item) => {
                const d = discounts[item.product_id] ?? item.suggested_discount;
                return (
                  <Card key={item.product_id}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-extrabold">{item.name} <span className="text-sm font-normal text-muted">· {item.pack_label}</span></p>
                        <p className="text-sm text-ink-soft">{item.reason}</p>
                      </div>
                      <div className="flex h-10 items-end gap-1" aria-label="Last 4 weeks of sales">
                        {item.weekly_sales.map((v, i) => (
                          <span key={i} className={`w-3 rounded-sm ${i === 3 ? "bg-cyan" : "bg-[#A9E3F8]"}`} style={{ height: `${Math.max(8, (v / Math.max(...item.weekly_sales, 1)) * 100)}%` }} />
                        ))}
                      </div>
                    </div>
                    <div className="num mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">In stock</p><p className="font-extrabold">{item.stock}</p></div>
                      <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">Cash tied up</p><p className="font-extrabold">{rupees(item.cash_tied_up)}</p></div>
                      <div className="rounded-xl bg-bg p-3"><p className="text-xs text-muted">Price</p><p className="font-extrabold">{rupees(item.sell_price)}</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {[10, 15, 20].map((v) => (
                        <button key={v} onClick={() => setDiscounts({ ...discounts, [item.product_id]: v })}
                          className={`h-9 rounded-full border px-4 text-sm font-bold ${d === v ? "border-cyan bg-cyan text-white" : "border-line text-ink-soft hover:bg-bg"}`}>{v}% off</button>
                      ))}
                      <Button className="ml-auto" loading={busy === item.product_id} onClick={() => void draft(item)}><Tag className="size-4" /> Draft offer</Button>
                    </div>
                    <p className="mt-2 text-[11px] text-muted">Never priced below your cost + 5%{item.unit_cost ? ` (cost ${rupees(item.unit_cost)})` : ""}.</p>
                  </Card>
                );
              })}
        </div>
        <div className="space-y-4 lg:col-span-2">
          {active && (
            <Card className="border border-[#BFE9FA]">
              <div className="flex items-center justify-between"><h2 className="font-extrabold">Offer · {active.product_name}</h2><span className="num font-extrabold text-green">{rupees(active.offer_price)}</span></div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {LANGS.map(([code, label]) => (
                  <button key={code} onClick={() => void translate(code)} className={`h-8 rounded-full border px-3 text-xs font-bold ${lang === code ? "border-navy bg-navy text-white" : "border-line text-ink-soft"}`}>{label}</button>
                ))}
              </div>
              <p className={`mt-3 rounded-xl bg-[#F2FBFF] p-3 text-sm leading-relaxed ${busy === "lang" ? "opacity-40" : ""}`}>{text}</p>
              <p className="mt-1 text-[11px] text-muted">{lang === "hi-IN" ? "Drafted by Saathi from your prices." : "Translated; check before sharing."}</p>
              <div className="mt-3 flex gap-2">
                <Button kind="secondary" className="flex-1" onClick={() => void copyText(text).then((ok) => setNotice(ok ? "Offer copied." : "Couldn't copy. Select the message and copy it manually."))}><Copy className="size-4" /> Copy</Button>
                <Button className="flex-1" onClick={() => void share()}><Share2 className="size-4" /> Share</Button>
              </div>
            </Card>
          )}
          <Card>
            <h2 className="mb-2 font-extrabold">Your offers</h2>
            {(offers.data ?? []).length === 0 ? <p className="text-sm text-muted">No offers yet.</p> : (offers.data ?? []).map((o) => (
              <button key={o.id} onClick={() => open(o)} className="flex w-full items-center justify-between border-t border-line py-2 text-left first:border-0">
                <span><span className="font-semibold">{o.product_name}</span> <span className="num text-sm text-muted">{rupees(o.offer_price)} · {o.discount_pct}% · {when(o.created_at)}</span></span>
                <Badge tone={o.status === "SHARED" ? "green" : "muted"}>{o.status === "SHARED" ? "Shared" : "Draft"}</Badge>
              </button>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
