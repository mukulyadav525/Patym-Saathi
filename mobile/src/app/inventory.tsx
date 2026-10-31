import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { Badge, Button, Card, Divider, Empty, ErrorState, Loading, Row, Screen, TopBar, Txt, styles as ui } from "@/components/ui";
import { api } from "@/lib/api";
import { plural, rupees, timeAgo, useLoad } from "@/lib/hooks";
import { colors } from "@/lib/theme";

export default function InventoryScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.inventory);
  const profit = useLoad(api.profit);
  const low = (data ?? []).filter((i) => i.low);
  const p = profit.data;
  return (
    <Screen refreshing={refreshing} onRefresh={() => { reload(); profit.reload(); }}>
      <TopBar title="Stock & alerts" />
      <Button label="Add a product" icon="add-circle-outline" kind="secondary" small style={{ marginBottom: 12 }}
        onPress={() => router.push("/add-product")} />
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
          {p?.profit && (
            <Card>
              <Txt style={[ui.muted, { fontSize: 12 }]}>Profit since {new Date(p.period_from).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Txt>
              <Txt style={{ fontSize: 26, fontWeight: "800", color: colors.green, marginTop: 2 }}>{rupees(p.profit)}</Txt>
              <Txt style={ui.muted}>on {rupees(p.revenue)} sales{p.margin_pct ? ` · ${Number(p.margin_pct).toFixed(1)}% margin` : ""}</Txt>
              <Txt style={[ui.muted, { fontSize: 11, marginTop: 6 }]}>Ask Saathi: “Atta pe kitna munafa hua?”</Txt>
            </Card>
          )}
          <Card>
            {data.map((i, idx) => (
              <View key={i.product_id}>
                {idx > 0 && <Divider />}
                <Pressable onPress={() => router.push({ pathname: "/sourcing/[id]", params: { id: i.product_id } })}
                  accessibilityRole="button" accessibilityLabel={`${i.name}: compare vendors`}
                  style={({ pressed }) => pressed && { opacity: 0.7 }}>
                <Row>
                  <View style={{ flex: 1 }}>
                    <Txt style={ui.h3}>{i.name} <Txt style={ui.muted}>{i.name_hi}</Txt></Txt>
                    {!!i.brand && <Txt style={[ui.muted, { color: colors.inkSoft }]}>{i.brand}</Txt>}
                    <Txt style={ui.muted}>{i.pack_label} · cost {rupees(i.cost_price, Number(i.cost_price) % 1 ? 2 : 0)} · sells {rupees(i.sell_price)} · ~{i.avg_weekly}/week</Txt>
                    {i.profit_per_pack && (
                      <Txt style={{ fontSize: 12, fontWeight: "700", color: Number(i.profit_per_pack) < 0 ? colors.red : colors.green }}>
                        {rupees(i.profit_per_pack, Number(i.profit_per_pack) % 1 ? 2 : 0)} profit / pack
                      </Txt>
                    )}
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Txt style={{ fontSize: 20, fontWeight: "800", color: i.low ? colors.red : colors.ink }}>{i.usable_packs}</Txt>
                    <Txt style={[ui.muted, { fontSize: 11 }]}>packs</Txt>
                  </View>
                </Row>
                <Row style={{ gap: 6, marginTop: 6 }}>
                  {i.low && <Badge label="Low" tone="red" icon="warning-outline" />}
                  <Badge label={i.source} tone={i.source === "SAMPLE" ? "violet" : "green"} />
                  <Txt style={[ui.muted, { fontSize: 11, flex: 1 }]} numberOfLines={1}>{timeAgo(i.updated_at)}</Txt>
                  <Txt style={{ fontSize: 12, fontWeight: "700", color: colors.navy }}>Compare vendors ›</Txt>
                </Row>
                </Pressable>
              </View>
            ))}
          </Card>
          <Txt style={[ui.muted, { fontSize: 11 }]}>Stock changes only when goods are received — never when an order is placed.</Txt>
        </>
      )}
    </Screen>
  );
}
