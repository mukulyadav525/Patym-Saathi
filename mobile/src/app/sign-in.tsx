import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand, Button, Card, Txt, styles as ui } from "@/components/ui";
import { API_BASE, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, radius } from "@/lib/theme";

export default function SignIn() {
  const { signIn, session } = useAuth();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [email, setEmail] = useState("mukul24360@iiitd.ac.in");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  // Once signed in, continue where the user was heading (Saathi by default).
  if (session) return <Redirect href={(next?.startsWith("/") ? next : "/saathi") as Href} />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
        style={s.back} hitSlop={12} accessibilityLabel="Back to Paytm for Business"
      >
        <Ionicons name="arrow-back" size={24} color={colors.navy} />
      </Pressable>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.wrap}>
        <View style={s.hero}>
          <View style={s.logo}>
            <Ionicons name="sparkles" size={30} color="#fff" />
          </View>
          <Brand size={30} />
          <Txt style={[ui.muted, { fontSize: 15, marginTop: 6, textAlign: "center" }]}>
            Aapka business partner. Plan, approve and act — in one conversation.
          </Txt>
        </View>
        <Card>
          <Txt style={s.label}>Email</Txt>
          <TextInput
            value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
            style={s.input} placeholder="you@store.in" placeholderTextColor={colors.muted} accessibilityLabel="Email"
          />
          <Txt style={[s.label, { marginTop: 12 }]}>Password</Txt>
          <TextInput
            value={password} onChangeText={setPassword} secureTextEntry style={s.input} onSubmitEditing={submit}
            placeholder="Demo password" placeholderTextColor={colors.muted} accessibilityLabel="Password"
          />
          {error && (
            <View style={s.error}>
              <Ionicons name="alert-circle" size={16} color={colors.red} />
              <Txt style={{ color: colors.red, marginLeft: 6, flex: 1, fontSize: 13 }}>{error}</Txt>
            </View>
          )}
          <Button label="Sign in" onPress={submit} loading={busy} disabled={!email || !password} style={{ marginTop: 16 }} />
        </Card>
        <Txt style={[ui.muted, { textAlign: "center", marginTop: 8, fontSize: 11 }]}>
          Hackathon prototype · sample data · API {API_BASE.replace(/^https?:\/\//, "")}
        </Txt>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  back: { width: 44, height: 44, marginLeft: 8, marginTop: 4, alignItems: "center", justifyContent: "center" },
  wrap: { flex: 1, justifyContent: "center", padding: 20 },
  hero: { alignItems: "center", marginBottom: 24 },
  logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "700", color: colors.inkSoft, marginBottom: 6 },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: "#FAFCFE" },
  error: { flexDirection: "row", alignItems: "center", marginTop: 12, backgroundColor: colors.redSoft, padding: 10, borderRadius: radius.sm },
});
