import { router } from "expo-router";
import { View } from "react-native";

import { Badge, Button, Card, Divider, Empty, ErrorState, Loading, Row, Screen, TopBar, Txt, styles as ui } from "@/components/ui";
import { api } from "@/lib/api";
import { plural, rupees, timeAgo, useLoad } from "@/lib/hooks";
import { colors } from "@/lib/theme";

export default function InventoryScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.inventory);
  const low = (data ?? []).filter((i) => i.low);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Stock & alerts" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <Empty icon="layers-outline" title="No stock records" body="Connect POS or add items to see stock." />
      ) : (
        <>
          {low.length > 0 && (
            <Card style={{ backgroundColor: colors.amberSoft, borderWidth: 1, borderColor: "#FFD48A" }}>
              <Txt style={[ui.h3, { color: colors.amber }]}>{plural(low.length, "item")} below half a week’s demand</Txt>
              <Txt style={[ui.muted, { marginTop: 2 }]}>{low.map((i) => i.name).join(", ")}</Txt>
              <Button label="Plan restock with Saathi" icon="sparkles" small style={{ marginTop: 10 }}
                onPress={() => router.navigate({ pathname: "/saathi/assistant", params: { prompt: "restock" } })} />
            </Card>
          )}
          <Card>
            {data.map((i, idx) => (
              <View key={i.product_id}>
                {idx > 0 && <Divider />}
                <Row>
                  <View style={{ flex: 1 }}>
                    <Txt style={ui.h3}>{i.name} <Txt style={ui.muted}>{i.name_hi}</Txt></Txt>
                    <Txt style={ui.muted}>{i.pack_label} · sells {rupees(i.sell_price)} · ~{i.avg_weekly}/week</Txt>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Txt style={{ fontSize: 20, fontWeight: "800", color: i.low ? colors.red : colors.ink }}>{i.usable_packs}</Txt>
                    <Txt style={[ui.muted, { fontSize: 11 }]}>packs</Txt>
                  </View>
                </Row>
                <Row style={{ gap: 6, marginTop: 6 }}>
                  {i.low && <Badge label="Low" tone="red" icon="warning-outline" />}
                  <Badge label={i.source} tone={i.source === "SAMPLE" ? "violet" : "green"} />
                  <Txt style={[ui.muted, { fontSize: 11 }]}>updated {timeAgo(i.updated_at)}</Txt>
                </Row>
              </View>
            ))}
          </Card>
          <Txt style={[ui.muted, { fontSize: 11 }]}>Stock changes only when goods are received — never when an order is placed.</Txt>
        </>
      )}
    </Screen>
  );
}
