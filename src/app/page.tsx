"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ScanResult, Violation } from "@/lib/engine";

type ChatRole = "system" | "user" | "result";

interface ChatLine {
  id: string;
  role: ChatRole;
  text: string;
  violations?: Violation[];
  passed?: boolean;
  meta?: string;
}

const DEFAULT_INFRA = `{
  "version": "1",
  "services": [
    {
      "id": "rds-prod-orders",
      "name": "orders-primary",
      "type": "database",
      "environment": "production",
      "automatedBackups": true,
      "encryptionAtRest": true,
      "publiclyAccessible": false,
      "replicaCount": 2,
      "instanceType": "db.r5.xlarge"
    },
    {
      "id": "rds-prod-audit",
      "type": "database",
      "environment": "production",
      "automatedBackups": false,
      "encryptionAtRest": true,
      "publiclyAccessible": true,
      "replicaCount": 0,
      "instanceType": "db.m5.2xlarge"
    },
    {
      "id": "rds-dev-sandbox",
      "type": "database",
      "environment": "development",
      "automatedBackups": true,
      "encryptionAtRest": true,
      "publiclyAccessible": false,
      "replicaCount": 0,
      "instanceType": "db.r5.large"
    }
  ]
}`;

const DEFAULT_POLICIES = `{
  "version": "1",
  "rules": [
    {
      "id": "prod-db-backups",
      "name": "Production DB backups",
      "description": "Production databases must have automated backups on.",
      "severity": "critical",
      "appliesTo": { "type": "database", "environment": "production" },
      "assert": [
        { "field": "automatedBackups", "op": "eq", "value": true, "expect": "true" }
      ]
    },
    {
      "id": "db-encryption",
      "name": "Encryption at rest",
      "description": "All databases must use encryption at rest.",
      "severity": "high",
      "appliesTo": { "type": "database" },
      "assert": [
        { "field": "encryptionAtRest", "op": "eq", "value": true, "expect": "true" }
      ]
    },
    {
      "id": "prod-db-no-public",
      "name": "No public production DBs",
      "description": "Production databases cannot be publicly accessible.",
      "severity": "critical",
      "appliesTo": { "type": "database", "environment": "production" },
      "assert": [
        { "field": "publiclyAccessible", "op": "eq", "value": false, "expect": "false" }
      ]
    },
    {
      "id": "prod-db-ha",
      "name": "Production HA replicas",
      "description": "Production databases need at least 2 replicas.",
      "severity": "high",
      "appliesTo": { "type": "database", "environment": "production" },
      "assert": [
        { "field": "replicaCount", "op": "gte", "value": 2, "expect": ">= 2" }
      ]
    },
    {
      "id": "dev-cost-instance",
      "name": "Dev cost-optimized instances",
      "description": "Non-prod DBs should use smaller / burstable classes.",
      "severity": "medium",
      "appliesTo": { "type": "database", "environment": ["development", "staging"] },
      "assert": [
        { "field": "instanceType", "op": "matches", "value": "costOptimizedInstance" }
      ]
    }
  ]
}`;

function MoonOrb() {
  return (
    <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-gradient-to-br from-slate-200/90 via-indigo-200/40 to-transparent opacity-90 shadow-[0_0_80px_rgba(180,200,255,0.35)] ring-1 ring-white/20" />
  );
}

export default function Home() {
  const [infra, setInfra] = useState(DEFAULT_INFRA);
  const [policies, setPolicies] = useState(DEFAULT_POLICIES);
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: "welcome",
      role: "system",
      text: "Load a snapshot and policy pack, then run a scan. Violations show up as cards below—each ties a service to the rule that failed.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  const appendLine = useCallback((line: Omit<ChatLine, "id">) => {
    setLines((prev) => [...prev, { ...line, id: `${Date.now()}-${Math.random()}` }]);
  }, []);

  const runScan = useCallback(async () => {
    setLoading(true);
    appendLine({
      role: "user",
      text: "Run compliance scan on current snapshot + policies.",
    });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ infrastructure: infra, policies }),
      });
      const data = (await res.json()) as ScanResult & { error?: string };
      if (!res.ok) {
        appendLine({
          role: "result",
          text: data.error ?? "Request failed",
        });
        return;
      }
      const summary = data.passed
        ? `Clean run — ${data.serviceCount} services, ${data.ruleCount} rules, zero violations.`
        : `Found ${data.violations.length} violation(s) across ${data.serviceCount} services (${data.ruleCount} rules).`;
      appendLine({
        role: "result",
        text: summary,
        violations: data.violations,
        passed: data.passed,
        meta: data.scannedAt,
      });
    } catch (e) {
      appendLine({
        role: "result",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLine, infra, policies]);

  return (
    <main className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-4 pb-16 pt-10 md:px-8">
      <MoonOrb />

      <header className="relative z-10 mb-10 text-center">
        <p className="text-xs font-medium uppercase tracking-[0.25em] text-indigo-300/80">
          Infrastructure
        </p>
        <h1 className="mt-2 bg-gradient-to-r from-slate-100 via-indigo-100 to-slate-300 bg-clip-text text-3xl font-semibold text-transparent md:text-4xl">
          Compliance Scanner
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-slate-400">
          Declarative rules over a JSON snapshot of services—same engine powers the API and CLI.
        </p>
      </header>

      <div className="relative z-10 grid flex-1 gap-6 lg:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-slate-950/40 p-5 shadow-xl backdrop-blur-md">
          <h2 className="text-sm font-medium text-indigo-200/90">Snapshot (JSON)</h2>
          <textarea
            className="min-h-[220px] flex-1 resize-y rounded-xl border border-white/10 bg-black/30 p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-slate-200 outline-none ring-indigo-500/30 focus:border-indigo-400/50 focus:ring-2"
            spellCheck={false}
            value={infra}
            onChange={(e) => setInfra(e.target.value)}
            aria-label="Infrastructure JSON"
          />
          <h2 className="text-sm font-medium text-indigo-200/90">Policies (JSON)</h2>
          <textarea
            className="min-h-[220px] flex-1 resize-y rounded-xl border border-white/10 bg-black/30 p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-slate-200 outline-none ring-indigo-500/30 focus:border-indigo-400/50 focus:ring-2"
            spellCheck={false}
            value={policies}
            onChange={(e) => setPolicies(e.target.value)}
            aria-label="Policies JSON"
          />
          <button
            type="button"
            onClick={runScan}
            disabled={loading}
            className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? "Scanning…" : "Run scan"}
          </button>
        </section>

        <section className="flex max-h-[min(70vh,720px)] flex-col rounded-2xl border border-white/10 bg-slate-950/50 shadow-xl backdrop-blur-md">
          <div className="border-b border-white/10 px-5 py-3">
            <h2 className="text-sm font-medium text-indigo-200/90">Session</h2>
            <p className="text-xs text-slate-500">Moon-chat style feed of actions and findings</p>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {lines.map((line) => (
              <article
                key={line.id}
                className={
                  line.role === "user"
                    ? "ml-8 rounded-2xl rounded-tr-sm border border-indigo-500/20 bg-indigo-950/50 px-4 py-3 text-sm text-slate-200"
                    : line.role === "system"
                      ? "rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-sm text-slate-400"
                      : "mr-6 rounded-2xl rounded-tl-sm border border-violet-500/20 bg-violet-950/40 px-4 py-3 text-sm text-slate-100"
                }
              >
                <p className="whitespace-pre-wrap">{line.text}</p>
                {line.meta ? (
                  <p className="mt-2 font-[family-name:var(--font-mono)] text-[10px] text-slate-500">
                    {line.meta}
                  </p>
                ) : null}
                {line.violations && line.violations.length > 0 ? (
                  <ul className="mt-4 space-y-3">
                    {line.violations.map((v, i) => (
                      <li
                        key={`${v.ruleId}-${v.serviceId}-${i}`}
                        className="rounded-xl border border-rose-500/20 bg-rose-950/30 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-rose-200">
                            {v.severity}
                          </span>
                          <span className="font-medium text-rose-100">{v.ruleName}</span>
                        </div>
                        <p className="mt-1 text-slate-300">
                          <span className="text-indigo-300">{v.serviceId}</span>
                          {v.serviceName ? ` (${v.serviceName})` : ""}
                        </p>
                        <p className="mt-1 text-slate-400">{v.reason}</p>
                        {v.field !== undefined ? (
                          <p className="mt-1 font-[family-name:var(--font-mono)] text-[10px] text-slate-500">
                            field: {v.field} · actual: {JSON.stringify(v.actual)} · expected:{" "}
                            {v.expected}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {line.passed === true ? (
                  <p className="mt-3 text-xs font-medium text-emerald-400/90">All checks passed.</p>
                ) : null}
              </article>
            ))}
            <div ref={bottomRef} />
          </div>
        </section>
      </div>

      <footer className="relative z-10 mt-10 text-center text-xs text-slate-600">
        CLI: <code className="font-[family-name:var(--font-mono)] text-slate-500">npm run scan</code>{" "}
        · samples in <code className="font-[family-name:var(--font-mono)]">examples/</code>
      </footer>
    </main>
  );
}
