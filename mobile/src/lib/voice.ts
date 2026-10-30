import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Speech from "expo-speech";

// One shared player: a new clip stops the previous one, and a finished clip frees its native resources.
let current: AudioPlayer | null = null;
const endHandlers = new WeakMap<AudioPlayer, () => void>();

function release(player: AudioPlayer) {
  const onEnd = endHandlers.get(player);
  endHandlers.delete(player);
  try {
    player.remove();
  } catch {
    /* already released */
  }
  if (current === player) current = null;
  onEnd?.();
}

/** Plays base64 audio returned by the API (Sarvam Bulbul). The same text is always shown on screen too. */
export async function playBase64(b64: string, mime = "audio/mpeg", onEnd?: () => void) {
  await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false }).catch(() => undefined);
  if (current) release(current);
  const player = createAudioPlayer({ uri: `data:${mime};base64,${b64}` });
  current = player;
  if (onEnd) endHandlers.set(player, onEnd);
  player.addListener("playbackStatusUpdate", (status) => {
    if (status.didJustFinish) release(player);
  });
  player.play();
}

/** Stop and free whatever is playing (e.g. when a screen closes). */
export function stopPlayback() {
  if (current) release(current);
}

/** Speak a reply with the phone's own voice (instant, works offline). Devanagari text uses the Hindi voice. */
export function speakText(text: string, onDone?: () => void) {
  const hindi = /[\u0900-\u097F]/.test(text);
  const done = () => onDone?.();
  Speech.stop();
  Speech.speak(text.replace(/₹\s?/g, hindi ? "रुपये " : "rupees "), {
    language: hindi ? "hi-IN" : "en-IN", rate: 1.0, pitch: 1.0, onDone: done, onStopped: done, onError: done,
  });
}

export function stopSpeaking() {
  Speech.stop();
}
