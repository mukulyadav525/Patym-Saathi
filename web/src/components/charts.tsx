import type { Dashboard } from "@/lib/api";
import { rupees } from "@/lib/api";

const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

// Weekly sales as plain HTML bars (no chart dependency): text stays at its real size at every width.
// Bars grow in on mount; the latest week is in brand cyan.
export function SalesBars({ weeks }: { weeks: Dashboard["weekly_sales"] }) {
  const max = Math.max(...weeks.map((w) => Number(w.revenue)), 1);
  return (
    <div role="img" aria-label="Weekly sales, last four weeks" className="relative pt-2">
      <div className="pointer-events-none absolute inset-x-0 top-8 bottom-7 flex flex-col justify-between" aria-hidden>
        {[0, 1, 2, 3].map((i) => <span key={i} className="border-t border-dashed border-line" />)}
      </div>
      <div className="relative flex h-52 items-end gap-3 border-b border-line sm:gap-5">
        {weeks.map((w, i) => {
          const last = i === weeks.length - 1;
          const pct = Math.max((Number(w.revenue) / max) * 100, 2);
          return (
            <div key={w.week_start} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              title={`Week of ${short(w.week_start)}: ${rupees(w.revenue)} · ${w.packs} packs`}>
              <span className={`num mb-1 truncate text-xs font-bold sm:text-sm ${last ? "text-navy" : "text-muted"}`}>{rupees(w.revenue)}</span>
              <div className={`bar-grow w-full max-w-20 rounded-t-lg ${last ? "bg-cyan" : "bg-[#A9E3F8]"}`}
                style={{ height: `calc(${pct}% - 24px)`, animationDelay: `${i * 60}ms` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3 sm:gap-5">
        {weeks.map((w) => <span key={w.week_start} className="flex-1 text-center text-xs text-muted">{short(w.week_start)}</span>)}
      </div>
    </div>
  );
}

// Paid / pending / overdue dues as a donut with legend.
export function DuesDonut({ dues }: { dues: Dashboard["dues"] }) {
  const parts = [
    { label: "Paid (verified)", value: Number(dues.paid), color: "var(--green)" },
    { label: "Pending", value: Number(dues.pending), color: "var(--amber)" },
    { label: "Overdue", value: Number(dues.overdue), color: "var(--red)" },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0);
  const r = 52, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-col items-center gap-4 2xl:flex-row 2xl:gap-6">
      <svg viewBox="0 0 140 140" className="size-36 shrink-0" role="img" aria-label="Customer dues split">
        <circle cx={70} cy={70} r={r} fill="none" stroke="var(--line)" strokeWidth={18} />
        {total > 0 && parts.map((p) => {
          const len = (p.value / total) * c;
          const el = (
            <circle key={p.label} cx={70} cy={70} r={r} fill="none" stroke={p.color} strokeWidth={18}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)" />
          );
          offset += len;
          return el;
        })}
        <text x={70} y={66} textAnchor="middle" fontSize={11} fill="var(--muted)">Total</text>
        <text x={70} y={84} textAnchor="middle" fontSize={15} fontWeight={800} fill="var(--ink)">{rupees(String(total))}</text>
      </svg>
      <ul className="w-full space-y-2 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: p.color }} />
            <span className="text-ink-soft">{p.label}</span>
            <span className="num ml-auto pl-4 font-bold">{rupees(String(p.value))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
