import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizHeader, PRODUCTS, ProductIcon, type ProductId } from "@/components/biz";
import { Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { colors, radius } from "@/lib/theme";

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { lang, t } = usePrefs();
  const pid = (id in PRODUCTS ? id : "soundbox") as ProductId;
  const p = PRODUCTS[pid];

  // These products exist in the real app; in this prototype only Saathi is wired to a backend, so say so instead of faking a request.
  const request = () =>
    Alert.alert(p.title[lang], lang === "hi"
      ? "यह हैकाथॉन प्रोटोटाइप है। कोई रिक्वेस्ट नहीं भेजी गई। असली ऐप में यहां से ऑर्डर होता है।"
      : "This is a hackathon prototype. No request was sent. In the real app this starts the order.");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "left", "right", "bottom"]}>
      <BizHeader title={p.title[lang]} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
        <View style={s.hero}>
          <View style={{ flex: 1 }}>
            <Txt style={s.heroLine}>{p.heroLine[lang]}</Txt>
            <Txt style={s.heroBold}>{p.heroBold}</Txt>
          </View>
          <View style={s.heroArt}>
            <ProductIcon id={pid} size={58} />
          </View>
        </View>

        <Txt style={s.section}>{p.title[lang]} {t("features")}</Txt>
        <View style={s.grid}>
          {p.features.map((f) => (
            <View key={f.label.en} style={s.feature}>
              <Ionicons name={f.icon} size={52} color={f.color} />
              <Txt style={s.featureText}>{f.label[lang]}</Txt>
            </View>
          ))}
        </View>
        <Txt style={s.note}>{t("prototype")}</Txt>
      </ScrollView>
      <View style={s.footer}>
        <Pressable
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
          onPress={session ? request : () => router.push("/sign-in")}
          accessibilityRole="button"
        >
          <Txt style={s.ctaText}>{session ? t("requestInfo") : t("login")}</Txt>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  hero: { backgroundColor: "#1C7FD6", borderRadius: radius.lg, padding: 20, minHeight: 170, flexDirection: "row", alignItems: "center" },
  heroLine: { color: "#E3F1FF", fontSize: 18, lineHeight: 24 },
  heroBold: { color: "#fff", fontSize: 26, fontWeight: "900", marginTop: 4, lineHeight: 31 },
  heroArt: { width: 96, height: 96, borderRadius: 20, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginLeft: 10 },
  section: { fontSize: 18, fontWeight: "700", color: colors.ink, marginTop: 22, marginBottom: 12 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  feature: {
    width: "48.5%", backgroundColor: "#E6EEF8", borderRadius: radius.md, alignItems: "center", justifyContent: "center",
    paddingVertical: 24, paddingHorizontal: 10, minHeight: 170,
  },
  featureText: { marginTop: 14, fontSize: 15, textAlign: "center", color: colors.ink, lineHeight: 21 },
  note: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 16 },
  footer: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#fff" },
  cta: { backgroundColor: "#1C9BE6", borderRadius: radius.md, minHeight: 54, alignItems: "center", justifyContent: "center" },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "600" },
});
