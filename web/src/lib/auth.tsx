"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

import { clearLoadCache } from "@/components/ui";
import { api, setToken, setUnauthorizedHandler, type LoginResponse } from "@/lib/api";

const KEY = "saathi.web.session";
type Auth = {
  ready: boolean;
  session: LoginResponse | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};
const Ctx = createContext<Auth | null>(null);

// sessionStorage: the session ends with the browser tab; no long-lived token on shared shop PCs.
// Read through useSyncExternalStore so the server render (no storage) and the client agree on hydration.
const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedSession: LoginResponse | null = null;

function readSession(): LoginResponse | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    raw = null; // storage unavailable: signed out
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedSession = raw ? (JSON.parse(raw) as LoginResponse) : null;
    } catch {
      cachedSession = null;
    }
    setToken(cachedSession?.token ?? null);
  }
  return cachedSession;
}

function writeSession(value: LoginResponse | null) {
  clearLoadCache(); // never show one account's cached screens to the next
  try {
    if (value) sessionStorage.setItem(KEY, JSON.stringify(value));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: session lives in memory for this page only */
    cachedRaw = value ? JSON.stringify(value) : null;
    cachedSession = value;
    setToken(value?.token ?? null);
  }
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const noop = () => () => {};

export function AuthProvider({ children }: { children: ReactNode }) {
  const session = useSyncExternalStore(subscribe, readSession, () => null);
  const ready = useSyncExternalStore(noop, () => true, () => false);

  const signOut = useCallback(() => writeSession(null), []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email.trim().toLowerCase(), password);
    writeSession(res);
  }, []);

  const value = useMemo(() => ({ ready, session, signIn, signOut }), [ready, session, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
};
