import type { ExpoConfig } from "expo/config";

// APP_VARIANT=demo-local builds an APK that may call a laptop API over plain HTTP on the
// venue hotspot. Never use that variant for a real release.
const demoLocal = process.env.APP_VARIANT === "demo-local";

const config: ExpoConfig = {
  name: demoLocal ? "Saathi (local demo)" : "Paytm Saathi",
  slug: "paytm-saathi",
  version: "0.1.0",
  scheme: "paytmsaathi",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  android: {
    package: demoLocal ? "in.teamair01.saathi.demolocal" : "in.teamair01.saathi",
    adaptiveIcon: {
      backgroundColor: "#00B9F1",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    permissions: ["android.permission.RECORD_AUDIO"],
    blockedPermissions: ["android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"],
    predictiveBackGestureEnabled: false,
  },
  web: { favicon: "./assets/favicon.png", output: "single" },
  plugins: [
    "expo-router",
    "expo-status-bar",
    "expo-secure-store",
    ["expo-audio", { microphonePermission: "Saathi uses the microphone only when you tap the mic to speak a request." }],
    ["expo-build-properties", { android: { usesCleartextTraffic: demoLocal } }],
  ],
  experiments: { typedRoutes: true },
};

export default config;
