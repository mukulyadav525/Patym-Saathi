import { router } from "expo-router";

import { Card, Divider, Empty, ErrorState, Loading, Row, Screen, SimBadge, StateBadge, TopBar, Txt, styles as ui } from "@/components/ui";
import { api } from "@/lib/api";
import { plural, rupees, timeAgo, useLoad } from "@/lib/hooks";

export default function Orders() {
  const { data, error, loading, refreshing, reload } = useLoad(api.orders);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Order history" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data?.length ? (
        <Empty icon="cart-outline" title="No orders yet" body="Approved purchase plans create supplier orders here." />
      ) : (
        data.map((o) => (
          <Card key={o.id} onPress={() => router.push({ pathname: "/task/[id]", params: { id: o.task_id } })}>
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={ui.h3}>{o.supplier_name}</Txt>
              <StateBadge state={o.status} />
            </Row>
            <Row style={{ gap: 6, marginTop: 4 }}>
              <Txt style={ui.muted}>{o.reference} · {timeAgo(o.created_at)}</Txt>
              <SimBadge />
            </Row>
            <Divider />
            <Row style={{ justifyContent: "space-between" }}>
              <Txt style={ui.muted}>{plural(o.lines.filter((l) => l.line_status === "ACCEPTED").reduce((n, l) => n + l.packs, 0), "pack")} accepted</Txt>
              <Txt style={{ fontWeight: "800", fontSize: 17 }}>{rupees(o.total)}</Txt>
            </Row>
          </Card>
        ))
      )}
    </Screen>
  );
}
