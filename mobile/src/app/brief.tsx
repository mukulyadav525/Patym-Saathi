import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { BriefList } from "@/components/BriefList";
import { Card, ErrorState, Loading, Row, Screen, TopBar, Txt, styles as ui } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees, useLoad } from "@/lib/hooks";
import { colors } from "@/lib/theme";

export default function BriefScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.dashboard);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Daily report" />
      <Txt style={ui.h1}>Today at a glance</Txt>
      <Row style={{ marginBottom: 14 }}>
        <Ionicons name="information-circle-outline" size={14} color={colors.muted} />
        <Txt style={[ui.muted, { marginLeft: 4 }]}>Based only on connected records</Txt>
      </Row>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
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
          <Row style={{ gap: 12 }}>
            <Card style={{ flex: 1 }}>
              <Txt style={ui.muted}>Dues open</Txt>
              <Txt style={[ui.money, { fontSize: 22, color: colors.amber }]}>{rupees(data.outstanding_dues)}</Txt>
            </Card>
            <Card style={{ flex: 1 }}>
              <Txt style={ui.muted}>Low-stock items</Txt>
              <Txt style={[ui.money, { fontSize: 22, color: colors.red }]}>{data.low_stock_count}</Txt>
            </Card>
          </Row>
          <Txt style={[ui.h2, { marginVertical: 8 }]}>Priorities</Txt>
          <Card><BriefList brief={data.brief} /></Card>
          {data.brief.missing.map((m) => (
            <View key={m} style={{ flexDirection: "row", marginTop: 4 }}>
              <Ionicons name="alert-circle-outline" size={14} color={colors.muted} />
              <Txt style={[ui.muted, { marginLeft: 6, flex: 1 }]}>{m}</Txt>
            </View>
          ))}
        </>
      )}
    </Screen>
  );
}
