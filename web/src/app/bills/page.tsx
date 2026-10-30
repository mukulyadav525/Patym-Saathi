"use client";

import { CheckCircle2, Minus, Plus, Trash2, Upload } from "lucide-react";
import { useState } from "react";

import { Badge, Button, Card, PageTitle, StateBadge, useLoad } from "@/components/ui";
import { api, ApiError, plural, rupees, when, type S } from "@/lib/api";

const SAMPLE = "Gupta Distributors\nAtta 10kg x 4 @ 380 = 1520\nCheeni 1kg 10 42 420\nToor dal 1kg 3 150 450\nTotal 2390";
type Line = { product_id: string; name: string; pack_label: string; packs: number; unit_price: string | null };

export default function Bills() {
  const history = useLoad(api.bills);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<S["ReceiptOut"] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const load = (r: S["ReceiptOut"]) => {
    setDraft(r);
    setLines(r.lines.map((l) => ({ product_id: l.product_id, name: l.name, pack_label: l.pack_label, packs: l.packs, unit_price: l.unit_price ?? null })));
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setNotice(null);
    try { await fn(); } catch (e) { setNotice({ ok: false, text: e instanceof ApiError ? e.message : String(e) }); } finally { setBusy(null); }
  };
  const upload = (file: File) => run("photo", async () => {
    const form = new FormData();
    form.append("file", file);
    load(await api.billFromPhoto(form));
  });
  const confirm = () => run("confirm", async () => {
    if (!draft) return;
    const done = await api.confirmBill(draft.id, lines.map((l) => ({ product_id: l.product_id, packs: l.packs, unit_price: l.unit_price })));
    setNotice({ ok: true, text: `Stock updated: +${plural(done.lines.reduce((s, l) => s + l.packs, 0), "pack")}.` });
    setDraft(null);
    setText("");
    void history.reload();
  });
  const setPacks = (i: number, n: number) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, packs: Math.max(1, Math.min(1000, n)) } : l)));

  return (
    <>
      <PageTitle title="Bill to stock" sub="Saathi reads the bill; you check every line. Stock changes only when you confirm." />
      {notice && <p className={`mb-4 rounded-xl p-3 text-sm ${notice.ok ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>{notice.text}</p>}
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          {!draft ? (
            <Card>
              <label className="flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed border-[#BFE9FA] bg-[#F2FBFF] p-6 text-center hover:bg-cyan-soft">
                <Upload className="size-8 text-navy" />
                <span className="mt-2 font-bold">{busy === "photo" ? "Reading the bill…" : "Upload a bill photo or PDF"}</span>
                <span className="text-xs text-muted">Read with Sarvam Vision (needs the Sarvam key on the server)</span>
                <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              </label>
              <p className="my-4 text-center text-xs font-bold text-muted">OR TYPE / PASTE THE BILL</p>
              <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={SAMPLE} rows={6}
                className="w-full rounded-xl border border-line bg-[#FAFCFE] p-3 text-sm outline-cyan" aria-label="Bill text" />
              <div className="mt-3 flex gap-2">
                <Button kind="secondary" onClick={() => setText(SAMPLE)}>Use sample</Button>
                <Button className="ml-auto" loading={busy === "text"} disabled={text.trim().length < 3}
                  onClick={() => void run("text", async () => load(await api.billFromText(text)))}>Read bill</Button>
              </div>
            </Card>
          ) : (
            <Card>
              <div className="flex items-center justify-between"><h2 className="text-lg font-extrabold">{draft.supplier_name || "Supplier bill"}</h2><Badge tone="cyan">{draft.source === "PHOTO" ? "From photo" : "Typed"}</Badge></div>
              <p className="text-sm text-muted">Change packs or remove anything wrong.</p>
              {lines.length === 0 && <p className="mt-3 text-sm text-muted">No items recognised. Discard and type the lines.</p>}
              {lines.map((l, i) => (
                <div key={`${l.product_id}-${i}`} className="flex items-center gap-3 border-b border-line py-3">
                  <div className="flex-1"><p className="font-bold">{l.name}</p><p className="num text-xs text-muted">{l.pack_label}{l.unit_price ? ` · ${rupees(l.unit_price)} each` : " · price not read"}</p></div>
                  <div className="flex items-center rounded-full border border-line">
                    <button className="p-2" aria-label={`Fewer ${l.name}`} onClick={() => setPacks(i, l.packs - 1)}><Minus className="size-4" /></button>
                    <span className="num w-8 text-center font-extrabold">{l.packs}</span>
                    <button className="p-2" aria-label={`More ${l.name}`} onClick={() => setPacks(i, l.packs + 1)}><Plus className="size-4" /></button>
                  </div>
                  <button aria-label={`Remove ${l.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))} className="p-2 text-red"><Trash2 className="size-4" /></button>
                </div>
              ))}
              {draft.unmatched.length > 0 && (
                <div className="mt-3 rounded-xl bg-amber-soft p-3 text-xs"><p className="font-bold text-amber">Not recognised (ignored):</p>{draft.unmatched.map((u, i) => <p key={i} className="truncate text-ink-soft">• {u}</p>)}</div>
              )}
              {draft.bill_total && <p className="num mt-2 text-xs text-muted">Bill printed total {rupees(draft.bill_total)} · lines read {rupees(draft.total)}</p>}
              <div className="mt-4 flex gap-2">
                <Button kind="ghost" onClick={() => void run("discard", async () => { await api.discardBill(draft.id); setDraft(null); void history.reload(); })}>Discard</Button>
                <Button className="ml-auto" loading={busy === "confirm"} disabled={lines.length === 0} onClick={() => void confirm()}>
                  <CheckCircle2 className="size-4" /> Add {lines.reduce((s, l) => s + l.packs, 0)} packs to stock
                </Button>
              </div>
            </Card>
          )}
        </div>
        <Card className="lg:col-span-2">
          <h2 className="mb-2 font-extrabold">Recent bills</h2>
          {(history.data ?? []).length === 0 ? <p className="text-sm text-muted">No bills yet.</p> : (history.data ?? []).map((r) => (
            <div key={r.id} className="flex items-center justify-between border-t border-line py-2 first:border-0">
              <div><p className="font-semibold">{r.supplier_name || "Supplier bill"}</p><p className="text-xs text-muted">{r.lines.reduce((s, l) => s + l.packs, 0)} packs · {when(r.created_at)}</p></div>
              {r.status === "DRAFT" ? <button className="text-sm font-bold text-[#0083AD]" onClick={() => load(r)}>Review</button> : <StateBadge state={r.status} />}
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
