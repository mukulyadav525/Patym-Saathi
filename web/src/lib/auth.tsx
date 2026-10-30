"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { api, setToken, setUnauthorizedHandler, type LoginResponse } from "./api";

const KEY = "saathi.web.session";
type Auth = {
  ready: boolean;
  session: LoginResponse | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
};
const Ctx = createContext<Auth | null>(null);

// sessionStorage: the session ends with the browser tab; no long-lived token on shared shop PCs.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<LoginResponse | null>(null);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(KEY);
    setToken(null);
    setSession(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as LoginResponse;
        setToken(parsed.token);
        setSession(parsed);
      }
    } catch {
      /* storage unavailable: stay signed out */
    }
    setReady(true);
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.login(email.trim().toLowerCase(), password);
    setToken(res.token);
    try {
      sessionStorage.setItem(KEY, JSON.stringify(res));
    } catch {
      /* ignore */
    }
    setSession(res);
  }, []);

  const value = useMemo(() => ({ ready, session, signIn, signOut }), [ready, session, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
};
