import { Ionicons } from "@expo/vector-icons";
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { router, type Href } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Txt } from "@/components/ui";
import { api, ApiError, type AssistantResponse } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { usePrefs } from "@/lib/prefs";
import { speakText, stopSpeaking } from "@/lib/voice";
import { colors, radius, shadow } from "@/lib/theme";

/**
 * "Hey Saathi": on-device speech recognition listens while the app is open (foreground only, never in the
 * background). Saying "Hey Saathi" (Hindi or English) wakes Saathi; the request that follows is sent as text to the
 * assistant, which answers from the merchant's records. The reply is shown and spoken. Actions (orders, payment
 * links) still open the normal review-and-approve screen: voice never approves anything.
 */

type Phase = "off" | "idle" | "awake" | "thinking" | "answer" | "error";
type Agent = {
  phase: Phase;
  available: boolean;
  /** Start listening for a request right away (mic button), no wake word needed. */
  activate: () => void;
  /** Pause listening while another part of the app uses the mic or plays audio. */
  pause: (reason: string) => void;
  resume: (reason: string) => void;
  close: () => void;
};

const AgentContext = createContext<Agent | null>(null);

// "hey saathi", "hi sathi", "ok saathi", "हे साथी", "साथी" ... (on-device recognizers spell it many ways)
const WAKE = /(?:^|\s)(?:(?:hey|hi|hello|ok|okay|he|hay|aye|हे|हाय|ओके|है)[\s,]+)?(?:saathi\s*ji|sathi\s*ji|saath\s+hi|sath\s+hi|saathi|sathi|saathee|sathee|saathy|sathy|saati|saarthi|sarthi|sarathi|साथी|साथि|सारथी|साथ\s?ही|साथ\s?ी)(?=[\s,.!?।]|$)[\s,.!?।]*/i;
const AWAKE_TIMEOUT_MS = 8000;
const SCREENS: Record<string, Href> = {
  festival: "/grow/festival", offers: "/grow/offers", khata: "/grow/khata", cashflow: "/grow/cashflow",
  bills: "/grow/bills", benchmarks: "/grow/benchmarks", impact: "/grow/impact",
};

export function VoiceAgentProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { wakeWord, speakReplies } = usePrefs();
  const [phase, setPhase] = useState<Phase>("off");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState<AssistantResponse | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === "active");

  const phaseRef = useRef<Phase>("off");
  const running = useRef(false);
  const pauses = useRef(new Set<string>());
  const awakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failures = useRef(0);
  // When Saathi asks a follow-up (e.g. the budget), the next utterance answers it.
  const followUp = useRef<{ text: string; value: string | null } | null>(null);

  const enabled = !!session && foreground && available;
  const setP = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const startRecognition = useCallback(async () => {
    if (running.current || pauses.current.size > 0) return;
    running.current = true;
    try {
      // An aborted session's "end" can arrive after a restart; trust the recognizer's own state, not our flag.
      const state = await ExpoSpeechRecognitionModule.getStateAsync().catch(() => "inactive");
      if (state !== "inactive") return;
      ExpoSpeechRecognitionModule.start({
        lang: "hi-IN", // Hindi recognizer also handles Hinglish and English words
        interimResults: true,
        maxAlternatives: 1,
        continuous: Platform.OS !== "android" || Number(Platform.Version) >= 33,
        addsPunctuation: false,
        androidIntentOptions: { EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 1200, EXTRA_MASK_OFFENSIVE_WORDS: false },
      });
    } catch {
      running.current = false;
    }
  }, []);

  const stopRecognition = useCallback(() => {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    if (!running.current) return;
    running.current = false;
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      /* not running */
    }
  }, []);

  const shouldListen = useCallback(
    () => enabled && pauses.current.size === 0 && (phaseRef.current === "awake" || (wakeWord && phaseRef.current === "idle")),
    [enabled, wakeWord],
  );

  const scheduleRestart = useCallback((delay: number) => {
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = setTimeout(() => {
      if (shouldListen()) void startRecognition();
    }, delay);
  }, [shouldListen, startRecognition]);

  const toIdle = useCallback(() => {
    if (awakeTimer.current) clearTimeout(awakeTimer.current);
    setP(enabled ? "idle" : "off");
    setHeard("");
    scheduleRestart(250);
  }, [enabled, scheduleRestart]);

  const goAwake = useCallback(() => {
    setP("awake");
    setReply(null);
    setErrorText(null);
    setHeard("");
    if (awakeTimer.current) clearTimeout(awakeTimer.current);
    awakeTimer.current = setTimeout(() => {
      if (phaseRef.current === "awake") toIdle();
    }, AWAKE_TIMEOUT_MS);
    if (!running.current) void startRecognition();
  }, [startRecognition, toIdle]);

  const ask = useCallback(async (spoken: string, confirmed?: string) => {
    if (awakeTimer.current) clearTimeout(awakeTimer.current);
    stopRecognition();
    setP("thinking");
    setHeard(spoken);
    // Follow-up answer: "haan" confirms the value Saathi read back; anything else is added to the original request.
    let text = spoken;
    let budget = confirmed;
    const pending = followUp.current;
    followUp.current = null;
    if (pending && !budget) {
      if (pending.value && /^(haan|ha|han|yes|sahi|theek|thik|ok|okay|हाँ|हां|हा|सही|ठीक)\b/i.test(spoken.trim())) budget = pending.value;
      text = budget ? pending.text : `${pending.text} ${spoken}`;
    }
    try {
      const res = await api.ask(text, budget, speakReplies);
      setReply(res);
      setP("answer");
      if (res.needs_confirmation) {
        followUp.current = { text, value: (res.needs_confirmation.value as string | null) ?? null };
      }
      const after = () => {
        pauses.current.delete("speaking");
        if (phaseRef.current !== "answer") return;
        if (followUp.current) goAwake();
        else scheduleRestart(300);
      };
      if (speakReplies) {
        pauses.current.add("speaking");
        speakText(res.speech || res.reply, after);
      } else {
        after();
      }
    } catch (e) {
      setErrorText(e instanceof ApiError ? e.message : "Saathi se baat nahi ho paayi. Dobara koshish karein.");
      setP("error");
      scheduleRestart(500);
    }
  }, [goAwake, scheduleRestart, speakReplies, stopRecognition]);

  useSpeechRecognitionEvent("start", () => {
    running.current = true;
    failures.current = 0;
  });

  useSpeechRecognitionEvent("result", (event) => {
    const text = (event.results[0]?.transcript ?? "").trim();
    if (!text) return;
    const p = phaseRef.current;
    if (p === "awake") {
      setHeard(text);
      if (awakeTimer.current) clearTimeout(awakeTimer.current);
      awakeTimer.current = setTimeout(() => {
        if (phaseRef.current === "awake") toIdle();
      }, AWAKE_TIMEOUT_MS);
      if (event.isFinal) {
        const command = text.replace(WAKE, " ").trim();
        if (command.length >= 2) void ask(command);
      }
      return;
    }
    if ((p === "idle" || p === "answer" || p === "error") && WAKE.test(text)) {
      const command = text.replace(WAKE, " ").trim();
      stopSpeaking();
      if (event.isFinal && command.length >= 3) {
        void ask(command); // "Hey Saathi, atta kitna bacha hai?" in one breath
      } else {
        goAwake();
        if (command) setHeard(command);
      }
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    running.current = false;
    if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "language-not-supported") {
      setAvailable(false);
      // Only interrupt the user if they asked to talk; background listening just switches itself off (home shows it).
      if (phaseRef.current === "awake") {
        setErrorText(event.error === "not-allowed"
          ? "Microphone permission is off. Turn it on in Settings to use Hey Saathi."
          : "This phone's speech service isn't available. Use the big mic on the Saathi tab instead.");
        setP("error");
      } else {
        setP("off");
      }
      return;
    }
    if (event.error === "aborted") return;
    failures.current += 1;
  });

  useSpeechRecognitionEvent("end", () => {
    running.current = false;
    if (shouldListen()) scheduleRestart(Math.min(5000, 300 * 2 ** Math.min(failures.current, 4)));
  });

  // Foreground only: stop listening as soon as the app leaves the screen.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setForeground(s === "active"));
    return () => sub.remove();
  }, []);

  // Ask for the mic + speech permission once, when signed in with the wake word on.
  useEffect(() => {
    if (!session || !wakeWord) return;
    let cancelled = false;
    (async () => {
      try {
        if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
          if (!cancelled) setAvailable(false);
          return;
        }
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!cancelled) setAvailable(perm.granted);
      } catch {
        if (!cancelled) setAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, wakeWord]);

  // Start/stop the background listener as conditions change.
  useEffect(() => {
    if (!enabled) {
      stopRecognition();
      stopSpeaking();
      if (phaseRef.current !== "error") setP("off");
      return;
    }
    if (phaseRef.current === "off") setP("idle");
    if (wakeWord && pauses.current.size === 0) void startRecognition();
    else if (!wakeWord && phaseRef.current === "idle") stopRecognition();
  }, [enabled, wakeWord, startRecognition, stopRecognition]);

  useEffect(() => () => {
    stopRecognition();
    stopSpeaking();
  }, [stopRecognition]);

  const pause = useCallback((reason: string) => {
    pauses.current.add(reason);
    stopRecognition();
  }, [stopRecognition]);

  const resume = useCallback((reason: string) => {
    pauses.current.delete(reason);
    scheduleRestart(300);
  }, [scheduleRestart]);

  const close = useCallback(() => {
    followUp.current = null;
    stopSpeaking();
    pauses.current.delete("speaking");
    setReply(null);
    setErrorText(null);
    toIdle();
  }, [toIdle]);

  const activate = useCallback(() => {
    stopSpeaking();
    pauses.current.delete("speaking");
    if (!available) {
      setErrorText("Speech service isn't available on this phone. Use the big mic on the Saathi tab.");
      setP("error");
      return;
    }
    // Keep a running session (wake-word listening) and just switch to "awake"; restarting would race with "end".
    goAwake();
  }, [available, goAwake]);

  const value = useMemo(() => ({ phase, available, activate, pause, resume, close }), [phase, available, activate, pause, resume, close]);

  return (
    <AgentContext.Provider value={value}>
      {children}
      <AgentSheet phase={phase} heard={heard} reply={reply} errorText={errorText} onClose={close}
        onChoose={(v) => {
          const pending = followUp.current;
          if (pending) void ask(v, v.replace(/[₹,]/g, ""));
        }}
        onAsk={(text) => {
          followUp.current = null;
          void ask(text);
        }} />
    </AgentContext.Provider>
  );
}

export function useVoiceAgent() {
  const ctx = useContext(AgentContext);
  if (!ctx) throw new Error("useVoiceAgent outside VoiceAgentProvider");
  return ctx;
}

function AgentSheet({ phase, heard, reply, errorText, onClose, onChoose, onAsk }: {
  phase: Phase; heard: string; reply: AssistantResponse | null; errorText: string | null; onClose: () => void;
  onChoose: (value: string) => void; onAsk: (text: string) => void;
}) {
  const insets = useSafeAreaInsets();
  if (phase === "off" || phase === "idle") return null;
  const go = (href: Href) => {
    onClose();
    router.push(href);
  };
  const task = reply?.task;
  const screen = reply?.open_screen ? SCREENS[reply.open_screen] : undefined;
  return (
    <View style={[s.wrap, { bottom: Math.max(insets.bottom, 12) + 70 }]} pointerEvents="box-none">
      <View style={s.sheet} accessibilityLiveRegion="polite">
        <View style={s.head}>
          <View style={[s.orb, phase === "awake" && s.orbLive]}>
            {phase === "thinking" ? <ActivityIndicator color="#fff" /> : <Ionicons name={phase === "error" ? "alert" : "mic"} size={20} color="#fff" />}
          </View>
          <Txt style={s.title}>
            {phase === "awake" ? "Boliye, main sun raha hoon…" : phase === "thinking" ? "Dekh raha hoon…" : phase === "error" ? "Saathi" : "Saathi"}
          </Txt>
          <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close Saathi"><Ionicons name="close" size={22} color="#C9DDF5" /></Pressable>
        </View>
        {!!heard && <Txt style={s.heard} numberOfLines={2}>“{heard}”</Txt>}
        {phase === "answer" && reply && (
          <>
            <Txt style={s.reply}>{reply.reply}</Txt>
            {reply.brief?.priorities.map((p) => <Txt key={p.title} style={s.point}>• {p.title}</Txt>)}
            <View style={s.actions}>
              {task && (
                <Pressable style={s.primary} onPress={() => go({ pathname: "/task/[id]", params: { id: task.id } })} accessibilityRole="button">
                  <Txt style={s.primaryText}>{task.pending_approval_id ? "Review & approve" : "Open task"}</Txt>
                </Pressable>
              )}
              {screen && (
                <Pressable style={s.primary} onPress={() => go(screen)} accessibilityRole="button">
                  <Txt style={s.primaryText}>Open</Txt>
                </Pressable>
              )}
              {reply.needs_confirmation?.value ? (
                <Pressable style={s.primary} onPress={() => onChoose(`₹${reply.needs_confirmation!.value as string}`)} accessibilityRole="button">
                  <Txt style={s.primaryText}>Haan, ₹{Number(reply.needs_confirmation.value).toLocaleString("en-IN")}</Txt>
                </Pressable>
              ) : reply.needs_confirmation ? reply.suggestions.filter((x) => x.startsWith("₹")).map((x) => (
                <Pressable key={x} style={s.chip} onPress={() => onChoose(x)} accessibilityRole="button">
                  <Txt style={s.primaryText}>{x}</Txt>
                </Pressable>
              )) : reply.suggestions.slice(0, 2).map((x) => (
                <Pressable key={x} style={s.chip} onPress={() => onAsk(x)} accessibilityRole="button">
                  <Txt style={s.primaryText} numberOfLines={1}>{x}</Txt>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {phase === "error" && <Txt style={s.reply}>{errorText}</Txt>}
        {phase === "awake" && <Txt style={s.hint}>Jaise: “atta kitna bacha hai?”, “Aman ka kitna baaki hai?”, “aaj ka brief”</Txt>}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 50 },
  sheet: { backgroundColor: colors.navy, borderRadius: radius.lg, padding: 16, ...shadow, shadowOpacity: 0.3, elevation: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  orb: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center" },
  orbLive: { borderWidth: 3, borderColor: "#7FDBFF" },
  title: { flex: 1, color: "#fff", fontWeight: "800", fontSize: 16 },
  heard: { color: "#C9DDF5", marginTop: 10, fontStyle: "italic" },
  reply: { color: "#fff", marginTop: 10, fontSize: 15, lineHeight: 21 },
  point: { color: "#E3F1FF", marginTop: 4, fontSize: 13 },
  hint: { color: "#9FB7D6", marginTop: 10, fontSize: 12 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  primary: { backgroundColor: colors.cyan, borderRadius: radius.md, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
  primaryText: { color: "#fff", fontWeight: "800" },
  chip: { borderWidth: 1, borderColor: "#5D8AC2", borderRadius: radius.pill, paddingHorizontal: 14, minHeight: 40, justifyContent: "center" },
});
