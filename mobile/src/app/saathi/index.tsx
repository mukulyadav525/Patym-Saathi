import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";

import { BriefList } from "@/components/BriefList";
import { GrowGrid } from "@/components/grow";
import { VoiceBrief } from "@/components/VoiceBrief";
import { usePrefs } from "@/lib/prefs";
import { useVoiceAgent } from "@/lib/voiceAgent";
import { Brand, Card, ErrorState, IconTile, Loading, Row, Screen, SectionTitle, Txt, styles as ui, type IconName } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rupees, useLoad } from "@/lib/hooks";
import { colors, radius, type Tone } from "@/lib/theme";

const ACTIONS: { label: string; icon: IconName; tone: Tone; go: () => void }[] = [
  { label: "Collect", icon: "qr-code-outline", tone: "cyan", go: () => router.push("/dues") },
  { label: "Payments", icon: "paper-plane-outline", tone: "green", go: () => router.push("/settlements") },
  { label: "Stock", icon: "cube-outline", tone: "amber", go: () => router.push("/inventory") },
  { label: "Reports", icon: "bar-chart-outline", tone: "violet", go: () => router.push("/brief") },
];

// Shows that Saathi is listening for its name (and how to turn it on when it isn't).
function WakeHint() {
  const agent = useVoiceAgent();
  const { wakeWord } = usePrefs();
  const on = wakeWord && agent.available && agent.phase !== "off";
  return (
    <Pressable onPress={on ? agent.activate : () => router.push("/profile")} style={s.wake} accessibilityRole="button">
      <View style={[s.wakeDot, { backgroundColor: on ? colors.green : colors.muted }]} />
      <Txt style={{ fontSize: 12, color: colors.inkSoft, flex: 1 }}>
        {on ? "Bolein “Hey Saathi” — jaise “Hey Saathi, atta kitna bacha hai?”" : "“Hey Saathi” off · Profile mein chaalu karein"}
      </Txt>
    </Pressable>
  );
}

export default function Home() {
  const { session } = useAuth();
  const { data, error, loading, refreshing, reload } = useLoad(api.dashboard);
  const growth = useLoad(api.growth);
  const first = session?.merchant.owner_name.split(" ")[0] ?? "";
  const [scanning, setScanning] = useState(false);
  const g = growth.data;

  // Saathi check: drafts restock/collection tasks for approval (never acts on its own).
  const scan = async () => {
    if (scanning) return;
    setScanning(true);
    try {
      const res = await api.scan();
      const lines = [
        res.created.length ? `Prepared ${res.created.length} task(s) for your approval:` : "Nothing new to prepare. Open tasks are already waiting.",
        ...res.created.map((c) => `• ${c.title} (${rupees(c.amount)})`),
        ...res.notes.map((n) => `• ${n}`),
      ];
      Alert.alert("Saathi checked your shop", lines.join("\n"), res.created.length
        ? [{ text: "Later", style: "cancel" }, { text: "Review", onPress: () => router.navigate("/saathi/tasks") }]
        : [{ text: "OK" }]);
      reload();
      growth.reload();
    } catch (e) {
      Alert.alert("Check failed", e instanceof ApiError ? e.message : String(e));
    } finally {
      setScanning(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => { reload(); growth.reload(); }}>
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
        <Pressable onPress={() => router.push("/activity")} hitSlop={8} style={{ marginLeft: 10 }} accessibilityLabel="Activity and alerts">
          <Ionicons name="notifications-outline" size={22} color={colors.navy} />
          {data && data.needs_approval > 0 && <View style={s.bellDot} />}
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

          {g?.festival && (
            <Pressable onPress={() => router.push("/grow/festival")} style={({ pressed }) => [s.festival, pressed && { opacity: 0.9 }]}
              accessibilityRole="button">
              <View style={s.diya}><Ionicons name="flame" size={22} color="#FFB300" /></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Txt style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{g.festival.name} in {g.festival.days_left} days</Txt>
                <Txt style={{ color: "#E6D8F5", fontSize: 12, marginTop: 2 }} numberOfLines={2}>
                  Last year: {g.festival.top_items.slice(0, 2).map((i) => `${i.name} ${Number(i.uplift).toFixed(1)}×`).join(", ")}. Plan festival stock →
                </Txt>
              </View>
            </Pressable>
          )}

          <View style={s.ai}>
            <Row style={{ marginBottom: 6 }}>
              <Ionicons name="sparkles" size={18} color={colors.cyan} />
              <Txt style={{ marginLeft: 6, fontWeight: "800", color: colors.navy }}>Saathi AI</Txt>
            </Row>
            <Txt style={[ui.h2, { marginBottom: 10 }]}>{data.brief.priorities.length} things need your attention</Txt>
            <BriefList brief={data.brief} compact />
            <VoiceBrief />
            <WakeHint />
          </View>

          <View style={{ height: 12 }} />
          <GrowGrid
            title="Grow with Saathi"
            tiles={[
              { label: "Festival stock", icon: "flame-outline", href: "/grow/festival", isNew: !!g?.festival },
              { label: "Slow stock offers", icon: "pricetag-outline", href: "/grow/offers", badge: g?.slow_movers ? String(g.slow_movers) : undefined },
              { label: "Khata", icon: "book-outline", href: "/grow/khata", badge: g?.khata_late_customers ? String(g.khata_late_customers) : undefined },
              { label: "Cash flow", icon: "wallet-outline", href: "/grow/cashflow", badge: g && Number(g.cash_shortfall) > 0 ? "!" : undefined },
              { label: "Bill to stock", icon: "receipt-outline", href: "/grow/bills" },
              { label: "Stores near you", icon: "people-outline", href: "/grow/benchmarks" },
              { label: "Saathi impact", icon: "trophy-outline", href: "/grow/impact" },
              { label: scanning ? "Checking…" : "Saathi check", icon: "scan-circle-outline", onPress: () => void scan(), badge: g?.proactive_tasks ? String(g.proactive_tasks) : undefined },
            ]}
          />

          {g && (Number(g.impact.under_budget) + Number(g.impact.supplier_savings) > 0 || g.impact.payments_collected > 0) && (
            <Card onPress={() => router.push("/grow/impact")} style={s.impact}>
              <Row>
                <Ionicons name="trophy" size={22} color={colors.green} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Txt style={{ fontWeight: "800" }}>Saathi saved you {rupees(Number(g.impact.under_budget) + Number(g.impact.supplier_savings))}</Txt>
                  <Txt style={ui.muted}>{rupees(g.impact.collected_via_links)} collected · ~{g.impact.minutes_saved_estimate} min saved</Txt>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Row>
            </Card>
          )}

          <Card onPress={() => router.navigate("/")} style={s.grow}>
            <Row>
              <View style={s.growIcon}><Ionicons name="storefront" size={24} color={colors.navy} /></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Txt style={ui.h3}>Grow your business with Paytm</Txt>
                <Txt style={ui.muted}>QR · Soundbox · Card Machine · Merchant Loan</Txt>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Row>
          </Card>

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
  bellDot: { position: "absolute", top: 0, right: 0, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.red, borderWidth: 1, borderColor: "#fff" },
  grow: { backgroundColor: "#EAF5FC", borderWidth: 1, borderColor: "#CDEBFA", marginTop: 12 },
  growIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  wake: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 },
  wakeDot: { width: 8, height: 8, borderRadius: 4 },
  festival: { flexDirection: "row", alignItems: "center", backgroundColor: "#3B1D5E", borderRadius: radius.lg, padding: 14, marginBottom: 12 },
  diya: { width: 42, height: 42, borderRadius: 21, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  impact: { backgroundColor: colors.greenSoft, borderWidth: 1, borderColor: "#BFE6CC" },
  approve: { borderWidth: 1, borderColor: "#FFE1A8", backgroundColor: "#FFFBF2" },
  ai: { backgroundColor: "#FFF5F5", borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: "#FBE1E1", marginBottom: 4 },
});
