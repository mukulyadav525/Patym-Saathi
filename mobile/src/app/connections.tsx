import { View } from "react-native";

import { Badge, Card, ErrorState, IconTile, Loading, Row, Screen, TopBar, Txt, styles as ui, type IconName } from "@/components/ui";
import { api } from "@/lib/api";
import { timeAgo, useLoad } from "@/lib/hooks";
import type { Tone } from "@/lib/theme";

const META: Record<string, { label: string; icon: IconName }> = {
  PAYTM: { label: "Paytm payments", icon: "card-outline" },
  POS: { label: "Billing / POS", icon: "receipt-outline" },
  INVENTORY: { label: "Inventory", icon: "layers-outline" },
  SUPPLIER: { label: "Suppliers", icon: "car-outline" },
  SARVAM: { label: "Sarvam AI voice", icon: "mic-outline" },
};
const MODE_TONE: Record<string, Tone> = { LIVE: "green", STAGING: "cyan", DEMO: "violet", SAMPLE: "violet", SIMULATED: "violet", OFF: "red" };

export default function Connections() {
  const { data, error, loading, refreshing, reload } = useLoad(api.connections);
  return (
    <Screen refreshing={refreshing} onRefresh={reload}>
      <TopBar title="Connections & consent" />
      <Txt style={[ui.muted, { marginBottom: 12 }]}>
        What Saathi can see, and whether it’s real, demo or simulated. Payment data alone never reveals item sales, stock or margins.
      </Txt>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data?.map((c) => {
        const meta = META[c.source] ?? { label: c.source, icon: "link-outline" as IconName };
        return (
          <Card key={c.source}>
            <Row>
              <IconTile icon={meta.icon} tone={MODE_TONE[c.mode] ?? "muted"} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Txt style={ui.h3}>{meta.label}</Txt>
                <Txt style={ui.muted}>{c.description}</Txt>
              </View>
              <Badge label={c.mode} tone={MODE_TONE[c.mode] ?? "muted"} />
            </Row>
            <Txt style={[ui.muted, { fontSize: 11, marginTop: 8 }]}>
              {c.consent_granted_at ? `Consent recorded ${timeAgo(c.consent_granted_at)}` : "Not connected — no consent recorded"}
              {c.last_sync_at ? ` · synced ${timeAgo(c.last_sync_at)}` : ""}
            </Txt>
          </Card>
        );
      })}
    </Screen>
  );
}
