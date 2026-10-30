import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";

import { Txt, styles as ui, type IconName } from "@/components/ui";
import type { AuditEvent } from "@/lib/api";
import { clock } from "@/lib/hooks";
import { colors } from "@/lib/theme";

const ICONS: Record<string, { icon: IconName; color: string }> = {
  TASK_CREATED: { icon: "chatbubble-ellipses", color: colors.navy },
  PLAN_DRAFTED: { icon: "document-text", color: colors.cyan },
  APPROVAL_REQUESTED: { icon: "hand-left", color: colors.amber },
  APPROVAL_CONFIRMED: { icon: "shield-checkmark", color: colors.green },
  APPROVAL_REJECTED: { icon: "close-circle", color: colors.red },
  APPROVAL_SUPERSEDED: { icon: "refresh-circle", color: colors.muted },
  ORDER_CREATED: { icon: "cart", color: colors.violet },
  ORDER_STATE: { icon: "cube", color: colors.violet },
  INVOICE_STATE: { icon: "receipt", color: colors.cyan },
  PAYMENT_LINK_CREATED: { icon: "link", color: colors.cyan },
  WEBHOOK_RECEIVED: { icon: "notifications", color: colors.navy },
  STATUS_CHECKED: { icon: "checkmark-done-circle", color: colors.green },
  TASK_STATE: { icon: "ellipse", color: colors.muted },
};

export function Timeline({ events, showTask }: { events: AuditEvent[]; showTask?: boolean }) {
  if (!events.length) return <Txt style={ui.muted}>No activity yet</Txt>;
  return (
    <View>
      {events.map((e, i) => {
        const meta = ICONS[e.event_type] ?? ICONS.TASK_STATE;
        const isState = e.event_type === "TASK_STATE";
        const exception = (e.details as { to?: string })?.to === "EXCEPTION";
        return (
          <View key={e.id} style={{ flexDirection: "row" }}>
            <View style={{ alignItems: "center", width: 26 }}>
              <Ionicons name={exception ? "warning" : meta.icon} size={isState ? 10 : 18} color={exception ? colors.red : meta.color} style={{ marginTop: isState ? 5 : 1 }} />
              {i < events.length - 1 && <View style={{ flex: 1, width: 2, backgroundColor: colors.line, marginVertical: 2 }} />}
            </View>
            <View style={{ flex: 1, paddingBottom: 12, marginLeft: 6 }}>
              <Txt style={[{ fontSize: isState ? 13 : 14, fontWeight: isState ? "400" : "600" }, isState && { color: colors.inkSoft }, exception && { color: colors.red, fontWeight: "700" }]}>
                {e.summary}
              </Txt>
              <Txt style={[ui.muted, { fontSize: 11 }]}>
                {clock(e.created_at)} · {e.actor.length > 20 ? "You" : e.actor}
                {showTask ? ` · ${e.entity_type}` : ""}
              </Txt>
            </View>
          </View>
        );
      })}
    </View>
  );
}
