"use client";

import { Link2, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Empty, ErrorBox, PageTitle, Skeleton, StateBadge, useLoad } from "@/components/ui";
import { api, rupees, when } from "@/lib/api";

const GROUPS = [
  { key: "NEEDS_APPROVAL", label: "Needs approval" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "DONE", label: "Done" },
] as const;

export default function Inbox() {
  const { data, error, reload } = useLoad(api.tasks, [], 10000);
  const [group, setGroup] = useState<(typeof GROUPS)[number]["key"]>("NEEDS_APPROVAL");
  const items = (data ?? []).filter((t) => t.group === group);

  return (
    <>
      <PageTitle title="Task inbox" sub="Approve, track and follow up. Same tasks as the Android app." />
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {GROUPS.map((g) => {
          const n = (data ?? []).filter((t) => t.group === g.key).length;
          const on = g.key === group;
          return (
            <button key={g.key} role="tab" aria-selected={on} onClick={() => setGroup(g.key)}
              className={`rounded-full border px-4 py-2 text-sm font-bold ${on ? "border-cyan bg-cyan text-white" : "border-line bg-white text-ink-soft"}`}>
              {g.label} <span className="ml-1 opacity-80">{n}</span>
            </button>
          );
        })}
      </div>
      {error && !data ? <ErrorBox error={error} onRetry={reload} /> : !data ? <Skeleton /> : items.length === 0 ? (
        <div className="card"><Empty title="Nothing here" body="Ask Saathi from the Overview page or the Android app." /></div>
      ) : (
        <div className="card divide-y divide-line">
          {items.map((t) => {
            const restock = t.task_type === "RESTOCK";
            const Icon = restock ? ShoppingCart : Link2;
            return (
              <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-4 p-4 hover:bg-bg">
                <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${restock ? "bg-red-soft text-red" : "bg-cyan-soft text-cyan"}`}>
                  <Icon className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{t.title}</p>
                  <p className="truncate text-xs text-muted">“{t.input_text}” · {when(t.updated_at)} · {t.input_channel.toLowerCase()}</p>
                  {t.result_note && <p className="mt-1 truncate text-xs text-ink-soft">{t.result_note}</p>}
                </div>
                <span className="num hidden text-lg font-extrabold sm:block">{rupees(t.amount)}</span>
                <StateBadge state={t.state} />
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
