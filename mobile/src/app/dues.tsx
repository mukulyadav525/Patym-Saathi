import { router } from "expo-router";
import { useState } from "react";
import { Alert, View } from "react-native";

import { Button, Card, Empty, ErrorState, IconTile, Loading, Row, Screen, SectionTitle, StateBadge, TopBar, Txt, styles as ui } from "@/components/ui";
import { api, ApiError, type Invoice } from "@/lib/api";
import { rupees, useLoad } from "@/lib/hooks";
import { colors } from "@/lib/theme";

const OPEN = ["PENDING", "DRAFTED", "APPROVED", "SENT", "RECONCILIATION_REQUIRED", "FAILED", "EXPIRED"];

export default function Dues() {
  const { data, error, loading, refreshing, reload } = useLoad(api.invoices);
  const open = (data ?? []).filter((i) => OPEN.includes(i.status));
  const closed = (data ?? []).filter((i) => !OPEN.includes(i.status));
  const total = open.reduce((sum, i) => sum + Number(i.amount), 0);

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Dues collection" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : (
        <>
          <Card style={{ backgroundColor: colors.navy }}>
            <Txt style={{ color: "#B9D4F5", fontWeight: "600" }}>To collect</Txt>
            <Txt style={[ui.money, { color: "#fff" }]}>{rupees(total)}</Txt>
            <Txt style={{ color: "#B9D4F5", fontSize: 13 }}>{open.length} open invoices</Txt>
          </Card>
          {open.length === 0 && <Empty icon="checkmark-done-circle-outline" title="All dues collected" />}
          {open.map((i) => <InvoiceCard key={i.id} inv={i} />)}
          {closed.length > 0 && <SectionTitle title="Paid" />}
          {closed.map((i) => <InvoiceCard key={i.id} inv={i} />)}
        </>
      )}
    </Screen>
  );
}

function InvoiceCard({ inv }: { inv: Invoice }) {
  const [busy, setBusy] = useState(false);
  const collect = async () => {
    setBusy(true);
    try {
      const task = await api.paymentLink(inv.id);
      router.push({ pathname: "/task/[id]", params: { id: task.id } });
    } catch (e) {
      Alert.alert("Couldn't start", e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const canStart = ["PENDING", "FAILED", "EXPIRED"].includes(inv.status);
  return (
    <Card onPress={inv.open_task_id ? () => router.push({ pathname: "/task/[id]", params: { id: inv.open_task_id! } }) : undefined}>
      <Row>
        <IconTile icon="receipt-outline" tone={inv.status === "PAID" ? "green" : inv.days_overdue > 0 ? "red" : "amber"} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Txt style={ui.h3}>{inv.customer_name}</Txt>
          <Txt style={ui.muted}>{inv.invoice_number} · {inv.status === "PAID" ? "paid" : inv.days_overdue > 0 ? `${inv.days_overdue} days overdue` : `due ${inv.due_date}`}</Txt>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Txt style={{ fontSize: 18, fontWeight: "800" }}>{rupees(inv.amount)}</Txt>
          <StateBadge state={inv.status} />
        </View>
      </Row>
      {canStart && !inv.open_task_id && (
        <Button label="Create payment link" icon="link-outline" small style={{ marginTop: 12 }} loading={busy} onPress={collect} />
      )}
      {inv.open_task_id && <Txt style={[ui.link, { marginTop: 10 }]}>Open task →</Txt>}
    </Card>
  );
}
