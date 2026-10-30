import { Ionicons } from "@expo/vector-icons";
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View,
  type ScrollViewInstance, type TextInputInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BriefList } from "@/components/BriefList";
import { PlanSummary } from "@/components/PlanSummary";
import { Brand, Button, Card, Row, Txt, styles as ui } from "@/components/ui";
import { api, ApiError, type AssistantResponse } from "@/lib/api";
import { clock } from "@/lib/hooks";
import { colors, radius } from "@/lib/theme";

type Msg =
  | { id: string; from: "me"; text: string; at: string; voice?: boolean }
  | { id: string; from: "saathi"; at: string; res?: AssistantResponse; text?: string; error?: boolean; originalText?: string };

const CHIPS = [
  { label: "Plan stock for weekend", text: "Weekend ke liye ₹5,000 ke andar stock arrange karo" },
  { label: "Diwali stock", text: "Diwali ke liye ₹10,000 ke andar stock arrange karo" },
  { label: "Collect dues", text: "Aman Stores ka pending payment collect karo" },
  { label: "Today's brief", text: "Aaj mere business mein kya important hai?" },
  { label: "Slow stock", text: "Kaunsa maal nahi bik raha?" },
  { label: "Khata", text: "Mera khata dikhao" },
  { label: "Cash flow", text: "Cash kab kam padega?" },
];
// Screens the assistant can point to (backend `open_screen`).
const SCREENS: Record<string, { label: string; href: Href }> = {
  festival: { label: "Open festival plan", href: "/grow/festival" },
  offers: { label: "Open slow stock offers", href: "/grow/offers" },
  khata: { label: "Open khata", href: "/grow/khata" },
  cashflow: { label: "Open cash flow", href: "/grow/cashflow" },
  bills: { label: "Add a supplier bill", href: "/grow/bills" },
  benchmarks: { label: "Compare with nearby stores", href: "/grow/benchmarks" },
  impact: { label: "See Saathi impact", href: "/grow/impact" },
};
const STEPS = ["Checking current stock", "Analyzing sales trends", "Comparing supplier prices"];
const now = () => new Date().toISOString();
const id = () => Math.random().toString(36).slice(2);

export default function Assistant() {
  const params = useLocalSearchParams<{ listen?: string; prompt?: string }>();
  const [lang, setLang] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [recording, setRecording] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const scroll = useRef<ScrollViewInstance>(null);
  const inputRef = useRef<TextInputInstance>(null);

  // Route params are external input (quick actions, the mic tab button): sync them into local state once.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.prompt === "restock") setInput(CHIPS[0].text);
    else if (params.prompt === "festival") setInput(CHIPS[1].text);
  }, [params.prompt]);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((n) => Math.min(n + 1, STEPS.length - 1)), 700);
    return () => clearInterval(t);
  }, [busy]);

  const push = (m: Msg) => {
    setMsgs((prev) => [...prev, m]);
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50);
  };

  const handle = async (call: () => Promise<AssistantResponse>, originalText?: string) => {
    setStep(0);
    setBusy(true);
    try {
      const res = await call();
      if (res.transcript) push({ id: id(), from: "me", text: res.transcript, at: now(), voice: true });
      push({ id: id(), from: "saathi", at: now(), res, originalText });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : String(e);
      push({ id: id(), from: "saathi", at: now(), text: message, error: true });
      if (e instanceof ApiError && e.code === "VOICE_UNAVAILABLE") inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const send = (text: string, confirmedBudget?: string) => {
    const t = text.trim();
    if (!t || busy) return;
    if (!confirmedBudget) push({ id: id(), from: "me", text: t, at: now() });
    setInput("");
    void handle(() => api.ask(t, confirmedBudget), t);
  };

  async function toggleMic() {
    if (busy) return;
    if (recording) {
      setRecording(false);
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return;
      const form = new FormData();
      if (Platform.OS === "web") {
        form.append("audio", await (await fetch(uri)).blob(), "voice.webm");
      } else {
        form.append("audio", { uri, name: "voice.m4a", type: "audio/mp4" } as unknown as Blob);
      }
      void handle(() => api.askVoiceLang(form, lang));
      return;
    }
    const perm = await requestRecordingPermissionsAsync();
    if (!perm.granted) {
      push({ id: id(), from: "saathi", at: now(), text: "Microphone permission is off. You can type your request below.", error: true });
      inputRef.current?.focus();
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    setRecording(true);
  }
  useEffect(() => {
    // The mic tab button navigates here with a fresh `listen` param; start recording once per press.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.listen) void toggleMic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.listen]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top", "left", "right"]}>
      <Row style={s.header}>
        <Brand />
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setLang(lang === "hi-IN" ? "en-IN" : "hi-IN")} style={s.lang} accessibilityLabel="Switch language">
          <Txt style={[s.langText, lang === "hi-IN" && s.langOn]}>हिंदी</Txt>
          <Txt style={[s.langText, lang === "en-IN" && s.langOn]}>EN</Txt>
        </Pressable>
      </Row>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: "center", marginTop: 4 }}>
            <Txt style={ui.h1}>{lang === "hi-IN" ? "Bataiye, kya karna hai?" : "How can I help?"}</Txt>
            <Txt style={[ui.muted, { fontSize: 14, marginTop: 2 }]}>Ask anything about your business</Txt>
            <Pressable onPress={toggleMic} style={[s.bigMic, recording && s.bigMicOn]} accessibilityLabel={recording ? "Stop and send" : "Tap to speak"}>
              <View style={[s.bigMicInner, recording && { backgroundColor: colors.red }]}>
                <Ionicons name={recording ? "stop" : "mic"} size={38} color="#fff" />
              </View>
            </Pressable>
            <Txt style={{ fontWeight: "700", color: recording ? colors.red : colors.navy }}>
              {recording ? "Listening… tap to send" : "Tap to speak"}
            </Txt>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 14 }} contentContainerStyle={{ gap: 8 }}>
            {CHIPS.map((c) => (
              <Pressable key={c.label} style={s.chip} onPress={() => send(c.text)}>
                <Txt style={s.chipText}>{c.label}</Txt>
              </Pressable>
            ))}
          </ScrollView>

          {msgs.map((m) =>
            m.from === "me" ? (
              <View key={m.id} style={s.meWrap}>
                <View style={s.me}>
                  {m.voice && <Ionicons name="mic" size={12} color="#fff" style={{ marginBottom: 2 }} />}
                  <Txt style={{ color: "#fff" }}>{m.text}</Txt>
                </View>
                <Txt style={s.time}>{clock(m.at)}</Txt>
              </View>
            ) : (
              <SaathiBubble key={m.id} m={m} onConfirmBudget={(v) => m.originalText && send(m.originalText, v)} onSend={send} />
            ),
          )}

          {busy && (
            <Card style={{ marginTop: 6 }}>
              <Row style={{ justifyContent: "space-between" }}>
                {STEPS.map((label, i) => (
                  <View key={label} style={{ alignItems: "center", flex: 1, opacity: i <= step ? 1 : 0.4 }}>
                    <Ionicons name={(["cube-outline", "bar-chart-outline", "pricetags-outline"] as const)[i]} size={20} color={colors.cyan} />
                    <Txt style={[ui.muted, { textAlign: "center", fontSize: 11, marginTop: 4 }]}>{label}</Txt>
                  </View>
                ))}
              </Row>
              <View style={s.progress}>
                <View style={[s.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
              </View>
            </Card>
          )}
        </ScrollView>

        <Row style={s.composer}>
          <TextInput
            ref={inputRef}
            value={input}
            onChangeText={setInput}
            placeholder="Type your request…"
            placeholderTextColor={colors.muted}
            style={s.input}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
            maxLength={500}
            accessibilityLabel="Message"
          />
          <Pressable onPress={() => send(input)} disabled={!input.trim() || busy} style={[s.send, (!input.trim() || busy) && { opacity: 0.4 }]} accessibilityLabel="Send">
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="send" size={18} color="#fff" />}
          </Pressable>
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SaathiBubble({ m, onConfirmBudget, onSend }: {
  m: Extract<Msg, { from: "saathi" }>; onConfirmBudget: (v: string) => void; onSend: (t: string) => void;
}) {
  const res = m.res;
  const confirm = res?.needs_confirmation as { field?: string; value?: string | null } | null | undefined;
  return (
    <View style={{ marginBottom: 14 }}>
      <Row style={{ alignItems: "flex-start" }}>
        <View style={s.ava}><Ionicons name="sparkles" size={14} color={colors.cyan} /></View>
        <View style={{ flex: 1 }}>
          <View style={[s.saathi, m.error && { backgroundColor: colors.redSoft }]}>
            <Txt style={m.error ? { color: colors.red } : undefined}>{m.text ?? res?.reply}</Txt>
          </View>

          {confirm?.value && (
            <Row style={{ gap: 8, marginTop: 8 }}>
              <Button small label={`Haan, ₹${Number(confirm.value).toLocaleString("en-IN")}`} icon="checkmark" onPress={() => onConfirmBudget(confirm.value!)} />
            </Row>
          )}
          {res?.suggestions?.length ? (
            <View style={{ gap: 6, marginTop: 8 }}>
              {res.suggestions.map((sug) => (
                <Pressable key={sug} style={s.chip} onPress={() => (sug.startsWith("₹") ? onConfirmBudget(sug.replace(/[₹,]/g, "")) : onSend(sug))}>
                  <Txt style={s.chipText}>{sug}</Txt>
                </Pressable>
              ))}
            </View>
          ) : null}

          {res?.task && (
            <Card style={{ marginTop: 10, marginBottom: 0 }} onPress={() => router.push({ pathname: "/task/[id]", params: { id: res.task!.id } })}>
              <PlanSummary task={res.task} />
              <Button label="Review & approve" icon="shield-checkmark-outline" style={{ marginTop: 12 }}
                onPress={() => router.push({ pathname: "/task/[id]", params: { id: res.task!.id } })} />
            </Card>
          )}
          {res?.open_screen && SCREENS[res.open_screen] && (
            <Button small kind="secondary" icon="arrow-forward" label={SCREENS[res.open_screen].label} style={{ marginTop: 8, alignSelf: "flex-start" }}
              onPress={() => router.push(SCREENS[res.open_screen!].href)} />
          )}
          {res?.brief && (
            <Card style={{ marginTop: 10, marginBottom: 0 }}>
              <BriefList brief={res.brief} />
            </Card>
          )}
          <Txt style={[s.time, { textAlign: "left" }]}>{clock(m.at)}</Txt>
        </View>
      </Row>
    </View>
  );
}

const s = StyleSheet.create({
  header: { paddingHorizontal: 16, paddingVertical: 10 },
  lang: { flexDirection: "row", backgroundColor: colors.cyanSoft, borderRadius: radius.pill, padding: 3 },
  langText: { paddingHorizontal: 10, paddingVertical: 4, fontSize: 12, fontWeight: "700", color: colors.inkSoft, borderRadius: radius.pill, overflow: "hidden" },
  langOn: { backgroundColor: "#fff", color: colors.navy },
  bigMic: { marginTop: 18, marginBottom: 10, width: 116, height: 116, borderRadius: 58, backgroundColor: colors.cyanSoft, alignItems: "center", justifyContent: "center" },
  bigMicOn: { backgroundColor: colors.redSoft },
  bigMicInner: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center" },
  chip: { backgroundColor: colors.cyanSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, alignSelf: "flex-start" },
  chipText: { color: "#0072A0", fontWeight: "700", fontSize: 13 },
  meWrap: { alignItems: "flex-end", marginBottom: 12 },
  me: { backgroundColor: colors.navy, padding: 12, borderRadius: 18, borderBottomRightRadius: 4, maxWidth: "85%" },
  saathi: { backgroundColor: "#fff", padding: 12, borderRadius: 18, borderTopLeftRadius: 4, alignSelf: "flex-start" },
  ava: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.cyanSoft, alignItems: "center", justifyContent: "center", marginRight: 8 },
  time: { fontSize: 10, color: colors.muted, marginTop: 4 },
  progress: { height: 6, backgroundColor: colors.line, borderRadius: 3, marginTop: 12, overflow: "hidden" },
  progressFill: { height: 6, backgroundColor: colors.cyan },
  composer: { padding: 10, backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: colors.line, gap: 8 },
  input: { flex: 1, minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.bg, paddingHorizontal: 16, fontSize: 15, color: colors.ink },
  send: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center" },
});
