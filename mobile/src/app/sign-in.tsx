import { Ionicons } from "@expo/vector-icons";
import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Brand, Button, Card, Txt, styles as ui } from "@/components/ui";
import { ApiError, changeApiBase, getApiBase, SERVER_EDITABLE } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, radius } from "@/lib/theme";

export default function SignIn() {
  const { signIn, session } = useAuth();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [email, setEmail] = useState("mukul24360@iiitd.ac.in");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState(getApiBase());

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
        <ServerRow server={server} onChanged={setServer} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Which laptop the app talks to. Editable only in demo builds (see SERVER_EDITABLE); checked before it's saved.
function ServerRow({ server, onChanged }: { server: string; onChanged: (url: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(server.replace(/^http:\/\//, ""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = server.replace(/^https?:\/\//, "");

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await changeApiBase(value));
      setEditing(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <View style={{ marginTop: 10 }}>
        <Txt style={[ui.muted, { fontSize: 11, textAlign: "center" }]}>Hackathon prototype · sample data</Txt>
        <View style={s.serverRow}>
          <Txt style={[ui.muted, { fontSize: 11, flexShrink: 1 }]} numberOfLines={1}>Server {shown}</Txt>
          {SERVER_EDITABLE && (
            <Pressable onPress={() => setEditing(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Change server">
              <Txt style={s.change}>Change</Txt>
            </Pressable>
          )}
        </View>
      </View>
    );
  }
  return (
    <Card style={{ marginTop: 12 }}>
      <Txt style={s.label}>Server address</Txt>
      <TextInput
        value={value} onChangeText={setValue} autoCapitalize="none" autoCorrect={false} keyboardType="url" onSubmitEditing={save}
        style={s.input} placeholder="192.168.1.5:8000" placeholderTextColor={colors.muted} accessibilityLabel="Server address"
      />
      <Txt style={[ui.muted, { fontSize: 12, marginTop: 6 }]}>The laptop running Saathi, on the same Wi-Fi as this phone.</Txt>
      {error && (
        <View style={s.error}>
          <Ionicons name="alert-circle" size={16} color={colors.red} />
          <Txt style={{ color: colors.red, marginLeft: 6, flex: 1, fontSize: 13 }}>{error}</Txt>
        </View>
      )}
      <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
        <Button label="Cancel" kind="secondary" small style={{ flex: 1 }} onPress={() => { setEditing(false); setError(null); }} />
        <Button label="Connect" small style={{ flex: 1 }} loading={busy} disabled={!value.trim()} onPress={() => void save()} />
      </View>
    </Card>
  );
}

const s = StyleSheet.create({
  serverRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 4, paddingHorizontal: 8 },
  change: { color: "#0083AD", fontWeight: "700", fontSize: 12 },
  back: { width: 44, height: 44, marginLeft: 8, marginTop: 4, alignItems: "center", justifyContent: "center" },
  wrap: { flex: 1, justifyContent: "center", padding: 20 },
  hero: { alignItems: "center", marginBottom: 24 },
  logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  label: { fontSize: 13, fontWeight: "700", color: colors.inkSoft, marginBottom: 6 },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16, color: colors.ink, backgroundColor: "#FAFCFE" },
  error: { flexDirection: "row", alignItems: "center", marginTop: 12, backgroundColor: colors.redSoft, padding: 10, borderRadius: radius.sm },
});
