"use client";

import {
  Bell, Boxes, ClipboardList, History, Inbox, IndianRupee, LayoutDashboard, LogOut, Menu, Network, Receipt, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui";
import { API_BASE, ApiError } from "@/lib/api";
import { AuthProvider, useAuth } from "@/lib/auth";

// Grouped like the Paytm for Business dashboard sidebar.
const NAV = [
  { group: "Dashboard", items: [{ href: "/", label: "Home", icon: LayoutDashboard }] },
  {
    group: "Paytm Saathi",
    items: [
      { href: "/inbox", label: "Task inbox", icon: Inbox },
      { href: "/audit", label: "Activity history", icon: History },
    ],
  },
  {
    group: "Payments",
    items: [
      { href: "/payments", label: "Payments & settlements", icon: IndianRupee },
      { href: "/invoices", label: "Invoices & payment links", icon: Receipt },
    ],
  },
  {
    group: "Business",
    items: [
      { href: "/inventory", label: "Inventory", icon: Boxes },
      { href: "/orders", label: "Supplier orders", icon: ClipboardList },
      { href: "/connections", label: "Connections & consent", icon: Network },
    ],
  },
];

export function Brand() {
  return (
    <span className="text-xl font-extrabold tracking-tight text-navy">
      pay<span className="text-cyan">tm</span> <span className="font-semibold">Saathi</span>
    </span>
  );
}

// Text wordmark only (hackathon concept; no Paytm logo artwork bundled).
export function BizLogo() {
  return (
    <span className="flex flex-col items-center leading-none text-navy">
      <span className="text-[22px] font-black tracking-tight">Pay<span className="text-cyan">tm</span></span>
      <span className="flex items-center gap-1 text-[7px] font-bold"><i className="h-px w-3 bg-cyan" />for<i className="h-px w-3 bg-cyan" /></span>
      <span className="text-[12px] font-extrabold">Business</span>
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
        <div className="mb-5 flex items-center gap-3">
          <BizLogo />
          <span className="h-8 w-px bg-line" />
          <Brand />
        </div>
        <h1 className="text-lg font-extrabold">Sign in to your dashboard</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Same data and approvals as the Android app</p>
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
    <nav className="space-y-5">
      {NAV.map(({ group, items }) => (
        <div key={group}>
          <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-muted">{group}</p>
          <div className="space-y-0.5">
            {items.map(({ href, label, icon: Icon }) => {
              const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/inbox" && path.startsWith("/tasks"));
              return (
                <Link key={href} href={href} onClick={() => setOpen(false)}
                  className={`relative flex items-center gap-3 rounded-r-xl py-2.5 pr-3 pl-4 text-sm font-semibold transition ${active ? "bg-cyan-soft text-navy" : "text-ink-soft hover:bg-bg"}`}>
                  {active && <span className="absolute inset-y-1 left-0 w-1 rounded-full bg-cyan" />}
                  <Icon className={`size-4 ${active ? "text-cyan" : ""}`} /> {label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const initials = session.user.display_name.split(" ").map((p) => p[0]).join("").slice(0, 2);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
        <button onClick={() => setOpen(!open)} aria-label="Menu" className="rounded-lg p-2 hover:bg-bg lg:hidden">{open ? <X /> : <Menu />}</button>
        <Link href="/" aria-label="Home"><BizLogo /></Link>
        <span className="mx-1 hidden h-8 w-px bg-line sm:block" />
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-bold">{session.merchant.display_name}</p>
          <p className="truncate text-[11px] text-muted">{session.merchant.locality}</p>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {session.demo_mode && <span className="hidden rounded-full bg-violet-soft px-2.5 py-1 text-[11px] font-bold text-violet md:inline">DEMO MODE</span>}
          <Link href="/inbox" aria-label="Task inbox" className="rounded-full p-2 text-navy hover:bg-bg"><Bell className="size-5" /></Link>
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-full bg-cyan-soft text-sm font-extrabold text-navy">{initials}</span>
            <div className="hidden leading-tight md:block">
              <p className="text-sm font-semibold">Hello, {session.user.display_name.split(" ")[0]}</p>
              <p className="text-[11px] text-muted">{session.user.role === "DEMO_ADMIN" ? "Owner · demo admin" : "Owner"}</p>
            </div>
          </div>
          <button onClick={signOut} aria-label="Sign out" title="Sign out" className="rounded-full p-2 text-red hover:bg-red-soft"><LogOut className="size-5" /></button>
        </div>
      </header>
      <aside className="fixed top-16 bottom-0 left-0 hidden w-64 flex-col overflow-y-auto border-r border-line bg-white py-5 pr-3 lg:flex">
        {nav}
        {session.demo_mode && (
          <p className="mx-3 mt-auto rounded-lg bg-violet-soft px-3 py-2 text-[11px] font-bold text-violet">Suppliers SIMULATED · payments DEMO · sample POS data</p>
        )}
      </aside>
      {open && <div className="border-b border-line bg-white py-3 pr-3 lg:hidden">{nav}</div>}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8 lg:ml-64 lg:max-w-none xl:pr-12">{children}</main>
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
