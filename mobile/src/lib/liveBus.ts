import type { S } from "./api";

export type LiveEvent = S["LiveEventOut"];
type Listener = (events: LiveEvent[]) => void;

// Shared by every screen: useLoad reloads when something happens at the counter (Soundbox entry, QR payment).
// Kept free of UI imports so hooks.ts can use it without an import cycle.
const listeners = new Set<Listener>();

export function onLive(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitLive(events: LiveEvent[]) {
  listeners.forEach((fn) => fn(events));
}
