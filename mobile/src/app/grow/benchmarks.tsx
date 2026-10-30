import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, View } from "react-native";

import { SourceNote } from "@/components/grow";
import { Card, Empty, ErrorState, Loading, Row, Screen, SectionTitle, TopBar, Txt, styles as ui } from "@/components/ui";
import { api } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

export default function BenchmarksScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.benchmarks);
  const max = Math.max(...(data?.items ?? []).flatMap((i) => [Number(i.yours), Number(i.peers)]), 1);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Stores near you" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data || data.items.length === 0 ? (
        <Empty icon="people-outline" title="Not enough nearby stores yet" body="Comparisons appear when at least 10 similar stores are nearby." />
      ) : (
        <>
          <View style={s.head}>
            <Ionicons name="location" size={18} color="#fff" />
            <View style={{ flex: 1, marginLeft: 8 }}>
              <Txt style={{ color: "#fff", fontWeight: "800", fontSize: 16 }}>{data.locality}</Txt>
              <Txt style={{ color: "#C9DDF5", fontSize: 12 }}>{data.peer_count} similar kirana stores · {data.period.toLowerCase()}</Txt>
            </View>
          </View>

          {data.insights.length > 0 && <SectionTitle title="What stands out" />}
          {data.insights.map((ins) => (
            <Card key={ins.name} style={{ borderLeftWidth: 4, borderLeftColor: ins.diff_pct < 0 ? colors.amber : colors.green }}>
              <Row style={{ alignItems: "flex-start" }}>
                <Ionicons name={ins.diff_pct < 0 ? "trending-down" : "trending-up"} size={20} color={ins.diff_pct < 0 ? colors.amber : colors.green} />
                <Txt style={{ flex: 1, marginLeft: 8, lineHeight: 20 }}>{ins.text}</Txt>
              </Row>
            </Card>
          ))}

          <SectionTitle title="Weekly packs: you vs nearby" />
          <Card>
            <Row style={{ gap: 14, marginBottom: 8 }}>
              <Row><View style={[s.dot, { backgroundColor: colors.cyan }]} /><Txt style={ui.muted}>You</Txt></Row>
              <Row><View style={[s.dot, { backgroundColor: "#C7D3E3" }]} /><Txt style={ui.muted}>Nearby median</Txt></Row>
            </Row>
            {data.items.map((i) => (
              <View key={i.product_id} style={s.item}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Txt style={{ fontWeight: "700" }}>{i.name}{i.ran_low ? <Txt style={{ color: colors.red, fontSize: 11 }}>  · low stock</Txt> : null}</Txt>
                  <Txt style={{ fontWeight: "800", color: i.diff_pct <= -20 ? colors.amber : i.diff_pct >= 20 ? colors.green : colors.inkSoft }}>
                    {i.diff_pct > 0 ? "+" : ""}{i.diff_pct}%
                  </Txt>
                </Row>
                <View style={[s.bar, { width: `${(Number(i.yours) / max) * 100}%`, backgroundColor: colors.cyan }]} />
                <View style={[s.bar, { width: `${(Number(i.peers) / max) * 100}%`, backgroundColor: "#C7D3E3" }]} />
                <Txt style={[ui.muted, { fontSize: 11 }]}>{i.yours} vs {i.peers} packs/week</Txt>
              </View>
            ))}
          </Card>
          <SourceNote text={data.privacy} />
          <SourceNote text={data.source} />
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", backgroundColor: colors.navy, borderRadius: radius.lg, padding: 16, marginBottom: 4 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 5 },
  item: { paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#F1F4F8" },
  bar: { height: 8, borderRadius: 4, marginTop: 5, minWidth: 4 },
});
