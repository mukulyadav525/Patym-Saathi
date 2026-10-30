import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";

import { SourceNote, Stat } from "@/components/grow";
import { Button, Card, ErrorState, Loading, Row, Screen, TopBar, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

export default function ImpactScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.impact);
  const saved = data ? Number(data.under_budget) + Number(data.supplier_savings) : 0;
  const hours = data ? Math.floor(data.minutes_saved_estimate / 60) : 0;
  const mins = data ? data.minutes_saved_estimate % 60 : 0;
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Saathi impact" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <View style={s.hero}>
            <Txt style={{ color: "#C9F2DC", fontWeight: "700" }}>Saathi has saved you</Txt>
            <Txt style={s.big}>{rupees(saved)}</Txt>
            <Txt style={{ color: "#E3F7EC" }}>and about {hours > 0 ? `${hours} h ` : ""}{mins} min of work</Txt>
          </View>
          {data.restocks_completed === 0 && data.payments_collected === 0 ? (
            <Card>
              <Row>
                <Ionicons name="sparkles" size={20} color={colors.cyan} />
                <Txt style={{ flex: 1, marginLeft: 8 }}>Complete a restock or collect a payment with Saathi and your savings show up here.</Txt>
              </Row>
              <Button label="Plan a restock" icon="cube-outline" small style={{ marginTop: 12 }}
                onPress={() => router.navigate({ pathname: "/saathi/assistant", params: { prompt: "restock" } })} />
            </Card>
          ) : null}
          <Row style={{ gap: 10, marginBottom: 10 }}>
            <Stat label="Under budget" value={rupees(data.under_budget)} sub={`${data.restocks_completed} restocks`} tone={colors.green} />
            <Stat label="Cheaper supplier" value={rupees(data.supplier_savings)} sub="vs costliest quote" tone={colors.green} />
          </Row>
          <Row style={{ gap: 10, marginBottom: 10 }}>
            <Stat label="Collected via links" value={rupees(data.collected_via_links)} sub={`${data.payments_collected} verified`} />
            <Stat label="Plan ready in" value={data.avg_seconds_to_plan == null ? "—" : data.avg_seconds_to_plan < 1 ? "<1s" : `${data.avg_seconds_to_plan}s`} sub="average" />
          </Row>
          <Row style={{ gap: 10, marginBottom: 10 }}>
            <Stat label="Offers drafted" value={String(data.offers_drafted)} />
            <Stat label="Time saved" value={`${data.minutes_saved_estimate} min`} sub="estimate" />
          </Row>
          {data.assumptions.map((a) => <SourceNote key={a} text={a} />)}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: colors.green, borderRadius: radius.lg, padding: 20, marginBottom: 12 },
  big: { color: "#fff", fontSize: 38, fontWeight: "800", marginVertical: 4 },
});
