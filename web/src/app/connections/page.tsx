"use client";

import { useState } from "react";

import { Badge, Button, Card, ErrorBox, PageTitle, SimBadge, Skeleton, useLoad } from "@/components/ui";
import { api, ApiError, when } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const MODE_TONE = { LIVE: "green", STAGING: "cyan", DEMO: "violet", SAMPLE: "violet", SIMULATED: "violet", OFF: "red" } as const;

export default function Connections() {
  const { session } = useAuth();
  const conns = useLoad(api.connections);
  const tools = useLoad(api.tools);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const demo = session?.demo_mode && session.user.role === "DEMO_ADMIN";

  const reset = async () => {
    if (!window.confirm("Reset demo data? This restores the seeded scenario and clears tasks and orders.")) return;
    setBusy(true);
    try {
      setMsg((await api.demoReset()).message);
      await conns.reload();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageTitle title="Connections & consent" sub="What Saathi can see, and whether each source is live, demo or simulated." />
      {conns.error && !conns.data ? <ErrorBox error={conns.error} onRetry={conns.reload} /> : !conns.data ? <Skeleton /> : (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {conns.data.map((c) => (
            <Card key={c.source}>
              <div className="flex items-center justify-between"><b>{c.source}</b><Badge tone={MODE_TONE[c.mode as keyof typeof MODE_TONE] ?? "muted"}>{c.mode}</Badge></div>
              <p className="mt-1 text-sm text-ink-soft">{c.description}</p>
              <p className="mt-2 text-[11px] text-muted">{c.consent_granted_at ? `Consent recorded ${when(c.consent_granted_at)}` : "Not connected — no consent recorded"}</p>
            </Card>
          ))}
        </div>
      )}

      <h2 className="mb-3 text-lg font-extrabold">Agent tools</h2>
      <p className="mb-3 text-sm text-muted">The LLM never touches money directly. It may only call read tools; write tools need a one-time approval token, and payment verification is system-only.</p>
      {tools.data && (
        <div className="card mb-8 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted"><tr className="border-b border-line"><th className="p-4">Tool</th><th>What it does</th><th>Source</th><th>Side effect</th><th>Approval</th><th className="p-4">LLM may call</th></tr></thead>
            <tbody>
              {tools.data.map((t) => (
                <tr key={t.name} className="border-b border-[#F1F4F8] last:border-0">
                  <td className="p-4 font-mono text-xs">{t.name}</td><td>{t.does}</td><td className="text-xs">{t.source}</td><td>{t.side_effect}</td>
                  <td><Badge tone={t.approval === "No" ? "muted" : "amber"}>{t.approval}</Badge></td>
                  <td className="p-4">{t.llm_callable ? <Badge tone="green">Yes</Badge> : <Badge tone="red">No</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {demo && (
        <Card className="border border-dashed border-violet">
          <SimBadge>DEMO CONTROLS</SimBadge>
          <p className="my-2 text-sm text-ink-soft">Restore the seeded scenario: ₹4,650 plan → oil shortage → ₹4,850 re-plan; INV-1042 ₹1,200.</p>
          <Button kind="secondary" loading={busy} onClick={reset}>Reset demo data</Button>
          {msg && <p className="mt-2 text-sm text-ink-soft">{msg}</p>}
        </Card>
      )}
    </>
  );
}
