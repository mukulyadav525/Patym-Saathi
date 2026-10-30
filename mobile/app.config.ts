import type { ExpoConfig } from "expo/config";

// APP_VARIANT=demo-local builds an APK that may call a laptop API over plain HTTP on the
// venue hotspot. Never use that variant for a real release.
const demoLocal = process.env.APP_VARIANT === "demo-local";

const config: ExpoConfig = {
  name: "Paytm Business",
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
    ["expo-speech-recognition", {
      microphonePermission: "Saathi listens for “Hey Saathi” only while the app is open on screen.",
      speechRecognitionPermission: "Saathi turns your spoken request into text to answer it.",
      androidSpeechServicePackages: ["com.google.android.googlequicksearchbox", "com.google.android.tts"],
    }],
    ["expo-image-picker", {
      cameraPermission: "Saathi uses the camera only when you take a photo of a supplier bill.",
      photosPermission: "Saathi opens your photos only when you pick a supplier bill.",
    }],
    ["expo-build-properties", { android: { usesCleartextTraffic: demoLocal } }],
  ],
  experiments: { typedRoutes: true },
  owner: "mukulydvl23",
  extra: { eas: { projectId: "18ec48a4-508c-4958-ac32-ef25af67d806" } },
};

export default config;
