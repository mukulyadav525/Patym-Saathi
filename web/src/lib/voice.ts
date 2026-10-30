// Browser voice for the dashboard: Chrome/Edge speech recognition (Hindi/Hinglish) and speech synthesis.

type Result = { isFinal: boolean; 0: { transcript: string } };
export type Recognizer = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<Result> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function createRecognizer(): Recognizer | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.lang = "hi-IN"; // the Hindi recognizer also handles Hinglish and English words
  rec.interimResults = true;
  rec.continuous = false;
  return rec;
}

export function speak(text: string) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const hindi = /[ऀ-ॿ]/.test(text);
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/₹\s?/g, hindi ? "रुपये " : "rupees "));
  u.lang = hindi ? "hi-IN" : "en-IN";
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}
