"use client";

import { CheckCircle2, IndianRupee, ReceiptText, ShieldCheck, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { onLive, startLive, type LiveEvent } from "@/lib/live";

const ICON = { QR_PAYMENT: IndianRupee, COUNTER_UNDO: Undo2, APPROVAL_NEEDED: ShieldCheck, APPROVED: CheckCircle2 } as const;
const SHOW_MS = 6000;

/** Bottom-right cards for what just happened at the counter, so a change on the Soundbox is visible here at once. */
export function LiveToasts() {
  const [items, setItems] = useState<LiveEvent[]>([]);

  useEffect(() => {
    const stop = startLive();
    const off = onLive((events) => setItems((cur) => [...events, ...cur].slice(0, 3)));
    return () => {
      off();
      stop();
    };
  }, []);

  useEffect(() => {
    if (!items.length) return;
    const t = setTimeout(() => setItems((cur) => cur.slice(0, -1)), SHOW_MS);
    return () => clearTimeout(t);
  }, [items]);

  if (!items.length) return null;
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {items.map((e) => {
        const Icon = ICON[e.kind as keyof typeof ICON] ?? ReceiptText;
        const money = e.kind === "QR_PAYMENT" || e.kind === "APPROVED";
        const ask = e.kind === "APPROVAL_NEEDED";
        const taskId = typeof e.data.task_id === "string" ? e.data.task_id : null;
        return (
          <div key={e.id} className="toast-in pointer-events-auto flex gap-3 rounded-2xl bg-navy p-3 pr-2 text-white shadow-lg">
            <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${money ? "bg-green" : ask ? "bg-amber" : "bg-cyan"}`}>
              <Icon className="size-4" />
            </span>
            {taskId ? (
              <Link href={`/tasks/${taskId}`} className="min-w-0 flex-1" onClick={() => setItems((cur) => cur.filter((x) => x.id !== e.id))}>
                <p className="text-sm font-bold">{e.title}</p>
                <p className="truncate text-xs text-[#C9DDF5]">{ask ? "Tap to review and approve" : e.body}</p>
              </Link>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">{e.title}</p>
                <p className="truncate text-xs text-[#C9DDF5]">{e.body}</p>
              </div>
            )}
            <button onClick={() => setItems((cur) => cur.filter((x) => x.id !== e.id))} aria-label="Dismiss"
              className="self-start rounded-full p-1 text-[#C9DDF5] hover:bg-white/10"><X className="size-4" /></button>
          </div>
        );
      })}
    </div>
  );
}
