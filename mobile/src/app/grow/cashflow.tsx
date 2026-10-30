import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Switch, TextInput, View } from "react-native";

import { BalanceChart, SourceNote, Stat } from "@/components/grow";
import { Button, Card, ErrorState, Loading, Row, Screen, SectionTitle, TopBar, Txt, styles as ui } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { rupees, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

const short = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export default function CashflowScreen() {
  const [pending, setPending] = useState(true);
  const { data, error, loading, refreshing, reload } = useLoad(() => api.cashflow(pending), [pending]);
  const settings = useLoad(api.businessSettings);
  const [cash, setCash] = useState("");
  const [expenses, setExpenses] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings.data) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCash(settings.data.cash_on_hand ? String(Math.round(Number(settings.data.cash_on_hand))) : "");
    setExpenses(settings.data.weekly_expenses ? String(Math.round(Number(settings.data.weekly_expenses))) : "");
  }, [settings.data]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveBusinessSettings({ cash_on_hand: cash || undefined, weekly_expenses: expenses || undefined });
      settings.reload();
      reload();
    } catch (e) {
      Alert.alert("Not saved", e instanceof ApiError ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const short_ = data ? Number(data.shortfall) : 0;
  const events = (data?.series ?? []).filter((p) => p.events.length > 0);

  return (
    <Screen refreshing={refreshing} onRefresh={() => { reload(); settings.reload(); }}>
      <TopBar title="Cash flow" />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <View style={[s.alert, short_ > 0 ? s.alertBad : s.alertOk]}>
            <Ionicons name={short_ > 0 ? "warning" : "checkmark-circle"} size={22} color={short_ > 0 ? colors.red : colors.green} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Txt style={{ fontWeight: "800", fontSize: 16 }}>
                {short_ > 0 ? `You may be short ${rupees(data.shortfall)} by ${short(data.first_negative_on!)}` : `Cash looks fine for ${data.days} days`}
              </Txt>
              <Txt style={[ui.muted, { marginTop: 2 }]}>Lowest point {rupees(data.lowest_balance)} on {short(data.lowest_on)}</Txt>
            </View>
          </View>
          {short_ > 0 && (
            <Card onPress={() => router.push({ pathname: "/product/[id]", params: { id: "loan" } })} style={s.loan}>
              <Row>
                <Ionicons name="cash-outline" size={22} color={colors.navy} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Txt style={ui.h3}>Need working capital?</Txt>
                  <Txt style={ui.muted}>See Paytm Merchant Loan options. Saathi does not lend or apply for you.</Txt>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.muted} />
              </Row>
            </Card>
          )}

          <Card>
            <Row style={{ justifyContent: "space-between", marginBottom: 10 }}>
              <Txt style={ui.h3}>Next {data.days} days</Txt>
              <Row>
                <Txt style={[ui.muted, { marginRight: 6 }]}>Include plan awaiting approval</Txt>
                <Switch value={pending} onValueChange={setPending} trackColor={{ true: colors.cyan, false: colors.line }} thumbColor="#fff"
                  accessibilityLabel="Include plan awaiting approval" />
              </Row>
            </Row>
            <BalanceChart points={data.series} />
          </Card>

          <Row style={{ gap: 10, marginBottom: 12 }}>
            <Stat label="Cash today" value={rupees(data.opening)} />
            <Stat label="Sales / day" value={rupees(data.daily_sales)} tone={colors.green} />
            <Stat label="Buying / day" value={rupees(data.daily_purchases)} tone={colors.amber} />
          </Row>

          {events.length > 0 && (
            <>
              <SectionTitle title="Known money in and out" />
              <Card>
                {events.flatMap((p) => p.events.map((e, i) => (
                  <Row key={`${p.date}-${i}`} style={s.event}>
                    <Txt style={[ui.muted, { width: 56 }]}>{short(p.date)}</Txt>
                    <Txt style={{ flex: 1 }}>{e.label}</Txt>
                    <Txt style={{ fontWeight: "800", color: Number(e.amount) < 0 ? colors.red : colors.green }}>
                      {Number(e.amount) < 0 ? "−" : "+"}{rupees(Math.abs(Number(e.amount)))}
                    </Txt>
                  </Row>
                )))}
              </Card>
            </>
          )}

          <SectionTitle title="Your figures" />
          <Card>
            <Txt style={s.label}>Cash in hand today (₹)</Txt>
            <TextInput value={cash} onChangeText={(t) => setCash(t.replace(/[^\d]/g, "").slice(0, 8))} keyboardType="number-pad"
              style={s.input} placeholder="e.g. 6000" placeholderTextColor={colors.muted} accessibilityLabel="Cash in hand" />
            <Txt style={s.label}>Weekly expenses: rent, salary, bills (₹)</Txt>
            <TextInput value={expenses} onChangeText={(t) => setExpenses(t.replace(/[^\d]/g, "").slice(0, 8))} keyboardType="number-pad"
              style={s.input} placeholder="e.g. 3500" placeholderTextColor={colors.muted} accessibilityLabel="Weekly expenses" />
            <Button label="Update forecast" icon="refresh" small loading={saving} onPress={() => void save()} />
            {data.missing.map((m) => <SourceNote key={m} text={m} />)}
          </Card>
          {data.assumptions.map((a) => <SourceNote key={a} text={a} />)}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  alert: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: radius.lg, marginBottom: 12, borderWidth: 1 },
  alertBad: { backgroundColor: colors.redSoft, borderColor: "#F3C5C5" },
  alertOk: { backgroundColor: colors.greenSoft, borderColor: "#BFE6CC" },
  loan: { backgroundColor: "#EAF5FC", borderWidth: 1, borderColor: "#CDEBFA" },
  event: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#F1F4F8" },
  label: { fontSize: 13, fontWeight: "700", color: colors.inkSoft, marginBottom: 6 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: "#FAFCFE", marginBottom: 12 },
});
