import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Loading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

function Gate() {
  const { ready, session } = useAuth();
  if (!ready) return <Loading label="Starting Saathi…" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="brief" />
        <Stack.Screen name="inventory" />
        <Stack.Screen name="dues" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="activity" />
        <Stack.Screen name="connections" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
