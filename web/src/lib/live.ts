"use client";

import { api, ApiError, type S } from "@/lib/api";

export type LiveEvent = S["LiveEventOut"];
type Listener = (events: LiveEvent[]) => void;

// One long-poll loop per tab, shared by everything that wants live updates (pages reload their data, the shell
// shows a toast, the Soundbox announces payments). Starts at "now": only events after it are delivered.
const listeners = new Set<Listener>();
let users = 0;
let generation = 0;

export function onLive(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function loop(mine: number) {
  let cursor: number | null = null;
  let backoff = 1000;
  while (mine === generation) {
    try {
      const res: S["LiveOut"] = await api.live(cursor, cursor == null ? 0 : 20); // under hosting proxy timeouts (Vercel)
      if (mine !== generation) return;
      if (cursor != null && res.events.length) listeners.forEach((fn) => fn(res.events));
      cursor = res.cursor;
      backoff = 1000;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // signed out: the auth layer takes over
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 15000);
    }
  }
}

/** Start following the live feed; returns a stop function. Safe to call from several components. */
export function startLive(): () => void {
  users += 1;
  if (users === 1) {
    generation += 1;
    void loop(generation);
  }
  return () => {
    users -= 1;
    if (users === 0) generation += 1;
  };
}
