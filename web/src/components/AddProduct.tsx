"use client";

import { PackagePlus, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { ApiError } from "@/lib/api";

export type ProductDraft = {
  name: string; name_hi: string; pack_label: string; sell_price: string; opening_stock: string; cost_price: string;
};

const field = "mt-1 h-10 w-full rounded-xl border border-line bg-[#FAFCFE] px-3 text-sm outline-cyan";

/** New item form, used by Inventory (counted stock) and by a supplier bill (packs arrive with the bill). */
export function AddProductForm({ title, initial, stockLabel = "Opening stock (packs)", submitLabel = "Add product", note, onSubmit, onClose }: {
  title: string; initial?: Partial<ProductDraft>; stockLabel?: string; submitLabel?: string; note?: string;
  onSubmit: (d: ProductDraft) => Promise<void>; onClose: () => void;
}) {
  const [d, setD] = useState<ProductDraft>({
    name: "", name_hi: "", pack_label: "1 pack", sell_price: "", opening_stock: "0", cost_price: "", ...initial,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof ProductDraft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const money = (k: "sell_price" | "cost_price") => (e: { target: { value: string } }) =>
    setD({ ...d, [k]: e.target.value.replace(/[^\d.]/g, "").slice(0, 9) });
  const margin = d.sell_price && d.cost_price ? Number(d.sell_price) - Number(d.cost_price) : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(d);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="reply-in card mb-6 border border-cyan/40 p-5">
      <div className="mb-4 flex items-center gap-2">
        <PackagePlus className="size-5 text-cyan" />
        <h2 className="font-extrabold">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto rounded-lg p-1.5 text-muted hover:bg-bg"><X className="size-4" /></button>
      </div>
      {note && <p className="mb-4 rounded-xl bg-bg p-3 text-xs text-ink-soft">{note}</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-bold text-ink-soft">Name
          <input value={d.name} onChange={set("name")} required minLength={2} maxLength={60} placeholder="Parle-G Biscuit" className={field} />
        </label>
        <label className="text-xs font-bold text-ink-soft">Name in Hindi <span className="font-normal text-muted">(optional)</span>
          <input value={d.name_hi} onChange={set("name_hi")} maxLength={60} placeholder="पारले-जी बिस्कुट" className={field} />
        </label>
        <label className="text-xs font-bold text-ink-soft">Pack size
          <input value={d.pack_label} onChange={set("pack_label")} maxLength={40} placeholder="800 g, 1 kg, 12-pack" className={field} />
        </label>
        <label className="text-xs font-bold text-ink-soft">Selling price (₹ per pack)
          <input value={d.sell_price} onChange={money("sell_price")} required inputMode="decimal" placeholder="90" className={`num ${field}`} />
        </label>
        <label className="text-xs font-bold text-ink-soft">Cost price (₹ per pack) <span className="font-normal text-muted">(optional)</span>
          <input value={d.cost_price} onChange={money("cost_price")} inputMode="decimal" placeholder="78" className={`num ${field}`} />
        </label>
        <label className="text-xs font-bold text-ink-soft">{stockLabel}
          <input value={d.opening_stock} onChange={(e) => setD({ ...d, opening_stock: e.target.value.replace(/\D/g, "").slice(0, 5) })}
            inputMode="numeric" className={`num ${field}`} />
        </label>
      </div>
      {margin !== null && (
        <p className={`mt-3 text-xs font-semibold ${margin >= 0 ? "text-green" : "text-red"}`}>
          {margin >= 0 ? `Profit ₹${margin.toLocaleString("en-IN")} per pack` : "Cost is above the selling price"}
        </p>
      )}
      {error && <p className="mt-3 rounded-lg bg-red-soft p-2 text-sm text-red">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
        <Button type="submit" loading={busy} disabled={!d.name.trim() || !d.sell_price}>{submitLabel}</Button>
      </div>
    </form>
  );
}
