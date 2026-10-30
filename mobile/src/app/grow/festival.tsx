import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";

import { Chips, SourceNote } from "@/components/grow";
import { Button, Card, Empty, ErrorState, Loading, Row, Screen, TopBar, Txt, styles as ui } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { plural, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

const BUDGETS = [8000, 10000, 12000];

export default function FestivalScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.festival);
  const [budget, setBudget] = useState(10000);
  const [busy, setBusy] = useState(false);

  // The plan is built by the backend calculator from last festival's sales; this only starts it.
  const plan = async () => {
    setBusy(true);
    try {
      const res = await api.ask(`Diwali ke liye ₹${budget.toLocaleString("en-IN")} ke andar stock arrange karo`);
      if (res.task) router.push({ pathname: "/task/[id]", params: { id: res.task.id } });
      else Alert.alert("Saathi", res.reply);
    } catch (e) {
      Alert.alert("Couldn't plan", e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Festival stock" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data ? (
        <Empty icon="calendar-outline" title="No festival in the next 30 days" body="Saathi will remind you before the next big festival." />
      ) : (
        <>
          <View style={s.hero}>
            <Row>
              <View style={s.diya}><Ionicons name="flame" size={26} color="#FFB300" /></View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Txt style={s.heroTitle}>{data.name} in {plural(data.days_left, "day")}</Txt>
                <Txt style={s.heroSub}>{new Date(data.date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</Txt>
              </View>
            </Row>
            <Txt style={s.heroBody}>Last {data.name} your shop sold much more of these. Plan now so you don’t run out.</Txt>
          </View>

          <Txt style={[ui.h2, { marginVertical: 8 }]}>Last year’s {data.name} week</Txt>
          <Card>
            {data.top_items.map((item, i) => (
              <Row key={item.name} style={[s.row, i > 0 && s.rowLine]}>
                <View style={{ flex: 1 }}>
                  <Txt style={ui.h3}>{item.name}</Txt>
                  <Txt style={ui.muted}>{plural(item.last_year_packs, "pack")} that week vs ~{Number(item.normal_weekly).toFixed(0)} normally</Txt>
                </View>
                <View style={s.uplift}><Txt style={s.upliftText}>{Number(item.uplift).toFixed(1)}×</Txt></View>
              </Row>
            ))}
            <SourceNote text={data.source} />
          </Card>

          <Txt style={[ui.h2, { marginVertical: 8 }]}>Festival budget</Txt>
          <Card>
            <Chips options={BUDGETS} value={budget} onChange={setBudget} format={(v) => `₹${v.toLocaleString("en-IN")}`} />
            <Txt style={[ui.muted, { marginTop: 10 }]}>
              Saathi uses your 4-week sales × each item’s {data.name} uplift, checks stock and picks the cheapest supplier.
              Nothing is ordered until you approve.
            </Txt>
            <Button label={`Plan ${data.name} stock`} icon="sparkles" loading={busy} onPress={plan} style={{ marginTop: 14 }} />
          </Card>
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: "#3B1D5E", borderRadius: radius.lg, padding: 18, marginBottom: 6 },
  diya: { width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  heroTitle: { color: "#fff", fontSize: 22, fontWeight: "800" },
  heroSub: { color: "#E6D8F5", marginTop: 2 },
  heroBody: { color: "#F3EAFB", marginTop: 12, lineHeight: 20 },
  row: { paddingVertical: 10 },
  rowLine: { borderTopWidth: 1, borderTopColor: colors.line },
  uplift: { backgroundColor: colors.amberSoft, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  upliftText: { color: colors.amber, fontWeight: "800", fontSize: 15 },
});
