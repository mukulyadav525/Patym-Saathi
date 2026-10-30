import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { ApiError } from "@/lib/api";
import { useOnline } from "@/lib/hooks";
import { colors, radius, shadow, stateLabel, stateTone, toneColors, type Tone } from "@/lib/theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

export function Txt({ style, children, ...rest }: ComponentProps<typeof Text>) {
  return (
    <Text style={[styles.txt, style]} {...rest}>
      {children}
    </Text>
  );
}

export function Screen({
  children, refreshing, onRefresh, scroll = true, padded = true,
}: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; scroll?: boolean; padded?: boolean }) {
  const online = useOnline();
  return (
    <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
      {!online && (
        <View style={styles.offline}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Txt style={styles.offlineText}>You’re offline. Showing last loaded data.</Txt>
        </View>
      )}
      {scroll ? (
        <ScrollView
          contentContainerStyle={[padded && styles.pad, { paddingBottom: 120 }]}
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.cyan} /> : undefined}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, padded && styles.pad]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

export function Brand({ size = 20 }: { size?: number }) {
  return (
    <Text style={{ fontSize: size, fontWeight: "800", color: colors.navy, letterSpacing: -0.5 }}>
      pay<Text style={{ color: colors.cyan }}>tm</Text>
      <Text style={{ fontWeight: "600", color: colors.navy }}> Saathi</Text>
    </Text>
  );
}

export function TopBar({ title, back = true, right }: { title?: string; back?: boolean; right?: ReactNode }) {
  return (
    <View style={styles.topbar}>
      {back ? (
        <Pressable hitSlop={12} onPress={() => (router.canGoBack() ? router.back() : router.replace("/saathi"))} style={styles.iconBtn} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={22} color={colors.navy} />
        </Pressable>
      ) : (
        <View style={{ width: 8 }} />
      )}
      <View style={{ flex: 1, alignItems: back ? "center" : "flex-start" }}>{title ? <Txt style={styles.topTitle}>{title}</Txt> : <Brand />}</View>
      <View style={{ minWidth: 40, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void }) {
  if (onPress)
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }, style]}>
        {children}
      </Pressable>
    );
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Badge({ label, tone = "cyan", icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const c = toneColors[tone];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {icon && <Ionicons name={icon} size={11} color={c.fg} style={{ marginRight: 3 }} />}
      <Txt style={[styles.badgeText, { color: c.fg }]}>{label}</Txt>
    </View>
  );
}

export const StateBadge = ({ state }: { state: string }) => <Badge label={stateLabel(state)} tone={stateTone(state)} />;

export const SimBadge = ({ label = "SIMULATED" }: { label?: string }) => <Badge label={label} tone="violet" icon="flask-outline" />;

export function Button({
  label, onPress, kind = "primary", icon, loading, disabled, style, small,
}: {
  label: string; onPress: () => void; kind?: "primary" | "secondary" | "ghost" | "danger"; icon?: IconName;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; small?: boolean;
}) {
  const palette = {
    primary: { bg: colors.cyan, fg: "#fff", border: colors.cyan },
    secondary: { bg: "#fff", fg: colors.navy, border: colors.line },
    ghost: { bg: "transparent", fg: colors.navy, border: "transparent" },
    danger: { bg: "#fff", fg: colors.red, border: "#F3C5C5" },
  }[kind];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off }}
      style={({ pressed }) => [
        styles.btn, small && styles.btnSmall,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : (
        <>
          {icon && <Ionicons name={icon} size={small ? 16 : 18} color={palette.fg} style={{ marginRight: 6 }} />}
          <Txt style={[styles.btnText, small && { fontSize: 14 }, { color: palette.fg }]}>{label}</Txt>
        </>
      )}
    </Pressable>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionRow}>
      <Txt style={styles.sectionTitle}>{title}</Txt>
      {action && (
        <Pressable onPress={onAction} hitSlop={10}>
          <Txt style={styles.link}>{action}</Txt>
        </Pressable>
      )}
    </View>
  );
}

export function IconTile({ icon, tone = "cyan", size = 40 }: { icon: IconName; tone?: Tone; size?: number }) {
  const c = toneColors[tone];
  return (
    <View style={{ width: size, height: size, borderRadius: size / 3, backgroundColor: c.bg, alignItems: "center", justifyContent: "center" }}>
      <Ionicons name={icon} size={size * 0.5} color={c.fg} />
    </View>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.cyan} size="large" />
      <Txt style={styles.muted}>{label}</Txt>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <Card style={{ alignItems: "center", paddingVertical: 28 }}>
      <IconTile icon={error.code === "NETWORK" ? "cloud-offline-outline" : "alert-circle-outline"} tone="red" size={48} />
      <Txt style={[styles.h3, { marginTop: 12 }]}>{error.code === "NETWORK" ? "Can't reach Saathi" : "Something went wrong"}</Txt>
      <Txt style={[styles.muted, { textAlign: "center", marginTop: 4 }]}>{error.message}</Txt>
      {onRetry && <Button label="Retry" icon="refresh" kind="secondary" onPress={onRetry} style={{ marginTop: 14 }} small />}
    </Card>
  );
}

export function Empty({ icon, title, body }: { icon: IconName; title: string; body?: string }) {
  return (
    <View style={[styles.center, { paddingVertical: 36 }]}>
      <IconTile icon={icon} tone="muted" size={52} />
      <Txt style={[styles.h3, { marginTop: 12 }]}>{title}</Txt>
      {body && <Txt style={[styles.muted, { textAlign: "center", marginTop: 4, maxWidth: 260 }]}>{body}</Txt>}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: "row", alignItems: "center" }, style]}>{children}</View>;
}

export const Divider = () => <View style={{ height: 1, backgroundColor: colors.line, marginVertical: 10 }} />;

export const styles = StyleSheet.create({
  txt: { color: colors.ink, fontSize: 15 },
  screen: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 16, paddingTop: 4 },
  offline: { backgroundColor: colors.ink, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 6, gap: 6 },
  offlineText: { color: "#fff", fontSize: 12 },
  topbar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, backgroundColor: colors.bg },
  topTitle: { fontSize: 17, fontWeight: "700", color: colors.navy },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, marginBottom: 12, ...shadow },
  badge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.2 },
  btn: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
  btnSmall: { minHeight: 40, paddingHorizontal: 12 },
  btnText: { fontSize: 16, fontWeight: "700" },
  sectionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 12, marginBottom: 10 },
  sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.ink },
  link: { color: "#0083AD", fontWeight: "700", fontSize: 14 },
  center: { alignItems: "center", justifyContent: "center", padding: 24 },
  muted: { color: colors.muted, fontSize: 13 },
  h1: { fontSize: 26, fontWeight: "800", color: colors.ink, letterSpacing: -0.5 },
  h2: { fontSize: 20, fontWeight: "800", color: colors.ink },
  h3: { fontSize: 16, fontWeight: "700", color: colors.ink },
  money: { fontSize: 28, fontWeight: "800", color: colors.ink, letterSpacing: -0.5 },
});
