import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizHeader } from "@/components/biz";
import { Card, Empty, ErrorState, Loading, Row, SimBadge, StateBadge, Txt, styles as ui } from "@/components/ui";
import { api } from "@/lib/api";
import { rupees, timeAgo, useLoad } from "@/lib/hooks";
import { usePrefs } from "@/lib/prefs";
import { colors, radius } from "@/lib/theme";

// Payments received through Saathi payment links. Bank settlement itself is outside this prototype and is not simulated.
export default function Settlements() {
  const { t, lang } = usePrefs();
  const { data, error, loading, refreshing, reload } = useLoad(api.invoices);
  const paid = (data ?? []).filter((i) => i.status === "PAID");
  const pending = (data ?? []).filter((i) => i.status !== "PAID" && i.link_url);
  const received = paid.reduce((sum, i) => sum + Number(i.amount), 0);
  const hi = lang === "hi";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "left", "right"]}>
      <BizHeader title={t("settlements")} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.cyan} />}
      >
        {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : (
          <>
            <View style={s.summary}>
              <Row style={{ justifyContent: "space-between" }}>
                <Txt style={{ color: "#C9DDF5", fontWeight: "600" }}>{hi ? "पेमेंट लिंक से मिला" : "Received via payment links"}</Txt>
                <SimBadge label="DEMO" />
              </Row>
              <Txt style={s.total}>{rupees(String(received))}</Txt>
              <Txt style={{ color: "#C9DDF5", fontSize: 13 }}>
                {paid.length} {hi ? "पेमेंट वेरिफ़ाइड" : paid.length === 1 ? "verified payment" : "verified payments"} · {pending.length} {hi ? "लिंक बाकी" : "links pending"}
              </Txt>
            </View>
            <Txt style={[ui.muted, { marginBottom: 12 }]}>
              {hi
                ? "बैंक सेटलमेंट इस प्रोटोटाइप में नहीं है। सिर्फ़ वेरिफ़ाइड पेमेंट दिखाए जाते हैं।"
                : "Bank settlement is not part of this prototype. Only payments verified by the status check are shown as received."}
            </Txt>

            {paid.length === 0 && pending.length === 0 ? (
              <Empty icon="cash-outline" title={hi ? "अभी कोई पेमेंट नहीं" : "No payments yet"}
                body={hi ? "बकाया पर पेमेंट लिंक भेजें — पेमेंट यहां दिखेंगे।" : "Send a payment link from Dues — payments show up here."} />
            ) : (
              [...paid, ...pending].map((i) => (
                <Card key={i.id} onPress={i.open_task_id ? () => router.push({ pathname: "/task/[id]", params: { id: i.open_task_id! } }) : undefined}>
                  <Row>
                    <View style={[s.icon, { backgroundColor: i.status === "PAID" ? colors.greenSoft : colors.amberSoft }]}>
                      <Ionicons name={i.status === "PAID" ? "arrow-down" : "time-outline"} size={18} color={i.status === "PAID" ? colors.green : colors.amber} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Txt style={ui.h3}>{i.customer_name}</Txt>
                      <Txt style={ui.muted}>
                        {i.invoice_number} · {i.paid_at ? timeAgo(i.paid_at) : hi ? "लिंक भेजा" : "link sent"}
                      </Txt>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Txt style={{ fontWeight: "800", fontSize: 16 }}>{rupees(i.amount)}</Txt>
                      <StateBadge state={i.status} />
                    </View>
                  </Row>
                </Card>
              ))
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  summary: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 18, marginBottom: 12 },
  total: { color: "#fff", fontSize: 32, fontWeight: "800", marginVertical: 4 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
