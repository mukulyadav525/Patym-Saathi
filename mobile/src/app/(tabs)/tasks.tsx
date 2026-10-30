import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { Card, Empty, ErrorState, IconTile, Loading, Row, Screen, StateBadge, Txt, styles as ui } from "@/components/ui";
import { api, type TaskSummary } from "@/lib/api";
import { rupees, timeAgo, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

const GROUPS = [
  { key: "NEEDS_APPROVAL", label: "Needs approval" },
  { key: "IN_PROGRESS", label: "In progress" },
  { key: "DONE", label: "Done" },
] as const;

export default function Tasks() {
  const { data, error, loading, refreshing, reload } = useLoad(api.tasks);
  const [group, setGroup] = useState<(typeof GROUPS)[number]["key"]>("NEEDS_APPROVAL");
  const items = (data ?? []).filter((t) => t.group === group);

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <Txt style={[ui.h1, { marginTop: 12 }]}>Your work, moving forward</Txt>
      <Txt style={[ui.muted, { fontSize: 14, marginBottom: 14 }]}>Tasks Saathi is handling for your store</Txt>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14, marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {GROUPS.map((g) => {
          const n = (data ?? []).filter((t) => t.group === g.key).length;
          const on = g.key === group;
          return (
            <Pressable key={g.key} onPress={() => setGroup(g.key)} style={[s.seg, on && s.segOn]} accessibilityRole="tab" accessibilityState={{ selected: on }}>
              <Txt style={[s.segText, on && { color: "#fff" }]}>{g.label}</Txt>
              <View style={[s.count, on && { backgroundColor: "rgba(255,255,255,0.25)" }]}>
                <Txt style={[s.countText, on && { color: "#fff" }]}>{n}</Txt>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : items.length === 0 ? (
        <Empty icon={group === "NEEDS_APPROVAL" ? "shield-checkmark-outline" : "file-tray-outline"}
          title={group === "NEEDS_APPROVAL" ? "Nothing waiting for you" : "No tasks here yet"}
          body="Ask Saathi to plan stock or collect a payment — tasks show up here." />
      ) : (
        items.map((t) => <TaskCard key={t.id} t={t} onChanged={reload} />)
      )}
    </Screen>
  );
}

function TaskCard({ t }: { t: TaskSummary; onChanged: () => void }) {
  const restock = t.task_type === "RESTOCK";
  return (
    <Card onPress={() => router.push({ pathname: "/task/[id]", params: { id: t.id } })}>
      <Row style={{ alignItems: "flex-start" }}>
        <IconTile icon={restock ? "cart-outline" : "link-outline"} tone={restock ? "red" : "cyan"} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Row style={{ justifyContent: "space-between" }}>
            <Txt style={[ui.h3, { flex: 1 }]} numberOfLines={1}>
              {restock ? (t.group === "NEEDS_APPROVAL" ? "Approve purchase plan" : "Purchase plan") : t.title}
            </Txt>
            <Txt style={[ui.muted, { fontSize: 11 }]}>{timeAgo(t.updated_at)}</Txt>
          </Row>
          <Txt style={ui.muted} numberOfLines={1}>{restock ? t.title : "Payment link"} · Suggested by Saathi</Txt>
          <Row style={{ justifyContent: "space-between", marginTop: 8 }}>
            <Txt style={{ fontSize: 22, fontWeight: "800" }}>{rupees(t.amount)}</Txt>
            <StateBadge state={t.state} />
          </Row>
          {t.result_note && <Txt style={[ui.muted, { marginTop: 4 }]} numberOfLines={2}>{t.result_note}</Txt>}
          {t.group === "NEEDS_APPROVAL" && (
            <Row style={s.cta}>
              <Txt style={{ color: "#fff", fontWeight: "800" }}>Review & approve</Txt>
              <Ionicons name="chevron-forward" size={16} color="#fff" />
            </Row>
          )}
        </View>
      </Row>
    </Card>
  );
}

const s = StyleSheet.create({
  seg: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: "#fff", borderWidth: 1, borderColor: colors.line },
  segOn: { backgroundColor: colors.cyan, borderColor: colors.cyan },
  segText: { fontSize: 13, fontWeight: "700", color: colors.inkSoft },
  count: { marginLeft: 6, backgroundColor: colors.bg, borderRadius: 10, minWidth: 20, alignItems: "center", paddingHorizontal: 5 },
  countText: { fontSize: 11, fontWeight: "800", color: colors.inkSoft },
  cta: { marginTop: 10, backgroundColor: colors.cyan, borderRadius: radius.md, paddingVertical: 10, justifyContent: "center", gap: 4 },
});
