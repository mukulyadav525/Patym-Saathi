import * as SecureStore from "expo-secure-store";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform } from "react-native";

import { api, setToken, setUnauthorizedHandler, type LoginResponse } from "./api";

const KEY = "saathi.session";

// Native: encrypted SecureStore. Web preview only: sessionStorage (the real web client is the Next.js dashboard).
const store = {
  get: async () => (Platform.OS === "web" ? globalThis.sessionStorage?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY)),
  set: async (v: string) => (Platform.OS === "web" ? globalThis.sessionStorage?.setItem(KEY, v) : SecureStore.setItemAsync(KEY, v)),
  clear: async () => (Platform.OS === "web" ? globalThis.sessionStorage?.removeItem(KEY) : SecureStore.deleteItemAsync(KEY)),
};

type AuthState = {
  ready: boolean;
  session: LoginResponse | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<LoginResponse | null>(null);

  const signOut = useCallback(async () => {
    setToken(null);
    setSession(null);
    await store.clear();
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut());
    (async () => {
      try {
        const saved = await store.get();
        if (saved) {
          const parsed = JSON.parse(saved) as LoginResponse;
          setToken(parsed.token);
          setSession(parsed);
        }
      } finally {
        setReady(true);
      }
    })();
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email.trim().toLowerCase(), password);
    setToken(res.token);
    await store.set(JSON.stringify(res));
    setSession(res);
  }, []);

  // Re-read the user (e.g. after setting an approval PIN) and keep the stored session in step.
  const refresh = useCallback(async () => {
    const res = await api.me();
    await store.set(JSON.stringify(res));
    setSession(res);
  }, []);

  const value = useMemo(() => ({ ready, session, signIn, signOut, refresh }), [ready, session, signIn, signOut, refresh]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}
