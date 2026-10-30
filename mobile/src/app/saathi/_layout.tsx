import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Txt, type IconName } from "@/components/ui";
import { colors, shadow } from "@/lib/theme";
import { useVoiceAgent } from "@/lib/voiceAgent";

const TABS: { name: string; label: string; icon: IconName; active: IconName }[] = [
  { name: "index", label: "Home", icon: "home-outline", active: "home" },
  { name: "assistant", label: "Saathi", icon: "sparkles-outline", active: "sparkles" },
  { name: "tasks", label: "Tasks", icon: "list-outline", active: "list" },
  { name: "business", label: "Business", icon: "storefront-outline", active: "storefront" },
];

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const agent = useVoiceAgent();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={({ state, navigateToTab }) => {
        const current = state.routes[state.index]?.name;
        const item = (t: (typeof TABS)[number]) => {
          const focused = current === t.name;
          return (
            <Pressable
              key={t.name}
              style={s.item}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              onPress={() => {
                const route = state.routes.find((r) => r.name === t.name);
                if (route) navigateToTab(route.key);
              }}
            >
              <Ionicons name={focused ? t.active : t.icon} size={22} color={focused ? colors.cyan : colors.muted} />
              <Txt style={[s.label, focused && { color: colors.cyan }]}>{t.label}</Txt>
            </Pressable>
          );
        };
        return (
          <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
            {item(TABS[0])}
            {item(TABS[1])}
            <View style={s.item}>
              <Pressable
                style={s.mic}
                accessibilityLabel="Speak to Saathi"
                accessibilityHint="Ask a question by voice, or say Hey Saathi any time"
                onPress={agent.activate}
              >
                <Ionicons name="mic" size={26} color="#fff" />
              </Pressable>
            </View>
            {item(TABS[2])}
            {item(TABS[3])}
          </View>
        );
      }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} />
      ))}
    </Tabs>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: "row", backgroundColor: "#fff", paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line },
  item: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48 },
  label: { fontSize: 11, color: colors.muted, marginTop: 2, fontWeight: "600" },
  mic: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: colors.cyan, alignItems: "center", justifyContent: "center",
    marginTop: -26, borderWidth: 4, borderColor: "#fff", ...shadow, shadowOpacity: 0.2,
  },
});
