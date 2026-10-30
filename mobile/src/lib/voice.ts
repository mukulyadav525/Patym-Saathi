import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

// Plays base64 audio returned by the API (Sarvam Bulbul). The text is always shown on screen as well.
export async function playBase64(b64: string, mime = "audio/wav") {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
  const player = createAudioPlayer({ uri: `data:${mime};base64,${b64}` });
  player.play();
  return player;
}
