"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Thin cyan bar under the header while the next page loads: starts on an internal link click,
 * completes when the route changes. Covers the gap before the new page's data arrives. */
export function RouteBar() {
  const path = usePathname();
  const [state, setState] = useState<{ phase: "idle" | "loading" | "done"; from: string }>({ phase: "idle", from: path });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest("a");
      if (!a || a.target === "_blank" || a.origin !== location.origin) return;
      if (a.pathname === location.pathname) return;
      setState({ phase: "loading", from: location.pathname });
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Route changed: finish the bar (derived during render, no effect needed), then hide it.
  if (state.phase === "loading" && path !== state.from) setState({ phase: "done", from: path });
  useEffect(() => {
    if (state.phase !== "done") return;
    const t = setTimeout(() => setState((s) => ({ ...s, phase: "idle" })), 350);
    return () => clearTimeout(t);
  }, [state.phase]);

  if (state.phase === "idle") return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-16 z-40 h-0.5" aria-hidden>
      <div className={`h-full bg-cyan ${state.phase === "loading" ? "route-bar" : "w-full opacity-0 transition-opacity duration-300"}`} />
    </div>
  );
}
