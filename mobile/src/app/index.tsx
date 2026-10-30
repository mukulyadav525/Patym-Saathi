import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizLogo, ProductIcon, type ProductId } from "@/components/biz";
import { Txt } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs, type StringKey } from "@/lib/prefs";
import { colors, radius, shadow } from "@/lib/theme";

const PRODUCTS: { id: ProductId; label: StringKey }[] = [
  { id: "qr", label: "qr" },
  { id: "soundbox", label: "soundbox" },
  { id: "card", label: "card" },
  { id: "loan", label: "loan" },
];

// Paytm for Business landing screen. Paytm Saathi is the new first entry; the four existing products stay below it.
export default function BusinessHome() {
  const { session } = useAuth();
  const { t } = usePrefs();
  const openSaathi = () =>
    router.push(session ? "/saathi" : ({ pathname: "/sign-in", params: { next: "/saathi" } } as Href));

  return (
    <SafeAreaView style={s.screen} edges={["top", "left", "right", "bottom"]}>
      <View style={s.header}>
        <Pressable onPress={() => router.push("/profile")} style={s.avatar} accessibilityLabel="Profile and settings" hitSlop={8}>
          {session ? (
            <Txt style={s.avatarText}>{session.merchant.owner_name.charAt(0)}</Txt>
          ) : (
            <Ionicons name="person" size={26} color="#7FA6D9" />
          )}
          <View style={s.menuDot}>
            <Ionicons name="menu" size={11} color="#fff" />
          </View>
        </Pressable>
        <View style={{ flex: 1, alignItems: "center" }}>
          <BizLogo />
        </View>
        <Pressable onPress={() => router.push("/notifications")} style={s.bell} accessibilityLabel="Payment notifications" hitSlop={8}>
          <Ionicons name="notifications-outline" size={24} color={colors.navy} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <View style={{ flex: 1 }}>
            <Txt style={s.title}>{t("appTitle")}</Txt>
            <Txt style={s.tagline}>{t("tagline")}</Txt>
          </View>
          <View style={s.heroArt}>
            <Ionicons name="storefront" size={44} color="#F5B400" />
            <View style={s.heroCoin}><Txt style={{ color: "#fff", fontWeight: "900" }}>₹</Txt></View>
          </View>
        </View>

        <Pressable onPress={openSaathi} style={({ pressed }) => [s.saathi, pressed && { opacity: 0.92 }]} accessibilityRole="button" accessibilityLabel="Open Paytm Saathi, new feature">
          <View style={s.newBadge}>
            <Ionicons name="sparkles" size={10} color="#fff" />
            <Txt style={s.newText}>{t("newBadge")}</Txt>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={s.saathiIcon}>
              <Ionicons name="sparkles" size={28} color={colors.navy} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Txt style={s.saathiTitle}>{t("saathiTitle")}</Txt>
              <Txt style={s.saathiSub}>{t("saathiSub")}</Txt>
            </View>
          </View>
          <View style={s.saathiCta}>
            <Txt style={{ color: colors.navy, fontWeight: "800" }}>{t("saathiCta")}</Txt>
            <Ionicons name="arrow-forward" size={16} color={colors.navy} />
          </View>
        </Pressable>

        <View style={s.grid}>
          {PRODUCTS.map((p) => (
            <Pressable
              key={p.id}
              onPress={() => router.push({ pathname: "/product/[id]", params: { id: p.id } })}
              style={({ pressed }) => [s.tile, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
            >
              <ProductIcon id={p.id} size={56} />
              <Txt style={s.tileLabel}>{t(p.label)}</Txt>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={s.footer}>
        <Pressable
          onPress={() => router.push(session ? "/saathi" : "/sign-in")}
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
        >
          <Txt style={s.ctaText} numberOfLines={1}>
            {session ? `${t("continueAs")} ${session.merchant.display_name}` : t("login")}
          </Txt>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#EAF5FC" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  avatar: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", ...shadow,
  },
  avatarText: { fontSize: 22, fontWeight: "800", color: colors.navy },
  menuDot: {
    position: "absolute", left: -4, bottom: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.navy,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff",
  },
  bell: { width: 52, alignItems: "flex-end", justifyContent: "center", height: 52 },
  body: { paddingHorizontal: 16, paddingBottom: 24 },
  hero: { flexDirection: "row", alignItems: "center", marginTop: 18, marginBottom: 18 },
  title: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -0.5, lineHeight: 34 },
  tagline: { fontSize: 17, color: colors.inkSoft, marginTop: 6 },
  heroArt: {
    width: 92, height: 92, borderRadius: 46, backgroundColor: "#FFF4CC", alignItems: "center", justifyContent: "center", marginLeft: 8,
  },
  heroCoin: {
    position: "absolute", right: 4, bottom: 6, width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cyan,
    alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff",
  },
  saathi: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 18, marginBottom: 14, ...shadow, shadowOpacity: 0.18 },
  newBadge: {
    position: "absolute", top: -9, right: 16, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#E5262D",
    borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3, borderWidth: 2, borderColor: "#EAF5FC",
  },
  newText: { color: "#fff", fontSize: 11, fontWeight: "900", letterSpacing: 0.6 },
  saathiIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center" },
  saathiTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  saathiSub: { color: "#C9DDF5", fontSize: 13, marginTop: 3, lineHeight: 18 },
  saathiCta: {
    marginTop: 14, backgroundColor: "#fff", borderRadius: radius.md, paddingVertical: 11, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 14 },
  tile: {
    width: "48%", backgroundColor: "#fff", borderRadius: radius.lg, alignItems: "center", paddingVertical: 22, paddingHorizontal: 10,
    minHeight: 160, justifyContent: "center", ...shadow,
  },
  tileLabel: { marginTop: 12, fontSize: 16, fontWeight: "600", color: colors.ink, textAlign: "center", lineHeight: 21 },
  footer: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, backgroundColor: "#EAF5FC" },
  cta: { backgroundColor: colors.cyan, borderRadius: radius.md, minHeight: 54, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  ctaText: { color: "#fff", fontSize: 18, fontWeight: "700" },
});
