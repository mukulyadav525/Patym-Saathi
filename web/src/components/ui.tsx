"use client";

import { AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { ApiError } from "@/lib/api";

type Tone = "cyan" | "green" | "amber" | "red" | "violet" | "muted" | "navy";
const TONE: Record<Tone, string> = {
  cyan: "bg-cyan-soft text-[#0083AD]",
  navy: "bg-cyan-soft text-navy",
  green: "bg-green-soft text-green",
  amber: "bg-amber-soft text-amber",
  red: "bg-red-soft text-red",
  violet: "bg-violet-soft text-violet",
  muted: "bg-[#EEF2F7] text-ink-soft",
};

const STATE_TONE: Record<string, Tone> = {
  AWAITING_APPROVAL: "amber", PENDING: "amber", DRAFTED: "amber", EXCEPTION: "red", FAILED: "red",
  RECONCILIATION_REQUIRED: "red", CANCELLED: "muted", REJECTED: "muted", SUPERSEDED: "muted", EXPIRED: "muted",
  COMPLETED: "green", PAID: "green", VERIFIED: "green", CONSUMED: "green", ACCEPTED: "green", GOODS_RECEIVED: "green",
  PARTIALLY_COMPLETED: "violet", PARTIALLY_ACCEPTED: "violet", SENT: "cyan", VERIFYING: "cyan",
};
const STATE_LABEL: Record<string, string> = {
  AWAITING_APPROVAL: "Needs approval", VERIFYING: "Tracking", PARTIALLY_COMPLETED: "Partly done",
  PARTIALLY_ACCEPTED: "Partly accepted", GOODS_RECEIVED: "Received", RECONCILIATION_REQUIRED: "Check payment", CONSUMED: "Approved",
};
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, " ");

export function Badge({ children, tone = "cyan" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${TONE[tone]}`}>{children}</span>;
}
export const StateBadge = ({ state }: { state: string }) => <Badge tone={STATE_TONE[state] ?? "cyan"}>{stateLabel(state)}</Badge>;
export const SimBadge = ({ children = "SIMULATED" }: { children?: ReactNode }) => <Badge tone="violet">⚗ {children}</Badge>;

export function Button({
  children, onClick, kind = "primary", loading, disabled, className = "", type = "button",
}: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean;
  disabled?: boolean; className?: string; type?: "button" | "submit";
}) {
  const k = {
    primary: "bg-cyan text-white hover:brightness-95",
    secondary: "bg-white text-navy border border-line hover:bg-bg",
    danger: "bg-white text-red border border-[#F3C5C5] hover:bg-red-soft",
    ghost: "text-navy hover:bg-cyan-soft",
  }[kind];
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:opacity-50 ${k} ${className}`}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card p-5 ${className}`}>{children}</div>;
}

export function PageTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {right}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <Card className="flex flex-col items-center py-10 text-center">
      <AlertCircle className="size-10 text-red" />
      <p className="mt-3 font-bold">{error.code === "NETWORK" ? "Can't reach Saathi" : "Something went wrong"}</p>
      <p className="mt-1 text-sm text-muted">{error.message}</p>
      {onRetry && <Button kind="secondary" className="mt-4" onClick={onRetry}><RefreshCw className="size-4" /> Retry</Button>}
    </Card>
  );
}

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <div className="py-12 text-center">
      <p className="font-bold">{title}</p>
      {body && <p className="mt-1 text-sm text-muted">{body}</p>}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-2xl bg-white" />)}
    </div>
  );
}

/** Load on mount + every `pollMs`; keeps last good data on failure. Responses that arrive after a newer
 * request was started (deps changed, poll overlapped) are dropped so stale data never overwrites fresh. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = [], pollMs = 0) {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const loaderRef = useRef(loader);
  useLayoutEffect(() => {
    loaderRef.current = loader;
  });
  const seq = useRef(0);
  const depKey = JSON.stringify(deps);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const value = await loaderRef.current();
      if (mine !== seq.current) return;
      setDataState(value);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    }
  }, []);
  // Data set by the caller (e.g. an approval result) wins over any load still in flight.
  const setData = useCallback((value: T | null) => {
    seq.current += 1;
    setDataState(value);
  }, []);
  // Re-run when the caller's deps change (compared by value) or the poll interval changes.
  useEffect(() => {
    void run();
    if (!pollMs) return;
    const t = setInterval(() => void run(), pollMs);
    return () => clearInterval(t);
  }, [run, pollMs, depKey]);
  return { data, setData, error, reload: run };
}
