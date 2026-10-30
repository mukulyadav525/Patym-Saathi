import { Ionicons } from "@expo/vector-icons";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { Button, Card, Divider, IconTile, Row, Screen, SectionTitle, SimBadge, Txt, styles as ui, type IconName } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { type Tone } from "@/lib/theme";

const LINKS: { label: string; sub: string; icon: IconName; tone: Tone; href: Href }[] = [
  { label: "Daily report", sub: "3 priorities from your records", icon: "bar-chart-outline", tone: "violet", href: "/brief" },
  { label: "Stock & alerts", sub: "Inventory, low-stock items", icon: "layers-outline", tone: "green", href: "/inventory" },
  { label: "Dues collection", sub: "Open invoices and payment links", icon: "wallet-outline", tone: "cyan", href: "/dues" },
  { label: "Payments and settlements", sub: "Money received via payment links", icon: "cash-outline", tone: "green", href: "/settlements" },
  { label: "Order history", sub: "Supplier orders and status", icon: "cart-outline", tone: "amber", href: "/orders" },
  { label: "Activity history", sub: "Every plan, approval and API call", icon: "time-outline", tone: "navy", href: "/activity" },
  { label: "Connections & consent", sub: "What's live, demo or simulated", icon: "git-network-outline", tone: "muted", href: "/connections" },
];

export default function Business() {
  const { session, signOut } = useAuth();
  const [resetting, setResetting] = useState(false);
  const demo = session?.demo_mode && session.user.role === "DEMO_ADMIN";

  const reset = () =>
    Alert.alert("Reset demo data?", "Restores the known starting state: stock, invoices, quotes. Clears tasks and orders.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Reset", style: "destructive", onPress: async () => {
          setResetting(true);
          try {
            const r = await api.demoReset();
            Alert.alert("Done", r.message);
          } catch (e) {
            Alert.alert("Reset failed", e instanceof ApiError ? e.message : String(e));
          } finally {
            setResetting(false);
          }
        },
      },
    ]);

  return (
    <Screen>
      <Txt style={[ui.h1, { marginTop: 12 }]}>Business</Txt>
      <Txt style={[ui.muted, { fontSize: 14, marginBottom: 14 }]}>{session?.merchant.display_name}</Txt>
      <Card>
        {LINKS.map((l, i) => (
          <View key={l.label}>
            {i > 0 && <Divider />}
            <Pressable onPress={() => router.push(l.href)} accessibilityRole="link" style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
              <Row>
                <IconTile icon={l.icon} tone={l.tone} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Txt style={ui.h3}>{l.label}</Txt>
                  <Txt style={ui.muted}>{l.sub}</Txt>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#8A98AC" />
              </Row>
            </Pressable>
          </View>
        ))}
      </Card>

      {demo && (
        <>
          <SectionTitle title="Demo controls" />
          <Card>
            <Row style={{ marginBottom: 8 }}><SimBadge label="DEMO ONLY" /></Row>
            <Txt style={ui.muted}>Reset restores the seeded scenario (₹4,650 plan, ₹4,850 after the oil shortage, INV-1042 ₹1,200).</Txt>
            <Button label="Reset demo data" icon="refresh" kind="secondary" style={{ marginTop: 10 }} loading={resetting} onPress={reset} />
          </Card>
        </>
      )}

      <SectionTitle title="Account" />
      <Card>
        <Txt style={ui.h3}>{session?.user.display_name}</Txt>
        <Txt style={ui.muted}>{session?.user.email} · {session?.user.role}</Txt>
        <Button label="Sign out" icon="log-out-outline" kind="danger" small style={{ marginTop: 12 }} onPress={() => void signOut()} />
      </Card>
      <Txt style={[ui.muted, { textAlign: "center", fontSize: 11 }]}>Independent hackathon concept · TeamAIR01 · sample data</Txt>
    </Screen>
  );
}
