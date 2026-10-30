import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizHeader } from "@/components/biz";
import { Button, Txt } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors, radius } from "@/lib/theme";

// Optional approval PIN. Stored only as a hash on the server; when set, every approval needs it.
export default function ApprovalPin() {
  const { session, refresh } = useAuth();
  const has = !!session?.user.has_approval_pin;
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<"set" | "clear" | null>(null);

  const save = async (next: string | null) => {
    setBusy(next ? "set" : "clear");
    try {
      const r = await api.setApprovalPin(password, next);
      await refresh();
      Alert.alert("Done", r.message);
      router.back();
    } catch (e) {
      Alert.alert("Not saved", e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 4);
  const mismatch = again.length === 4 && pin !== again;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "left", "right", "bottom"]}>
      <BizHeader title="Approval PIN" />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, padding: 20 }}>
        <View style={s.info}>
          <Ionicons name="shield-checkmark" size={22} color={colors.navy} />
          <Txt style={{ flex: 1, marginLeft: 10, color: colors.inkSoft }}>
            {has
              ? "A PIN is set. Saathi asks for it before every order or payment link you approve."
              : "Add a 4-digit PIN so nobody else holding your phone can approve orders or payment links."}
          </Txt>
        </View>

        <Txt style={s.label}>{has ? "New PIN" : "PIN"}</Txt>
        <TextInput value={pin} onChangeText={(t) => setPin(digits(t))} keyboardType="number-pad" secureTextEntry maxLength={4}
          style={[s.input, pin.length > 0 && s.dots]} placeholder="4 digits" placeholderTextColor={colors.muted} accessibilityLabel="New PIN" />
        <Txt style={s.label}>Confirm PIN</Txt>
        <TextInput value={again} onChangeText={(t) => setAgain(digits(t))} keyboardType="number-pad" secureTextEntry maxLength={4}
          style={[s.input, again.length > 0 && s.dots]} placeholder="Repeat PIN" placeholderTextColor={colors.muted} accessibilityLabel="Confirm PIN" />
        {mismatch && <Txt style={{ color: colors.red, marginTop: -6, marginBottom: 8 }}>PINs don’t match</Txt>}
        <Txt style={s.label}>Account password</Txt>
        <TextInput value={password} onChangeText={setPassword} secureTextEntry style={s.input}
          placeholder="Needed to change the PIN" placeholderTextColor={colors.muted} accessibilityLabel="Account password" />

        <Button label={has ? "Change PIN" : "Set PIN"} icon="lock-closed" loading={busy === "set"} style={{ marginTop: 8 }}
          disabled={pin.length !== 4 || pin !== again || !password} onPress={() => void save(pin)} />
        {has && (
          <Button label="Remove PIN" kind="danger" icon="lock-open-outline" loading={busy === "clear"} style={{ marginTop: 10 }}
            disabled={!password} onPress={() => void save(null)} />
        )}
        <Txt style={{ color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 16 }}>
          5 wrong tries lock approvals for 10 minutes. Voice never approves.
        </Txt>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  info: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: radius.md, backgroundColor: "#EAF5FC", marginBottom: 18 },
  label: { fontSize: 13, fontWeight: "700", color: colors.inkSoft, marginBottom: 6 },
  input: {
    minHeight: 50, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: 14, fontSize: 16,
    color: colors.ink, backgroundColor: "#FAFCFE", marginBottom: 14,
  },
  dots: { letterSpacing: 8 },
});
