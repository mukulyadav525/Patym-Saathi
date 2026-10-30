import { View } from "react-native";

import { Row, Txt } from "@/components/ui";
import type { Dashboard } from "@/lib/api";
import { rupees } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

// Weekly sales bars drawn with Views (no chart dependency). Latest week highlighted.
export function WeeklyBars({ weeks, height = 120 }: { weeks: Dashboard["weekly_sales"]; height?: number }) {
  const max = Math.max(...weeks.map((w) => Number(w.revenue)), 1);
  return (
    <View>
      <Row style={{ alignItems: "flex-end", height, gap: 14, paddingHorizontal: 4 }}>
        {weeks.map((w, i) => {
          const last = i === weeks.length - 1;
          return (
            <View key={w.week_start} style={{ flex: 1, alignItems: "center", justifyContent: "flex-end", height }}>
              <Txt style={{ fontSize: 10, fontWeight: "700", color: last ? colors.navy : colors.muted, marginBottom: 4 }}>
                {rupees(w.revenue).replace(".00", "")}
              </Txt>
              <View
                accessibilityLabel={`Week of ${short(w.week_start)}: ${rupees(w.revenue)}`}
                style={{
                  width: "70%", height: Math.max(6, ((height - 22) * Number(w.revenue)) / max),
                  backgroundColor: last ? colors.cyan : "#A9E3F8", borderTopLeftRadius: 6, borderTopRightRadius: 6,
                }}
              />
            </View>
          );
        })}
      </Row>
      <Row style={{ gap: 14, paddingHorizontal: 4, marginTop: 6, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 }}>
        {weeks.map((w) => (
          <Txt key={w.week_start} style={{ flex: 1, textAlign: "center", fontSize: 11, color: colors.muted }}>{short(w.week_start)}</Txt>
        ))}
      </Row>
    </View>
  );
}

// Paid / pending / overdue split as one stacked bar with a legend.
export function DuesSplit({ dues }: { dues: Dashboard["dues"] }) {
  const parts = [
    { label: "Paid", value: Number(dues.paid), color: colors.green },
    { label: "Pending", value: Number(dues.pending), color: colors.amber },
    { label: "Overdue", value: Number(dues.overdue), color: colors.red },
  ];
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <View>
      <Row style={{ height: 12, borderRadius: radius.pill, overflow: "hidden", backgroundColor: colors.line }}>
        {parts.map((p) => (p.value > 0 ? <View key={p.label} style={{ flex: p.value / total, height: 12, backgroundColor: p.color }} /> : null))}
      </Row>
      <Row style={{ justifyContent: "space-between", marginTop: 10 }}>
        {parts.map((p) => (
          <View key={p.label}>
            <Row>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: p.color, marginRight: 5 }} />
              <Txt style={{ fontSize: 12, color: colors.inkSoft }}>{p.label}</Txt>
            </Row>
            <Txt style={{ fontWeight: "800", fontSize: 15, marginTop: 2 }}>{rupees(String(p.value))}</Txt>
          </View>
        ))}
      </Row>
    </View>
  );
}
