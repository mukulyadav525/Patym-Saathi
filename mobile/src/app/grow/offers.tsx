import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";

import { Chips, MiniBars, SourceNote } from "@/components/grow";
import { Badge, Button, Card, Empty, ErrorState, Loading, Row, Screen, SectionTitle, TopBar, Txt, styles as ui } from "@/components/ui";
import { api, ApiError, type Offer, type SlowMover } from "@/lib/api";
import { rupees, timeAgo, useLoad } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

const LANGS: { code: string; label: string }[] = [
  { code: "hi-IN", label: "Hinglish" }, { code: "en-IN", label: "English" }, { code: "ta-IN", label: "தமிழ்" },
  { code: "bn-IN", label: "বাংলা" }, { code: "mr-IN", label: "मराठी" }, { code: "gu-IN", label: "ગુજરાતી" },
  { code: "te-IN", label: "తెలుగు" }, { code: "kn-IN", label: "ಕನ್ನಡ" },
];

export default function OffersScreen() {
  const slow = useLoad(api.slowMovers);
  const offers = useLoad(api.offers);
  const [active, setActive] = useState<Offer | null>(null);
  const reload = () => { slow.reload(); offers.reload(); };

  return (
    <Screen refreshing={slow.refreshing} onRefresh={reload}>
      <TopBar title="Slow stock offers" />
      <Txt style={[ui.muted, { marginBottom: 12 }]}>
        Items that stopped selling tie up cash. Saathi drafts an offer; you share it with your customers. Saathi never sends messages.
      </Txt>
      {slow.loading && !slow.data ? <Loading /> : slow.error && !slow.data ? <ErrorState error={slow.error} onRetry={reload} /> :
        (slow.data ?? []).length === 0 ? <Empty icon="checkmark-circle-outline" title="Nothing is stuck" body="All items are selling at their usual pace." /> :
          (slow.data ?? []).map((item) => <SlowCard key={item.product_id} item={item} onCreated={(o) => { setActive(o); offers.reload(); }} />)}

      {active && <OfferCard offer={active} onShared={() => offers.reload()} />}

      {(offers.data ?? []).length > 0 && (
        <>
          <SectionTitle title="Your offers" />
          <Card>
            {(offers.data ?? []).map((o, i) => (
              <Pressable key={o.id} onPress={() => setActive(o)} style={[s.offerRow, i > 0 && s.line]}>
                <View style={{ flex: 1 }}>
                  <Txt style={{ fontWeight: "700" }}>{o.product_name} · {rupees(o.offer_price)}</Txt>
                  <Txt style={ui.muted}>{o.discount_pct}% off · {timeAgo(o.created_at)}</Txt>
                </View>
                <Badge label={o.status === "SHARED" ? "Shared" : "Draft"} tone={o.status === "SHARED" ? "green" : "muted"} />
              </Pressable>
            ))}
          </Card>
        </>
      )}
    </Screen>
  );
}

function SlowCard({ item, onCreated }: { item: SlowMover; onCreated: (o: Offer) => void }) {
  const [discount, setDiscount] = useState(item.suggested_discount);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      onCreated(await api.createOffer(item.product_id, discount));
    } catch (e) {
      Alert.alert("Couldn't draft offer", e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Txt style={ui.h3}>{item.name} <Txt style={ui.muted}>· {item.pack_label}</Txt></Txt>
          <Txt style={[ui.muted, { marginTop: 2 }]}>{item.reason}</Txt>
        </View>
        <View style={{ width: 70, marginLeft: 10 }}>
          <MiniBars values={item.weekly_sales} />
          <Txt style={{ fontSize: 10, color: colors.muted, textAlign: "center", marginTop: 3 }}>4 weeks</Txt>
        </View>
      </Row>
      <Row style={{ gap: 10, marginTop: 12 }}>
        <View style={s.fact}><Txt style={s.factLabel}>In stock</Txt><Txt style={s.factValue}>{item.stock}</Txt></View>
        <View style={s.fact}><Txt style={s.factLabel}>Cash tied up</Txt><Txt style={s.factValue}>{rupees(item.cash_tied_up)}</Txt></View>
        <View style={s.fact}><Txt style={s.factLabel}>Price</Txt><Txt style={s.factValue}>{rupees(item.sell_price)}</Txt></View>
      </Row>
      <Txt style={[ui.muted, { marginTop: 12, marginBottom: 6, fontWeight: "700" }]}>Discount</Txt>
      <Chips options={[10, 15, 20]} value={discount} onChange={setDiscount} format={(v) => `${v}% off`} />
      <Txt style={[ui.muted, { marginTop: 8, fontSize: 11 }]}>Saathi never prices below your cost + 5%{item.unit_cost ? ` (cost ${rupees(item.unit_cost)})` : ""}.</Txt>
      <Button label="Draft customer offer" icon="pricetag-outline" loading={busy} onPress={create} style={{ marginTop: 12 }} />
    </Card>
  );
}

function OfferCard({ offer, onShared }: { offer: Offer; onShared: () => void }) {
  const [lang, setLang] = useState("hi-IN");
  const [text, setText] = useState(offer.message);
  const [busy, setBusy] = useState(false);

  const switchLang = async (code: string) => {
    setLang(code);
    if (code === "hi-IN") return setText(offer.message);
    setBusy(true);
    try {
      setText((await api.translate("OFFER", offer.id, code)).text);
    } catch (e) {
      setLang("hi-IN");
      setText(offer.message);
      Alert.alert("Translation unavailable", e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const res = await Share.share({ message: text });
    if (res.action !== Share.dismissedAction) {
      await api.offerShared(offer.id).catch(() => undefined);
      onShared();
    }
  };

  return (
    <Card style={{ borderWidth: 1, borderColor: "#BFE9FA" }}>
      <Row style={{ justifyContent: "space-between" }}>
        <Txt style={ui.h3}>Offer ready · {offer.product_name}</Txt>
        <Txt style={{ fontWeight: "800", color: colors.green }}>{rupees(offer.offer_price)}</Txt>
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 10, marginHorizontal: -16 }} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {LANGS.map((l) => (
          <Pressable key={l.code} onPress={() => void switchLang(l.code)} style={[s.lang, lang === l.code && s.langOn]} accessibilityRole="radio" accessibilityState={{ selected: lang === l.code }}>
            <Txt style={[s.langText, lang === l.code && { color: "#fff" }]}>{l.label}</Txt>
          </Pressable>
        ))}
      </ScrollView>
      <View style={s.message}>
        <Txt style={{ lineHeight: 21, opacity: busy ? 0.4 : 1 }}>{text}</Txt>
      </View>
      <SourceNote text={lang === "hi-IN" ? "Drafted by Saathi from your prices." : "Translated by Sarvam (Mayura). Check before sharing."} />
      <Row style={{ gap: 10, marginTop: 12 }}>
        <Button label="Copy" kind="secondary" icon="copy-outline" small style={{ flex: 1 }} onPress={() => void Clipboard.setStringAsync(text)} />
        <Button label="Share" icon="share-social-outline" small style={{ flex: 1 }} onPress={() => void share()} />
      </Row>
      <Row style={{ marginTop: 8 }}>
        <Ionicons name="shield-checkmark-outline" size={13} color={colors.muted} />
        <Txt style={[ui.muted, { fontSize: 11, marginLeft: 4 }]}>You choose who gets it. Saathi does not message customers.</Txt>
      </Row>
    </Card>
  );
}

const s = StyleSheet.create({
  fact: { flex: 1, backgroundColor: colors.bg, borderRadius: radius.sm, padding: 8 },
  factLabel: { fontSize: 11, color: colors.muted },
  factValue: { fontSize: 15, fontWeight: "800", marginTop: 2 },
  offerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  line: { borderTopWidth: 1, borderTopColor: colors.line },
  lang: { paddingHorizontal: 12, minHeight: 34, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line },
  langOn: { backgroundColor: colors.navy, borderColor: colors.navy },
  langText: { fontSize: 13, fontWeight: "700", color: colors.inkSoft },
  message: { backgroundColor: "#F2FBFF", borderRadius: radius.md, padding: 12 },
});
