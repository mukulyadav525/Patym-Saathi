import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { View } from "react-native";

import { BriefList } from "@/components/BriefList";
import { DuesSplit, WeeklyBars } from "@/components/charts";
import { Card, ErrorState, Loading, Row, Screen, SectionTitle, StateBadge, TopBar, Txt, styles as ui } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees, timeAgo, useLoad } from "@/lib/hooks";
import { colors } from "@/lib/theme";

export default function BriefScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.dashboard);
  const invoices = useLoad(api.invoices);
  const paid = (invoices.data ?? []).filter((i) => i.status === "PAID").slice(0, 3);
  const prev = data ? Number(data.weekly_sales.at(-2)?.revenue ?? 0) : 0;
  const change = data && prev > 0 ? ((Number(data.last_week_sales) - prev) / prev) * 100 : null;

  return (
    <Screen refreshing={refreshing} onRefresh={() => { reload(); invoices.reload(); }}>
      <TopBar title="Daily report" />
      <Txt style={ui.h1}>Today at a glance</Txt>
      <Row style={{ marginBottom: 14 }}>
        <Ionicons name="information-circle-outline" size={14} color={colors.muted} />
        <Txt style={[ui.muted, { marginLeft: 4 }]}>Based only on connected records</Txt>
      </Row>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <Card>
            <Row style={{ justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Txt style={ui.h3}>Weekly sales</Txt>
                <Txt style={[ui.muted, { fontSize: 11 }]}>POS records (SAMPLE) · sell price × packs</Txt>
              </View>
              {change != null && (
                <Row>
                  <Ionicons name={change >= 0 ? "caret-up" : "caret-down"} size={12} color={change >= 0 ? colors.green : colors.red} />
                  <Txt style={{ fontSize: 12, fontWeight: "700", color: change >= 0 ? colors.green : colors.red }}>
                    {Math.abs(change).toFixed(0)}% wk/wk
                  </Txt>
                </Row>
              )}
            </Row>
            <WeeklyBars weeks={data.weekly_sales} />
          </Card>

          <Row style={{ gap: 12 }}>
            <Card style={{ flex: 1 }}>
              <Txt style={ui.muted}>Last week sales</Txt>
              <Txt style={[ui.money, { fontSize: 22 }]}>{rupees(data.last_week_sales)}</Txt>
              <Txt style={[ui.muted, { fontSize: 11 }]}>POS (sample)</Txt>
            </Card>
            <Card style={{ flex: 1 }}>
              <Txt style={ui.muted}>Est. gross margin</Txt>
              <Txt style={[ui.money, { fontSize: 22, color: colors.green }]}>{rupees(data.last_week_margin)}</Txt>
              <Txt style={[ui.muted, { fontSize: 11 }]}>Sell − best quote</Txt>
            </Card>
          </Row>

          <Card onPress={() => router.push("/dues")}>
            <Row style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <Txt style={ui.h3}>Customer dues</Txt>
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Row>
            <DuesSplit dues={data.dues} />
          </Card>

          <SectionTitle title="Priorities" />
          <Card><BriefList brief={data.brief} /></Card>
          {data.brief.missing.map((m) => (
            <View key={m} style={{ flexDirection: "row", marginTop: 4 }}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.muted} />
              <Txt style={[ui.muted, { marginLeft: 6, flex: 1 }]}>{m}</Txt>
            </View>
          ))}

          <SectionTitle title="Recent payments" action="View all" onAction={() => router.push("/settlements")} />
          <Card>
            {paid.length === 0 ? (
              <Txt style={ui.muted}>No verified payments yet. Payments appear only after the status check passes.</Txt>
            ) : paid.map((i, n) => (
              <Row key={i.id} style={{ paddingVertical: 8, borderTopWidth: n ? 1 : 0, borderTopColor: colors.line }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.greenSoft, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="arrow-down" size={16} color={colors.green} />
                </View>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Txt style={{ fontWeight: "800" }}>{rupees(i.amount)}</Txt>
                  <Txt style={ui.muted}>{i.customer_name} · {i.paid_at ? timeAgo(i.paid_at) : ""}</Txt>
                </View>
                <StateBadge state={i.status} />
              </Row>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}
