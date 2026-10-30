import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { Row, Txt, type IconName } from "@/components/ui";
import { rupees } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

export type GrowTile = { label: string; icon: IconName; href?: Href; onPress?: () => void; badge?: string; isNew?: boolean };

// Paytm-style icon grid (4 per row) used for "Grow with Saathi".
export function GrowGrid({ title, tiles, action, onAction }: { title: string; tiles: GrowTile[]; action?: string; onAction?: () => void }) {
  return (
    <View style={g.card}>
      <Row style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <Txt style={g.title}>{title}</Txt>
        {action && (
          <Pressable onPress={onAction} hitSlop={10} style={{ flexDirection: "row", alignItems: "center" }}>
            <Txt style={g.link}>{action}</Txt>
            <Ionicons name="arrow-forward" size={14} color="#0083AD" />
          </Pressable>
        )}
      </Row>
      <View style={g.grid}>
        {tiles.map((t) => (
          <Pressable key={t.label} style={({ pressed }) => [g.tile, pressed && { opacity: 0.6 }]} accessibilityRole="button"
            onPress={t.onPress ?? (() => t.href && router.push(t.href))}>
            <View>
              <Ionicons name={t.icon} size={30} color={colors.navy} />
              {t.badge ? <View style={g.badge}><Txt style={g.badgeText}>{t.badge}</Txt></View> : null}
            </View>
            {t.isNew && <View style={g.newTag}><Txt style={g.newText}>NEW</Txt></View>}
            <Txt style={g.label} numberOfLines={2}>{t.label}</Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// Tiny bar chart (weekly packs, balances...). Negative values drawn red below a zero line.
export function MiniBars({ values, height = 36, color = colors.cyan, highlightLast = true }: {
  values: number[]; height?: number; color?: string; highlightLast?: boolean;
}) {
  const max = Math.max(...values.map((v) => Math.abs(v)), 1);
  return (
    <Row style={{ alignItems: "flex-end", height, gap: 3 }}>
      {values.map((v, i) => (
        <View key={i} style={{
          flex: 1, height: Math.max(3, (Math.abs(v) / max) * height), borderRadius: 3,
          backgroundColor: v < 0 ? colors.red : highlightLast && i === values.length - 1 ? color : "#A9E3F8",
        }} />
      ))}
    </Row>
  );
}

// Balance chart for the cash-flow forecast: bars above/below a zero line.
export function BalanceChart({ points }: { points: { date: string; balance: string }[] }) {
  const values = points.map((p) => Number(p.balance));
  const max = Math.max(...values.map(Math.abs), 1);
  const H = 70;
  return (
    <View>
      <Row style={{ height: H * 2 + 1, alignItems: "stretch", gap: 3 }}>
        {values.map((v, i) => (
          <View key={points[i].date} style={{ flex: 1, justifyContent: "center" }}>
            <View style={{ height: H, justifyContent: "flex-end" }}>
              {v >= 0 && <View style={{ height: Math.max(2, (v / max) * H), backgroundColor: i === 0 ? colors.navy : colors.cyan, borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />}
            </View>
            <View style={{ height: 1, backgroundColor: colors.line }} />
            <View style={{ height: H }}>
              {v < 0 && <View style={{ height: Math.max(2, (-v / max) * H), backgroundColor: colors.red, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 }} />}
            </View>
          </View>
        ))}
      </Row>
      <Row style={{ justifyContent: "space-between", marginTop: 4 }}>
        <Txt style={g.axis}>Today</Txt>
        <Txt style={g.axis}>{new Date(points[points.length - 1].date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Txt>
      </Row>
    </View>
  );
}

export function Chips<T extends string | number>({ options, value, onChange, format }: {
  options: T[]; value: T; onChange: (v: T) => void; format?: (v: T) => string;
}) {
  return (
    <Row style={{ gap: 8, flexWrap: "wrap" }}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable key={String(o)} onPress={() => onChange(o)} style={[g.chip, on && g.chipOn]} accessibilityRole="radio" accessibilityState={{ selected: on }}>
            <Txt style={[g.chipText, on && { color: "#fff" }]}>{format ? format(o) : String(o)}</Txt>
          </Pressable>
        );
      })}
    </Row>
  );
}

export function Stat({ label, value, sub, tone = colors.ink }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <View style={g.stat}>
      <Txt style={{ fontSize: 12, color: colors.inkSoft, fontWeight: "600" }}>{label}</Txt>
      <Txt style={{ fontSize: 22, fontWeight: "800", color: tone, marginTop: 2 }} numberOfLines={1} adjustsFontSizeToFit>{value}</Txt>
      {sub ? <Txt style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{sub}</Txt> : null}
    </View>
  );
}

export const money0 = (v: string | number | null | undefined) => rupees(v);

export function SourceNote({ text }: { text: string }) {
  return (
    <Row style={{ alignItems: "flex-start", marginTop: 6 }}>
      <Ionicons name="information-circle-outline" size={14} color={colors.muted} style={{ marginTop: 1 }} />
      <Txt style={{ flex: 1, marginLeft: 5, fontSize: 11, color: colors.muted }}>{text}</Txt>
    </Row>
  );
}

const g = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: radius.lg, padding: 16, marginBottom: 12, shadowColor: "#0B1B33", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  title: { fontSize: 18, fontWeight: "800", color: colors.ink },
  link: { color: "#0083AD", fontWeight: "700", fontSize: 14, marginRight: 3 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  tile: { width: "25%", alignItems: "center", paddingVertical: 12, paddingHorizontal: 2 },
  label: { fontSize: 12, color: colors.ink, textAlign: "center", marginTop: 6, lineHeight: 15 },
  badge: { position: "absolute", top: -6, right: -14, backgroundColor: colors.red, borderRadius: 9, minWidth: 18, paddingHorizontal: 4, height: 18, alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "#fff" },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  newTag: { position: "absolute", top: 4, right: 6, backgroundColor: "#FFD54A", borderRadius: 4, paddingHorizontal: 4 },
  newText: { fontSize: 8, fontWeight: "900", color: colors.ink },
  axis: { fontSize: 10, color: colors.muted },
  chip: { paddingHorizontal: 14, minHeight: 38, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff" },
  chipOn: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  chipText: { fontWeight: "700", color: colors.inkSoft, fontSize: 14 },
  stat: { flex: 1, backgroundColor: "#fff", borderRadius: radius.md, padding: 12, borderWidth: 1, borderColor: colors.line },
});
