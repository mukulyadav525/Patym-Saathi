import type { Dashboard } from "@/lib/api";
import { rupees } from "@/lib/api";

const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

// Weekly sales as SVG bars (no chart dependency). Latest week in brand cyan.
export function SalesBars({ weeks }: { weeks: Dashboard["weekly_sales"] }) {
  const max = Math.max(...weeks.map((w) => Number(w.revenue)), 1);
  const W = 520, H = 200, top = 22, bottom = 26, gap = 28;
  const bw = (W - gap * (weeks.length + 1)) / weeks.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Weekly sales, last four weeks">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={W} y1={top + (H - top - bottom) * (1 - f)} y2={top + (H - top - bottom) * (1 - f)} stroke="var(--line)" strokeDasharray="3 4" />
      ))}
      {weeks.map((w, i) => {
        const h = ((H - top - bottom) * Number(w.revenue)) / max;
        const x = gap + i * (bw + gap);
        const y = H - bottom - h;
        const last = i === weeks.length - 1;
        return (
          <g key={w.week_start}>
            <title>{`Week of ${short(w.week_start)}: ${rupees(w.revenue)} · ${w.packs} packs`}</title>
            <rect x={x} y={y} width={bw} height={h} rx={6} fill={last ? "var(--cyan)" : "#A9E3F8"} />
            <text x={x + bw / 2} y={y - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill={last ? "var(--navy)" : "var(--muted)"}>
              {rupees(w.revenue)}
            </text>
            <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize={12} fill="var(--muted)">{short(w.week_start)}</text>
          </g>
        );
      })}
      <line x1={0} x2={W} y1={H - bottom} y2={H - bottom} stroke="var(--line)" />
    </svg>
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
