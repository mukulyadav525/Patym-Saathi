"use client";

import { Boxes, ClipboardList, History, Inbox, LayoutDashboard, LogOut, Menu, Network, Receipt, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { API_BASE, ApiError } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/inbox", label: "Task inbox", icon: Inbox },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/invoices", label: "Invoices", icon: Receipt },
  { href: "/audit", label: "Audit history", icon: History },
  { href: "/connections", label: "Connections", icon: Network },
];

export function Brand() {
  return (
    <span className="text-xl font-extrabold tracking-tight text-navy">
      pay<span className="text-cyan">tm</span> <span className="font-semibold">Saathi</span>
    </span>
  );
}

function SignIn() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("owner@sharma.demo");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-7">
        <Brand />
        <p className="mt-1 mb-6 text-sm text-muted">Merchant dashboard · same data as the Android app</p>
        <label className="text-xs font-bold text-ink-soft" htmlFor="email">Email</label>
        <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username"
          className="mt-1 mb-4 h-11 w-full rounded-xl border border-line bg-[#FAFCFE] px-3 outline-cyan" />
        <label className="text-xs font-bold text-ink-soft" htmlFor="password">Password</label>
        <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
          className="mt-1 h-11 w-full rounded-xl border border-line bg-[#FAFCFE] px-3 outline-cyan" placeholder="Demo password" />
        {error && <p className="mt-3 rounded-lg bg-red-soft p-2 text-sm text-red">{error}</p>}
        <Button type="submit" loading={busy} disabled={!password} className="mt-5 w-full">Sign in</Button>
        <p className="mt-4 text-center text-[11px] text-muted">Hackathon prototype · sample data · API {API_BASE.replace(/^https?:\/\//, "")}</p>
      </form>
    </main>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const { ready, session, signOut } = useAuth();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  if (!ready) return null;
  if (!session) return <SignIn />;

  const nav = (
    <nav className="space-y-1">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/inbox" && path.startsWith("/tasks"));
        return (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${active ? "bg-cyan-soft text-navy" : "text-ink-soft hover:bg-bg"}`}>
            <Icon className={`size-4 ${active ? "text-cyan" : ""}`} /> {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-line bg-white p-5 lg:flex">
        <Brand />
        <p className="mb-6 text-xs text-muted">{session.merchant.display_name}</p>
        {nav}
        <div className="mt-auto">
          {session.demo_mode && <p className="mb-3 rounded-lg bg-violet-soft px-3 py-2 text-[11px] font-bold text-violet">DEMO MODE · suppliers simulated, payments DEMO</p>}
          <p className="text-sm font-semibold">{session.user.display_name}</p>
          <p className="text-xs text-muted">{session.user.email}</p>
          <button onClick={signOut} className="mt-3 flex items-center gap-2 text-sm font-semibold text-red"><LogOut className="size-4" /> Sign out</button>
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button onClick={() => setOpen(!open)} aria-label="Menu" className="rounded-lg p-2 hover:bg-bg">{open ? <X /> : <Menu />}</button>
      </header>
      {open && <div className="border-b border-line bg-white p-3 lg:hidden">{nav}</div>}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Frame>{children}</Frame>
    </AuthProvider>
  );
}
