import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { Loading } from "@/components/ui";
import { AuthProvider, useAuth } from "@/lib/auth";
import { PrefsProvider } from "@/lib/prefs";
import { colors } from "@/lib/theme";

function Gate() {
  const { ready, session } = useAuth();
  if (!ready) return <Loading label="Starting Paytm for Business…" />;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      {/* Paytm for Business shell: open without login, like the real app's landing screen. */}
      <Stack.Screen name="index" />
      <Stack.Screen name="profile" options={{ animation: "slide_from_left" }} />
      <Stack.Screen name="product/[id]" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="language" />
      <Stack.Screen name="legal" />
      <Stack.Screen name="sign-in" />
      {/* Paytm Saathi and merchant data: login required. */}
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="saathi" />
        <Stack.Screen name="settlements" />
        <Stack.Screen name="approval-pin" />
        <Stack.Screen name="grow" />
        <Stack.Screen name="task/[id]" />
        <Stack.Screen name="brief" />
        <Stack.Screen name="inventory" />
        <Stack.Screen name="dues" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="activity" />
        <Stack.Screen name="connections" />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PrefsProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Gate />
        </AuthProvider>
      </PrefsProvider>
    </SafeAreaProvider>
  );
}
