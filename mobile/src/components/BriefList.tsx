import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { Row, Txt, styles as ui, type IconName } from "@/components/ui";
import { api, ApiError, type Brief } from "@/lib/api";
import { colors } from "@/lib/theme";

const ICON: Record<string, { icon: IconName; color: string }> = {
  high: { icon: "alert-circle", color: colors.red },
  medium: { icon: "warning", color: colors.amber },
  info: { icon: "information-circle", color: colors.cyan },
};

export function BriefList({ brief, compact }: { brief: Brief; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);

  const act = async (p: Brief["priorities"][number]) => {
    if (!p.action) return;
    if (p.action.type === "RESTOCK") {
      router.navigate({ pathname: "/saathi/assistant", params: { prompt: "restock" } });
      return;
    }
    if (p.action.type === "COLLECT" && p.action.invoice_id) {
      setBusy(p.title);
      try {
        const task = await api.paymentLink(p.action.invoice_id);
        router.push({ pathname: "/task/[id]", params: { id: task.id } });
      } catch (e) {
        Alert.alert("Couldn't start", e instanceof ApiError ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    }
  };

  return (
    <View>
      {brief.priorities.map((p, i) => {
        const icon = ICON[p.severity] ?? ICON.info;
        return (
          <Pressable
            key={p.title}
            onPress={() => act(p)}
            disabled={!p.action || busy !== null}
            style={({ pressed }) => [{ paddingVertical: 10, opacity: pressed ? 0.7 : 1 }, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}
          >
            <Row style={{ alignItems: "flex-start" }}>
              <Ionicons name={icon.icon} size={20} color={icon.color} style={{ marginTop: 1 }} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Txt style={{ fontWeight: "700" }}>{p.title}</Txt>
                <Txt style={[ui.muted, { marginTop: 2 }]} numberOfLines={compact ? 2 : undefined}>{p.detail}</Txt>
                {!compact && (
                  <Txt style={[ui.muted, { marginTop: 4, fontSize: 11, color: colors.inkSoft }]}>
                    Source: {p.sources.join(" · ")}
                  </Txt>
                )}
              </View>
              {p.action && (
                <Txt style={[ui.link, { marginLeft: 8 }]}>{busy === p.title ? "…" : p.action.label}</Txt>
              )}
            </Row>
          </Pressable>
        );
      })}
    </View>
  );
}
