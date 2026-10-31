import { Ionicons } from "@expo/vector-icons";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, AppState, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Txt } from "@/components/ui";
import { api, ApiError, type S } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { emitLive, type LiveEvent } from "@/lib/liveBus";
import { colors, radius } from "@/lib/theme";


const LiveContext = createContext<{ connected: boolean }>({ connected: false });
export const useLive = () => useContext(LiveContext);

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const SHOW_MS = 5000;

/** Follows the merchant's live feed while signed in and the app is on screen, and shows a banner for each event. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [active, setActive] = useState(AppState.currentState === "active");
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<LiveEvent | null>(null);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!session || !active) return;
    let alive = true;
    void (async () => {
      let cursor: number | null = null;
      let backoff = 1000;
      while (alive) {
        try {
          const res: S["LiveOut"] = await api.live(cursor, cursor == null ? 0 : 25);
          if (!alive) return;
          setConnected(true);
          if (cursor != null && res.events.length) {
            emitLive(res.events);
            setToast(res.events[res.events.length - 1]);
          }
          cursor = res.cursor;
          backoff = 1000;
        } catch (e) {
          if (!alive || (e instanceof ApiError && e.status === 401)) return;
          setConnected(false);
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 15000);
        }
      }
    })();
    return () => {
      alive = false;
      setConnected(false);
    };
  }, [session, active]);

  return (
    <LiveContext.Provider value={{ connected }}>
      {children}
      {toast && <Banner key={toast.id} event={toast} onDone={() => setToast(null)} />}
    </LiveContext.Provider>
  );
}

function Banner({ event, onDone }: { event: LiveEvent; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [y] = useState(() => new Animated.Value(-120));
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    Animated.spring(y, { toValue: 0, useNativeDriver: true, speed: 16, bounciness: 6 }).start();
    const t = setTimeout(() => Animated.timing(y, { toValue: -120, duration: 220, useNativeDriver: true }).start(() => done.current()), SHOW_MS);
    return () => clearTimeout(t);
  }, [y]);
  const money = event.kind === "QR_PAYMENT";
  const icon = money ? "cash-outline" : event.kind === "COUNTER_UNDO" ? "arrow-undo-outline" : "receipt-outline";
  return (
    <Animated.View pointerEvents="box-none" style={[s.wrap, { top: insets.top + 8, transform: [{ translateY: y }] }]}>
      <Pressable onPress={() => done.current()} style={s.card} accessibilityRole="alert" accessibilityLabel={`${event.title}. ${event.body}`}>
        <View style={[s.icon, { backgroundColor: money ? colors.green : colors.cyan }]}>
          <Ionicons name={icon} size={18} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Txt style={s.title} numberOfLines={2}>{event.title}</Txt>
          <Txt style={s.body} numberOfLines={1}>{event.body}</Txt>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 12, right: 12, zIndex: 100, elevation: 12 },
  card: {
    flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.navy, borderRadius: radius.lg, padding: 12,
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontWeight: "800", fontSize: 14 },
  body: { color: "#C9DDF5", fontSize: 12, marginTop: 1 },
});
