import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

// One shared player: a new clip stops the previous one, and a finished clip frees its native resources.
let current: AudioPlayer | null = null;

function release(player: AudioPlayer) {
  try {
    player.remove();
  } catch {
    /* already released */
  }
  if (current === player) current = null;
}

/** Plays base64 audio returned by the API (Sarvam Bulbul). The same text is always shown on screen too. */
export async function playBase64(b64: string, mime = "audio/wav") {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
  if (current) release(current);
  const player = createAudioPlayer({ uri: `data:${mime};base64,${b64}` });
  current = player;
  player.addListener("playbackStatusUpdate", (status) => {
    if (status.didJustFinish) release(player);
  });
  player.play();
}

/** Stop and free whatever is playing (e.g. when a screen closes). */
export function stopPlayback() {
  if (current) release(current);
}
