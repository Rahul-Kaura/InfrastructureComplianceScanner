"use client";

import { useState, type FormEvent } from "react";

const SESSION_KEY = "ics_uniphore_demo_sso";

export function readUniphoreDemoSession(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(SESSION_KEY) === "1";
}

export function writeUniphoreDemoSession(): void {
  sessionStorage.setItem(SESSION_KEY, "1");
}

export function clearUniphoreDemoSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function isUniphoreEmail(email: string): boolean {
  return /^[^\s@]+@uniphore\.com$/i.test(email.trim());
}

function MoonOrb() {
  return (
    <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-gradient-to-br from-slate-200/90 via-indigo-200/40 to-transparent opacity-90 shadow-[0_0_80px_rgba(180,200,255,0.35)] ring-1 ring-white/20" />
  );
}

interface UniphoreSsoLoginProps {
  onAuthenticated: () => void;
}

export function UniphoreSsoLogin({ onAuthenticated }: UniphoreSsoLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const pw = password.trim();
    const em = email.trim();
    if (!pw) {
      setError("Please enter your password.");
      return;
    }
    if (!isUniphoreEmail(em)) {
      setError("Access requires Uniphore SSO. Sign in with an @uniphore.com email address.");
      return;
    }
    writeUniphoreDemoSession();
    onAuthenticated();
  }

  return (
    <main className="relative mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-16 pt-10 md:px-8">
      <MoonOrb />
      <header className="relative z-10 mb-8 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-indigo-300/80">Uniphore</p>
        <h1 className="mt-2 bg-gradient-to-r from-slate-100 via-indigo-100 to-slate-300 bg-clip-text text-3xl font-semibold text-transparent md:text-4xl">
          SSO sign-in
        </h1>
      </header>

      <div className="relative z-10 rounded-2xl border border-white/10 bg-slate-950/50 p-6 shadow-xl backdrop-blur-md">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="sso-email" className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-300">
              Email
            </label>
            <input
              id="sso-email"
              name="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@uniphore.com"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-200 outline-none ring-indigo-500/30 placeholder:text-slate-600 focus:border-indigo-400/50 focus:ring-2"
            />
          </div>
          <div>
            <label htmlFor="sso-password" className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-300">
              Password
            </label>
            <input
              id="sso-password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter any value"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-200 outline-none ring-indigo-500/30 placeholder:text-slate-600 focus:border-indigo-400/50 focus:ring-2"
            />
          </div>
          {error ? (
            <p
              className="rounded-xl border border-rose-500/35 bg-rose-950/30 px-3 py-2 text-xs leading-relaxed text-rose-100/95"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="w-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110"
          >
            Sign in
          </button>
        </form>
      </div>
    </main>
  );
}
