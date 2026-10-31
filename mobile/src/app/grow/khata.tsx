import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Share, StyleSheet, View } from "react-native";

import { SourceNote } from "@/components/grow";
import { Badge, Button, Card, Empty, ErrorState, Loading, Row, Screen, TopBar, Txt, styles as ui } from "@/components/ui";
import { api, ApiError, type KhataCustomer } from "@/lib/api";
import { plural, rupees, useLoad } from "@/lib/hooks";
import { colors, radius, type Tone } from "@/lib/theme";

const LABEL_TONE: Record<string, Tone> = { "Pays on time": "green", "Sometimes late": "amber", "Pays late": "red", "New customer": "violet" };

export default function KhataScreen() {
  const { data, error, loading, refreshing, reload } = useLoad(api.khata);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Khata insights" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <View style={s.summary}>
            <Txt style={{ color: "#C9DDF5", fontWeight: "600" }}>Total udhaar outstanding</Txt>
            <Txt style={s.total}>{rupees(data.total_outstanding)}</Txt>
            <Txt style={{ color: "#C9DDF5", fontSize: 12 }}>{plural(data.customers.filter((c) => Number(c.outstanding) > 0).length, "customer")} owe you · {data.source}</Txt>
          </View>
          {data.customers.length === 0 ? <Empty icon="book-outline" title="No khata entries" /> :
            data.customers.map((c) => <CustomerCard key={c.customer_name} c={c} />)}
          {data.rules.map((r) => <SourceNote key={r} text={r} />)}
        </>
      )}
    </Screen>
  );
}

function CustomerCard({ c }: { c: KhataCustomer }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const owes = Number(c.outstanding) > 0;

  // Paytm link only through the normal approval flow; plain reminders are shared by the merchant.
  const collect = async () => {
    if (!c.open_invoice_id) return;
    setBusy(true);
    try {
      const task = await api.paymentLink(c.open_invoice_id);
      router.push({ pathname: "/task/[id]", params: { id: task.id } });
    } catch (e) {
      Alert.alert("Couldn't start", e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Row style={{ alignItems: "flex-start" }}>
          <View style={s.avatar}><Txt style={{ fontWeight: "800", color: colors.navy }}>{c.customer_name.charAt(0)}</Txt></View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Txt style={ui.h3}>{c.customer_name}</Txt>
            <Txt style={ui.muted}>{c.phone_masked}</Txt>
            <Row style={{ marginTop: 6 }}><Badge label={c.label} tone={LABEL_TONE[c.label] ?? "muted"} /></Row>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Txt style={{ fontSize: 20, fontWeight: "800", color: owes ? colors.ink : colors.green }}>{rupees(c.outstanding)}</Txt>
            <Txt style={[ui.muted, Number(c.advance) > 0 && !owes && { color: colors.green }]}>
              {owes ? (c.oldest_open_days ? `oldest ${plural(c.oldest_open_days, "day")}` : "since today") : Number(c.advance) > 0 ? `${rupees(c.advance)} advance` : "nothing due"}
            </Txt>
          </View>
        </Row>
        <Row style={{ gap: 8, marginTop: 12 }}>
          <View style={s.fact}><Txt style={s.factLabel}>Avg days to pay</Txt><Txt style={s.factValue}>{c.avg_days_to_pay ?? "—"}</Txt></View>
          <View style={s.fact}><Txt style={s.factLabel}>Late payments</Txt><Txt style={s.factValue}>{c.late_payments}/{c.payments}</Txt></View>
          <View style={s.fact}><Txt style={s.factLabel}>Suggested limit</Txt><Txt style={s.factValue}>{rupees(c.suggested_limit)}</Txt></View>
        </Row>
      </Pressable>

      {owes && (
        <Row style={{ gap: 10, marginTop: 12 }}>
          {c.open_invoice_id ? (
            <Button label={`Collect via Paytm link`} icon="link-outline" small style={{ flex: 1 }} loading={busy} onPress={() => void collect()} />
          ) : (
            <Button label="Share reminder" icon="share-social-outline" small style={{ flex: 1 }}
              onPress={() => void Share.share({ message: c.reminder ?? "" })} />
          )}
        </Row>
      )}

      {open && (
        <View style={s.history}>
          {c.history.map((h, i) => (
            <Row key={`${h.date}-${i}`} style={{ paddingVertical: 6 }}>
              <Ionicons name={h.kind === "CREDIT" ? "arrow-up-circle-outline" : "arrow-down-circle-outline"} size={18}
                color={h.kind === "CREDIT" ? colors.amber : colors.green} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Txt style={{ fontSize: 13 }}>{h.kind === "CREDIT" ? "Udhaar given" : "Payment received"} · {h.note}</Txt>
                <Txt style={[ui.muted, { fontSize: 11 }]}>{new Date(h.date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</Txt>
              </View>
              <Txt style={{ fontWeight: "700" }}>{rupees(h.amount)}</Txt>
            </Row>
          ))}
        </View>
      )}
      <Pressable onPress={() => setOpen(!open)} style={s.toggle} hitSlop={8}>
        <Txt style={{ color: "#0083AD", fontWeight: "700", fontSize: 13 }}>{open ? "Hide history" : "Show history"}</Txt>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={14} color="#0083AD" />
      </Pressable>
    </Card>
  );
}

const s = StyleSheet.create({
  summary: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 18, marginBottom: 12 },
  total: { color: "#fff", fontSize: 32, fontWeight: "800", marginVertical: 4 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.cyanSoft, alignItems: "center", justifyContent: "center" },
  fact: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.sm, padding: 8 },
  factLabel: { fontSize: 10, color: colors.muted },
  factValue: { fontSize: 14, fontWeight: "800", marginTop: 2 },
  history: { marginTop: 10, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 6 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 10, minHeight: 32 },
});
