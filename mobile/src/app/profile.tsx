import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizHeader } from "@/components/biz";
import { Txt, type IconName } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { usePrefs, type StringKey } from "@/lib/prefs";
import { colors, radius } from "@/lib/theme";

const signInThen = (next: string) => ({ pathname: "/sign-in", params: { next } }) as Href;

export default function Profile() {
  const { session, signOut } = useAuth();
  const { t, lang } = usePrefs();

  const items: { key: StringKey; icon: IconName; go: () => void; value?: string }[] = [
    { key: "settlements", icon: "cash-outline", go: () => router.push(session ? "/settlements" : signInThen("/settlements")) },
    { key: "notifications", icon: "notifications-outline", go: () => router.push("/notifications") },
    { key: "language", icon: "language-outline", go: () => router.push("/language"), value: lang === "hi" ? "हिन्दी" : "English" },
    { key: "legal", icon: "document-lock-outline", go: () => router.push("/legal") },
  ];

  const confirmSignOut = () =>
    Alert.alert(t("signOut"), session?.user.email ?? "", [
      { text: lang === "hi" ? "रद्द करें" : "Cancel", style: "cancel" },
      { text: t("signOut"), style: "destructive", onPress: () => void signOut() },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "left", "right", "bottom"]}>
      <BizHeader close />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        {session ? (
          <View style={s.account}>
            <View style={s.avatar}>
              <Txt style={{ fontSize: 24, fontWeight: "800", color: colors.navy }}>{session.merchant.owner_name.charAt(0)}</Txt>
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Txt style={{ fontSize: 18, fontWeight: "800" }}>{session.merchant.owner_name}</Txt>
              <Txt style={{ color: colors.inkSoft, fontWeight: "600" }}>{session.merchant.display_name}</Txt>
              <Txt style={s.meta}>{session.merchant.locality} · {session.user.email}</Txt>
              <Txt style={s.meta}>MID {session.merchant.id.slice(0, 8).toUpperCase()}{session.demo_mode ? " · DEMO" : ""}</Txt>
            </View>
          </View>
        ) : (
          <View style={s.account}>
            <View style={s.avatar}><Ionicons name="person" size={28} color="#7FA6D9" /></View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Txt style={{ fontSize: 17, fontWeight: "800" }}>{t("notSignedIn")}</Txt>
              <Txt style={s.meta}>{t("notSignedInSub")}</Txt>
            </View>
          </View>
        )}

        <Pressable onPress={() => router.push(session ? "/saathi" : signInThen("/saathi"))} style={s.saathi} accessibilityRole="button">
          <View style={s.saathiIcon}><Ionicons name="sparkles" size={20} color="#fff" /></View>
          <Txt style={{ flex: 1, marginLeft: 12, fontSize: 17, fontWeight: "700", color: colors.navy }}>{t("saathiTitle")}</Txt>
          <View style={s.newBadge}><Txt style={s.newText}>{t("newBadge")}</Txt></View>
          <Ionicons name="chevron-forward" size={22} color={colors.ink} />
        </Pressable>

        {items.map((it) => (
          <Pressable key={it.key} onPress={it.go} style={({ pressed }) => [s.row, pressed && { backgroundColor: "#F5F8FB" }]} accessibilityRole="button">
            <Ionicons name={it.icon} size={26} color={colors.ink} style={{ width: 34 }} />
            <View style={s.rowBody}>
              <Txt style={s.rowText}>{t(it.key)}</Txt>
              {it.value && <Txt style={[s.meta, { marginRight: 6 }]}>{it.value}</Txt>}
              <Ionicons name="chevron-forward" size={22} color={colors.ink} />
            </View>
          </Pressable>
        ))}

        <View style={{ paddingHorizontal: 20, marginTop: 24 }}>
          {session ? (
            <Pressable onPress={confirmSignOut} style={[s.btn, { borderColor: "#F3C5C5" }]} accessibilityRole="button">
              <Ionicons name="log-out-outline" size={18} color={colors.red} />
              <Txt style={{ color: colors.red, fontWeight: "700", marginLeft: 6 }}>{t("signOut")}</Txt>
            </Pressable>
          ) : (
            <Pressable onPress={() => router.push("/sign-in")} style={[s.btn, { backgroundColor: colors.cyan, borderColor: colors.cyan }]} accessibilityRole="button">
              <Txt style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>{t("login")}</Txt>
            </Pressable>
          )}
          <Txt style={[s.meta, { textAlign: "center", marginTop: 16 }]}>Independent hackathon concept · TeamAIR01 · v0.1.0</Txt>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  account: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginBottom: 8, padding: 16, borderRadius: radius.lg, backgroundColor: "#EAF5FC" },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  meta: { color: colors.muted, fontSize: 13, marginTop: 2 },
  saathi: {
    flexDirection: "row", alignItems: "center", marginHorizontal: 16, marginTop: 8, marginBottom: 4, padding: 14,
    borderRadius: radius.md, borderWidth: 1, borderColor: "#BFE9FA", backgroundColor: "#F2FBFF",
  },
  saathiIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  newBadge: { backgroundColor: "#E5262D", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginRight: 6 },
  newText: { color: "#fff", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  row: { flexDirection: "row", alignItems: "center", paddingLeft: 24, paddingRight: 20 },
  rowBody: { flex: 1, flexDirection: "row", alignItems: "center", paddingVertical: 26, borderBottomWidth: 1, borderBottomColor: colors.line, marginLeft: 12 },
  rowText: { flex: 1, fontSize: 18, color: colors.ink },
  btn: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
