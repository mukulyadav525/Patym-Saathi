"use client";

import Link from "next/link";
import { useState } from "react";

import { Badge, Button, Empty, ErrorBox, PageTitle, Skeleton, useLoad } from "@/components/ui";
import { api, when, type S } from "@/lib/api";

export default function Audit() {
  const { data, setData, error, reload } = useLoad(() => api.audit(), [], 15000);
  const [hideStates, setHideStates] = useState(true);
  const [more, setMore] = useState(false);
  const items = (data?.items ?? []).filter((e) => !hideStates || e.event_type !== "TASK_STATE");

  const loadMore = async () => {
    if (!data?.next_cursor) return;
    setMore(true);
    try {
      const page = await api.audit(data.next_cursor);
      setData({ items: [...data.items, ...page.items] as S["AuditOut"][], next_cursor: page.next_cursor });
    } finally {
      setMore(false);
    }
  };

  return (
    <>
      <PageTitle title="Audit history" sub="Append-only log of every plan, approval, state change and adapter call."
        right={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hideStates} onChange={(e) => setHideStates(e.target.checked)} /> Hide state transitions</label>} />
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : items.length === 0 ? (
        <div className="card"><Empty title="No activity yet" /></div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line"><th className="p-4">Time</th><th>Event</th><th>Summary</th><th>Actor</th><th className="p-4">Task</th></tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-[#F1F4F8] align-top last:border-0">
                  <td className="num p-4 text-xs whitespace-nowrap text-muted">{when(e.created_at)}</td>
                  <td className="py-4"><Badge tone={e.event_type.includes("APPROV") ? "amber" : e.event_type.includes("ORDER") ? "violet" : "cyan"}>{e.event_type}</Badge></td>
                  <td className="py-4 pr-4">{e.summary}</td>
                  <td className="py-4 text-xs">{e.actor.length > 20 ? "merchant" : e.actor}</td>
                  <td className="p-4">{e.task_id && <Link href={`/tasks/${e.task_id}`} className="text-xs font-bold text-[#0083AD]">open</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.next_cursor && <div className="p-4"><Button kind="secondary" loading={more} onClick={loadMore}>Load more</Button></div>}
        </div>
      )}
    </>
  );
}
