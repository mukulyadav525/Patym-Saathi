import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizHeader } from "@/components/biz";
import { Txt } from "@/components/ui";
import { usePrefs } from "@/lib/prefs";
import { colors } from "@/lib/theme";

const SECTIONS: { title: string; body: string }[] = [
  {
    title: "About this app",
    body: "This is an independent hackathon concept by TeamAIR01. It is not an official Paytm app and is not affiliated with or endorsed by Paytm. All store data is sample data.",
  },
  {
    title: "What is simulated",
    body: "Supplier orders are SIMULATED. Payment links and payments use a DEMO adapter: no real money moves and no real bank settlement happens. Every simulated step is labelled in the app.",
  },
  {
    title: "Approvals",
    body: "Saathi never places an order or sends a payment link on its own. Each action needs your approval, which is tied to the exact amount and items, expires after 10 minutes and can be used once. If anything changes, you approve again.",
  },
  {
    title: "Data we use",
    body: "Your login, store records (stock, weekly sales, supplier quotes, invoices) and the requests you type or speak. Voice is sent for transcription only when you tap the mic. Customer phone numbers are masked.",
  },
  {
    title: "What we store on this phone",
    body: "Your login session (encrypted with the device keystore), language choice and notification settings. Signing out removes the session.",
  },
  {
    title: "Audit history",
    body: "Every plan, approval and adapter call is written to an append-only activity log you can see under Saathi → Business → Activity history.",
  },
];

export default function Legal() {
  const { t } = usePrefs();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "left", "right"]}>
      <BizHeader title={t("legal")} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        {SECTIONS.map((sec) => (
          <View key={sec.title} style={s.section}>
            <Txt style={s.title}>{sec.title}</Txt>
            <Txt style={s.body}>{sec.body}</Txt>
          </View>
        ))}
        <Txt style={{ color: colors.muted, fontSize: 12 }}>Version 0.1.0 · prototype</Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  section: { marginBottom: 20 },
  title: { fontSize: 17, fontWeight: "800", marginBottom: 6 },
  body: { fontSize: 15, color: colors.inkSoft, lineHeight: 22 },
});
