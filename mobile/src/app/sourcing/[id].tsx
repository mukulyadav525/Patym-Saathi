import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import { Badge, Button, Card, ErrorState, Loading, Row, Screen, SimBadge, TopBar, Txt, styles as ui } from "@/components/ui";
import { api, ApiError, type S } from "@/lib/api";
import { rupees, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

type Offer = S["VendorOffer"];
const QUALITY = {
  PREMIUM: { label: "Premium", tone: "violet" }, STANDARD: { label: "Standard", tone: "cyan" }, ECONOMY: { label: "Economy", tone: "amber" },
} as const;
const paise = (v: string | null | undefined) => rupees(v, v && Number(v) % 1 ? 2 : 0);

/** Every brand and quality the suppliers offer for one item, ranked by profit; buying one waits for approval. */
export default function CompareVendorsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, error, loading, refreshing, reload } = useLoad(() => api.sourcing(id), [id]);
  const [picked, setPicked] = useState<string | null>(null);

  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title={data ? `${data.name} · vendors` : "Compare vendors"} />
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <Card>
            <Txt style={ui.muted}>{data.pack_label}{data.brand ? ` · you stock ${data.brand}` : ""}</Txt>
            <Row style={{ marginTop: 10, justifyContent: "space-between" }}>
              {[["Cost", `${paise(data.cost_price)}${data.cost_estimated ? "*" : ""}`], ["Sell", rupees(data.sell_price)],
                ["Profit/pack", paise(data.profit_per_pack)], ["Stock", String(data.stock)], ["Per week", `~${Number(data.avg_weekly).toFixed(0)}`]]
                .map(([label, value]) => (
                  <View key={label} style={{ alignItems: "center" }}>
                    <Txt style={[ui.muted, { fontSize: 11 }]}>{label}</Txt>
                    <Txt style={{ fontSize: 16, fontWeight: "800", color: colors.ink }}>{value}</Txt>
                  </View>
                ))}
            </Row>
          </Card>
          <Card style={{ backgroundColor: colors.cyanSoft, borderWidth: 1, borderColor: "#BDE6F7" }}>
            <Txt style={[ui.h3, { color: colors.navy }]}>{data.recommendation}</Txt>
            {data.notes.map((n) => <Txt key={n} style={[ui.muted, { marginTop: 4, color: colors.inkSoft }]}>{n}</Txt>)}
          </Card>
          {data.offers.map((o) => (
            <OfferCard key={o.quote_id} offer={o} packLabel={data.pack_label} suggested={data.suggested_packs}
              open={picked === o.quote_id} onPick={() => setPicked(picked === o.quote_id ? null : o.quote_id)} />
          ))}
          <Txt style={[ui.muted, { fontSize: 11 }]}>
            Selling price: yours for the brand you stock; for other brands, what nearby shops charge (never above MRP). Per month = profit per
            pack × your usual sales a week × 4. Prices from supplier lists (SIMULATED) and nearby shops (SAMPLE).
          </Txt>
        </>
      )}
    </Screen>
  );
}

function OfferCard({ offer: o, packLabel, suggested, open, onPick }: {
  offer: Offer; packLabel: string; suggested: number; open: boolean; onPick: () => void;
}) {
  const q = QUALITY[o.quality] ?? QUALITY.STANDARD;
  const out = o.available_packs === 0;
  return (
    <Card style={[o.best && { borderWidth: 2, borderColor: colors.green }, out && { opacity: 0.6 }]}>
      <Row style={{ gap: 6, flexWrap: "wrap" }}>
        {o.best && <Badge label="Best profit" tone="green" icon="trophy-outline" />}
        {o.current_brand && <Badge label="You stock this" tone="navy" />}
        <Badge label={q.label} tone={q.tone} />
        {o.connector_mode === "SIMULATED" && <SimBadge />}
      </Row>
      <Txt style={[ui.h3, { marginTop: 8, fontSize: 17 }]}>{o.brand}</Txt>
      <Txt style={[ui.muted, { color: colors.inkSoft }]}>{o.quality_note}</Txt>
      <Txt style={[ui.muted, { fontSize: 12, marginTop: 2 }]}>
        {o.supplier_name} · {out ? "not available now" : `${o.available_packs} packs`} · {o.eta}
      </Txt>
      <View style={s.stats}>
        {[["Cost", rupees(o.cost_price), colors.ink], ["Sell at", rupees(o.sell_price), colors.ink],
          ["Profit/pack", rupees(o.profit_per_pack), Number(o.profit_per_pack) < 0 ? colors.red : colors.green],
          ["Per month", rupees(o.monthly_profit), colors.ink]].map(([label, value, color]) => (
            <View key={label} style={{ alignItems: "center", flex: 1 }}>
              <Txt style={[ui.muted, { fontSize: 11 }]}>{label}</Txt>
              <Txt style={{ fontSize: 15, fontWeight: "800", color }}>{value}</Txt>
            </View>
          ))}
      </View>
      {o.mrp && <Txt style={[ui.muted, { fontSize: 11, textAlign: "center" }]}>MRP {rupees(o.mrp)} · {Number(o.margin_pct).toFixed(0)}% margin</Txt>}
      {open ? <BuyPanel offer={o} packLabel={packLabel} suggested={suggested} onCancel={onPick} /> : (
        <Button label={`Buy from ${o.supplier_name.split(" ")[0]}`} icon="cart-outline" kind={o.best ? "primary" : "secondary"} disabled={out}
          onPress={onPick} style={{ marginTop: 12 }} />
      )}
    </Card>
  );
}

function BuyPanel({ offer: o, packLabel, suggested, onCancel }: { offer: Offer; packLabel: string; suggested: number; onCancel: () => void }) {
  const max = Math.min(o.available_packs, 500);
  const [packs, setPacks] = useState(String(Math.min(max, Math.max(o.min_order_packs, suggested))));
  const [sell, setSell] = useState(String(Number(o.sell_price)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = Number(packs);
  const aboveMrp = !!o.mrp && Number(sell) > Number(o.mrp);
  const valid = Number.isInteger(n) && n >= o.min_order_packs && n <= max && Number(sell) > 0 && !aboveMrp;

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const task = await api.buy(o.quote_id, n, sell);
      router.replace({ pathname: "/task/[id]", params: { id: task.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <View style={s.panel}>
      <Row style={{ gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Txt style={s.label}>Packs ({packLabel})</Txt>
          <TextInput value={packs} onChangeText={(t) => setPacks(t.replace(/\D/g, "").slice(0, 3))} keyboardType="number-pad"
            style={s.input} accessibilityLabel="Packs to buy" />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={s.label}>Your selling price ₹</Txt>
          <TextInput value={sell} onChangeText={(t) => setSell(t.replace(/[^\d.]/g, "").slice(0, 8))} keyboardType="decimal-pad"
            style={s.input} accessibilityLabel="Selling price" />
        </View>
      </Row>
      <Txt style={{ marginTop: 8, color: colors.ink }}>
        Pay <Txt style={{ fontWeight: "800" }}>{rupees(Number(o.cost_price) * (n || 0))}</Txt> · profit{" "}
        <Txt style={{ fontWeight: "800", color: colors.green }}>{rupees(Number(sell) - Number(o.cost_price))}</Txt> per pack
      </Txt>
      {aboveMrp && <Txt style={{ color: colors.red, fontSize: 12, marginTop: 4 }}>Can’t sell above the MRP of {rupees(o.mrp)}</Txt>}
      {error && <Txt style={{ color: colors.red, marginTop: 6 }}>{error}</Txt>}
      <Row style={{ gap: 8, marginTop: 10 }}>
        <Button label="Send for approval" icon="shield-checkmark-outline" loading={busy} disabled={!valid} onPress={() => void send()} style={{ flex: 1 }} />
        <Button label="Cancel" kind="secondary" onPress={onCancel} />
      </Row>
      <Txt style={[ui.muted, { fontSize: 11, marginTop: 6 }]}>
        Nothing is ordered until you approve with your PIN. Stock, cost price and selling price change when the goods arrive.
      </Txt>
    </View>
  );
}

const s = StyleSheet.create({
  stats: { flexDirection: "row", backgroundColor: colors.bg, borderRadius: radius.md, paddingVertical: 10, marginTop: 12, marginBottom: 4 },
  panel: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 12 },
  label: { fontSize: 12, fontWeight: "700", color: colors.inkSoft, marginBottom: 4 },
  input: {
    minHeight: 46, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 16,
    fontWeight: "700", color: colors.ink, backgroundColor: "#FAFCFE",
  },
});
