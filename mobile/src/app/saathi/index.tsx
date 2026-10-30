import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";

import { BriefList } from "@/components/BriefList";
import { Brand, Card, ErrorState, IconTile, Loading, Row, Screen, SectionTitle, Txt, styles as ui, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rupees, useLoad } from "@/lib/hooks";
import { colors, radius, type Tone } from "@/lib/theme";

const ACTIONS: { label: string; icon: IconName; tone: Tone; go: () => void }[] = [
  { label: "Collect", icon: "qr-code-outline", tone: "cyan", go: () => router.push("/dues") },
  { label: "Restock", icon: "cube-outline", tone: "amber", go: () => router.navigate({ pathname: "/saathi/assistant", params: { prompt: "restock" } }) },
  { label: "Stock", icon: "layers-outline", tone: "green", go: () => router.push("/inventory") },
  { label: "Reports", icon: "bar-chart-outline", tone: "violet", go: () => router.push("/brief") },
];

export default function Home() {
  const { session } = useAuth();
  const { data, error, loading, refreshing, reload } = useLoad(api.dashboard);
  const first = session?.merchant.owner_name.split(" ")[0] ?? "";

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Row style={{ paddingVertical: 10 }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          hitSlop={10} style={{ marginRight: 6 }} accessibilityLabel="Back to Paytm for Business"
        >
          <Ionicons name="arrow-back" size={22} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Brand />
        </View>
        <Pressable onPress={() => router.push("/connections")} hitSlop={8} style={s.demoPill} accessibilityLabel="Connection status">
          <View style={s.dot} />
          <Txt style={s.demoPillText}>{data?.demo_mode ? "DEMO" : "LIVE"}</Txt>
        </Pressable>
        <Pressable onPress={() => router.push("/profile")} style={s.avatar} accessibilityLabel="Profile and settings" hitSlop={6}>
          <Txt style={{ color: colors.navy, fontWeight: "800" }}>{first.charAt(0)}</Txt>
        </Pressable>
      </Row>

      <Txt style={ui.h1}>Namaste, {first} 👋</Txt>
      <Txt style={[ui.h3, { color: colors.inkSoft, marginTop: 2 }]}>{session?.merchant.display_name}</Txt>
      <Row style={{ marginTop: 2, marginBottom: 14 }}>
        <Ionicons name="location-outline" size={13} color={colors.muted} />
        <Txt style={[ui.muted, { marginLeft: 3 }]}>{session?.merchant.locality}</Txt>
      </Row>

      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <Row style={{ gap: 12, alignItems: "stretch" }}>
            <Card style={s.stat} onPress={() => router.push("/dues")}>
              <Txt style={s.statLabel}>Dues to collect</Txt>
              <Txt style={ui.money}>{rupees(data.outstanding_dues)}</Txt>
              <Txt style={[ui.muted, { color: colors.amber, fontWeight: "600" }]}>{data.outstanding_count} open invoices</Txt>
            </Card>
            <Card style={s.stat} onPress={() => router.push("/brief")}>
              <Txt style={s.statLabel}>Last week sales</Txt>
              <Txt style={ui.money}>{rupees(data.last_week_sales)}</Txt>
              <Txt style={[ui.muted, { color: colors.green, fontWeight: "600" }]}>~{rupees(data.last_week_margin)} margin</Txt>
            </Card>
          </Row>

          <Row style={{ justifyContent: "space-between", marginVertical: 8 }}>
            {ACTIONS.map((a) => (
              <Pressable key={a.label} onPress={a.go} style={s.action} accessibilityRole="button">
                <IconTile icon={a.icon} tone={a.tone} size={54} />
                <Txt style={s.actionLabel}>{a.label}</Txt>
              </Pressable>
            ))}
          </Row>

          {data.needs_approval > 0 && (
            <Card onPress={() => router.navigate("/saathi/tasks")} style={s.approve}>
              <Row>
                <IconTile icon="shield-checkmark" tone="amber" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Txt style={ui.h3}>{data.needs_approval} {data.needs_approval === 1 ? "task needs" : "tasks need"} your approval</Txt>
                  <Txt style={ui.muted}>Nothing is ordered or sent until you approve</Txt>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.muted} />
              </Row>
            </Card>
          )}

          <View style={s.ai}>
            <Row style={{ marginBottom: 6 }}>
              <Ionicons name="sparkles" size={18} color={colors.cyan} />
              <Txt style={{ marginLeft: 6, fontWeight: "800", color: colors.navy }}>Saathi AI</Txt>
            </Row>
            <Txt style={[ui.h2, { marginBottom: 10 }]}>{data.brief.priorities.length} things need your attention</Txt>
            <BriefList brief={data.brief} compact />
          </View>

          <SectionTitle title="Connected records" action="View all" onAction={() => router.push("/connections")} />
          <Card>
            {data.connections.map((c) => (
              <Row key={c.source} style={{ paddingVertical: 6 }}>
                <Txt style={{ flex: 1, fontWeight: "600" }}>{c.source.charAt(0) + c.source.slice(1).toLowerCase()}</Txt>
                <Txt style={[ui.muted, { fontWeight: "700", color: c.mode === "OFF" ? colors.red : c.mode === "LIVE" ? colors.green : colors.violet }]}>
                  {c.mode}
                </Txt>
              </Row>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.cyanSoft, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  demoPill: { flexDirection: "row", alignItems: "center", backgroundColor: colors.violetSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.violet, marginRight: 5 },
  demoPillText: { fontSize: 11, fontWeight: "800", color: colors.violet },
  stat: { flex: 1, marginBottom: 8 },
  statLabel: { fontSize: 13, color: colors.inkSoft, fontWeight: "600", marginBottom: 4 },
  action: { alignItems: "center", width: "24%", paddingVertical: 8 },
  actionLabel: { marginTop: 6, fontSize: 13, fontWeight: "700", color: colors.ink },
  approve: { borderWidth: 1, borderColor: "#FFE1A8", backgroundColor: "#FFFBF2" },
  ai: { backgroundColor: "#FFF5F5", borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: "#FBE1E1", marginBottom: 4 },
});
