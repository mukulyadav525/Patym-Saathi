import { Ionicons } from "@expo/vector-icons";
import { ScrollView, StyleSheet, Switch, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizHeader } from "@/components/biz";
import { Txt, type IconName } from "@/components/ui";
import { usePrefs, type NotifyPrefs } from "@/lib/prefs";
import { colors } from "@/lib/theme";

const ROWS: { key: keyof NotifyPrefs; icon: IconName; en: [string, string]; hi: [string, string] }[] = [
  { key: "soundbox", icon: "volume-high-outline", en: ["Soundbox voice alerts", "Announce every payment received"], hi: ["साउंडबॉक्स आवाज़ अलर्ट", "हर पेमेंट पर आवाज़"] },
  { key: "push", icon: "notifications-outline", en: ["App notifications", "Payments, approvals and Saathi updates"], hi: ["ऐप नोटिफ़िकेशन", "पेमेंट, मंज़ूरी और साथी अपडेट"] },
  { key: "sms", icon: "chatbox-outline", en: ["SMS alerts", "Text message for each payment"], hi: ["SMS अलर्ट", "हर पेमेंट पर SMS"] },
  { key: "settlement", icon: "cash-outline", en: ["Settlement summary", "Daily summary of money settled"], hi: ["सेटलमेंट सारांश", "रोज़ का सेटलमेंट सारांश"] },
];

// Preferences are saved on this device only; the prototype does not send push or SMS.
export default function Notifications() {
  const { t, lang, notify, setNotify } = usePrefs();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "left", "right"]}>
      <BizHeader title={t("notifications")} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {ROWS.map((r) => {
          const [title, sub] = r[lang];
          return (
            <View key={r.key} style={s.row}>
              <Ionicons name={r.icon} size={24} color={colors.navy} style={{ width: 34 }} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Txt style={{ fontSize: 17 }}>{title}</Txt>
                <Txt style={s.sub}>{sub}</Txt>
              </View>
              <Switch
                value={notify[r.key]}
                onValueChange={(v) => setNotify(r.key, v)}
                trackColor={{ true: colors.cyan, false: colors.line }}
                thumbColor="#fff"
                accessibilityLabel={title}
              />
            </View>
          );
        })}
        <Txt style={[s.sub, { paddingHorizontal: 20, marginTop: 16 }]}>
          {lang === "hi"
            ? "ये सेटिंग्स सिर्फ़ इस फ़ोन पर सेव होती हैं। प्रोटोटाइप असली SMS या पुश नहीं भेजता।"
            : "Saved on this phone only. The prototype does not send real SMS or push messages."}
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: 1, borderBottomColor: colors.line },
  sub: { color: colors.muted, fontSize: 13, marginTop: 2 },
});
