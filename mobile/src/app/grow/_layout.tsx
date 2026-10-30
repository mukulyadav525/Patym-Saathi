import { Stack } from "expo-router";

import { colors } from "@/lib/theme";

export default function GrowLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }} />;
}
