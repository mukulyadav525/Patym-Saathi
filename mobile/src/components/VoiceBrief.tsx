import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { Txt } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { playBase64, stopPlayback } from "@/lib/voice";
import { useVoiceAgent } from "@/lib/voiceAgent";
import { colors, radius } from "@/lib/theme";

// "Suno" morning brief: text built on the server from records; spoken by Sarvam Bulbul when configured.
export function VoiceBrief() {
  const agent = useVoiceAgent();
  const [lang, setLang] = useState<"hi-IN" | "en-IN">("hi-IN");
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => () => stopPlayback(), []); // leaving the screen stops the brief

  const play = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await api.briefSpeech(lang, true);
      setText(res.text);
      if (res.audio_base64) {
        agent.pause("brief"); // don't let the wake-word listener hear the brief ("...Saathi aapki manzoori...")
        await playBase64(res.audio_base64, res.mime ?? "audio/mpeg", () => agent.resume("brief"));
      }
      else setNote("Voice is off (no Sarvam key on the server). Showing the text instead.");
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : "Couldn't play the brief");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <View style={s.row}>
        <Pressable onPress={() => void play()} style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]} accessibilityRole="button"
          accessibilityLabel="Listen to today's brief">
          {busy ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="volume-high" size={18} color="#fff" />}
          <Txt style={s.btnText}>{lang === "hi-IN" ? "Suno aaj ka brief" : "Listen to today's brief"}</Txt>
        </Pressable>
        <Pressable onPress={() => setLang(lang === "hi-IN" ? "en-IN" : "hi-IN")} style={s.lang} accessibilityLabel="Switch brief language">
          <Txt style={s.langText}>{lang === "hi-IN" ? "हिं" : "EN"}</Txt>
        </Pressable>
      </View>
      {text && <Txt style={s.text}>{text}</Txt>}
      {note && <Txt style={s.note}>{note}</Txt>}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, minHeight: 44, borderRadius: radius.pill, backgroundColor: colors.navy },
  btnText: { color: "#fff", fontWeight: "800" },
  lang: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  langText: { fontWeight: "800", color: colors.navy },
  text: { marginTop: 10, fontSize: 13, color: colors.inkSoft, lineHeight: 19 },
  note: { marginTop: 6, fontSize: 11, color: colors.muted },
});
