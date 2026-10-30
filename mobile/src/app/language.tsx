import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BizHeader } from "@/components/biz";
import { Txt } from "@/components/ui";
import { usePrefs, type Lang } from "@/lib/prefs";
import { colors, radius } from "@/lib/theme";

const LANGS: { id: Lang; name: string; native: string; glyph: string }[] = [
  { id: "en", name: "English", native: "English", glyph: "A" },
  { id: "hi", name: "Hindi", native: "हिन्दी", glyph: "अ" },
];

export default function Language() {
  const { t, lang, setLang } = usePrefs();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }} edges={["top", "left", "right"]}>
      <BizHeader title={t("language")} />
      <View style={{ padding: 16, gap: 12 }}>
        {LANGS.map((l) => {
          const on = l.id === lang;
          return (
            <Pressable
              key={l.id}
              onPress={() => setLang(l.id)}
              style={[s.option, on && s.optionOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <View style={[s.glyph, on && { backgroundColor: colors.cyan }]}>
                <Txt style={{ fontSize: 22, fontWeight: "800", color: on ? "#fff" : colors.navy }}>{l.glyph}</Txt>
              </View>
              <View style={{ flex: 1, marginLeft: 14 }}>
                <Txt style={{ fontSize: 18, fontWeight: "700" }}>{l.native}</Txt>
                <Txt style={{ color: colors.muted }}>{l.name}</Txt>
              </View>
              <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={24} color={on ? colors.cyan : colors.muted} />
            </Pressable>
          );
        })}
        <Txt style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
          {lang === "hi"
            ? "बिज़नेस होम, प्रोफ़ाइल और प्रोडक्ट स्क्रीन पर लागू। साथी से आप हिंदी या अंग्रेज़ी में बात कर सकते हैं।"
            : "Applies to the Business home, profile and product screens. You can talk to Saathi in Hindi or English either way."}
        </Txt>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  option: { flexDirection: "row", alignItems: "center", padding: 16, borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.line },
  optionOn: { borderColor: colors.cyan, backgroundColor: "#F2FBFF" },
  glyph: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.cyanSoft, alignItems: "center", justifyContent: "center" },
});
