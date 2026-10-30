import NetInfo from "@react-native-community/netinfo";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ApiError } from "./api";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => NetInfo.addEventListener((s) => setOnline(s.isConnected !== false && s.isInternetReachable !== false)), []);
  return online;
}

/** Loads data on focus; keeps the last good data visible when a refresh fails (weak connectivity).
 * A response that arrives after a newer load started (or after the caller set data itself, e.g. the
 * result of an approval) is dropped, so stale data never overwrites fresh. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setDataState] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const loaderRef = useRef(loader);
  useLayoutEffect(() => {
    loaderRef.current = loader;
  });
  const seq = useRef(0);
  const depKey = JSON.stringify(deps);

  const run = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    const mine = ++seq.current;
    if (mode === "refresh") setRefreshing(true);
    try {
      const value = await loaderRef.current();
      if (mine === seq.current) {
        setDataState(value);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError(e instanceof ApiError ? e : new ApiError(0, "ERROR", String(e)));
    } finally {
      if (mine === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const setData = useCallback((value: T | null) => {
    seq.current += 1; // anything still in flight is now older than this
    setDataState(value);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void run();
      // Re-run on focus and whenever the caller's deps change (compared by value).
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [run, depKey]),
  );

  return { data, setData, error, loading, refreshing, reload: () => run("refresh") };
}

export const rupees = (value: string | number | null | undefined, decimals = 0) => {
  if (value === null || value === undefined) return "—";
  const n = typeof value === "string" ? Number(value) : value;
  const text = Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${n < 0 ? "−" : ""}₹${text}`;
};

export const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
