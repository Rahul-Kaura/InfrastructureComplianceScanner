"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  POLICY_CATEGORY_ORDER,
  violationSummaryPlain,
  type PassedCheck,
  type PolicyCategory,
  type ScanResult,
  type Violation,
} from "@/lib/engine";

const EMPTY_INFRA_JSON = `{
  "version": "1",
  "services": []
}
`;

const CATEGORY_LABEL: Record<PolicyCategory, string> = {
  security: "Security",
  cost: "Cost",
  operational: "Operational",
};

const SEVERITY_ORDER: Record<Violation["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function violationsByCategory(violations: Violation[]) {
  return POLICY_CATEGORY_ORDER.map((category) => ({
    category,
    items: violations
      .filter((v) => v.category === category)
      .sort((a, b) => {
        const d = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (d !== 0) return d;
        return `${a.serviceId}\0${a.ruleName}`.localeCompare(`${b.serviceId}\0${b.ruleName}`);
      }),
  })).filter((g) => g.items.length > 0);
}

function passesByCategory(passes: PassedCheck[]) {
  return POLICY_CATEGORY_ORDER.map((category) => ({
    category,
    items: passes
      .filter((p) => p.category === category)
      .sort((a, b) =>
        `${a.ruleName}\0${a.serviceId}`.localeCompare(`${b.ruleName}\0${b.serviceId}`),
      ),
  })).filter((g) => g.items.length > 0);
}

type ChatRole = "system" | "user" | "result";

interface ChatLine {
  id: string;
  role: ChatRole;
  text: string;
  violations?: Violation[];
  passes?: PassedCheck[];
  passed?: boolean;
  meta?: string;
}

function MoonOrb() {
  return (
    <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-gradient-to-br from-slate-200/90 via-indigo-200/40 to-transparent opacity-90 shadow-[0_0_80px_rgba(180,200,255,0.35)] ring-1 ring-white/20" />
  );
}

export default function Home() {
  const [policies, setPolicies] = useState("");
  const [infrastructureJson, setInfrastructureJson] = useState(EMPTY_INFRA_JSON);
  const [configAiPrompt, setConfigAiPrompt] = useState("");
  const [policyAiPrompt, setPolicyAiPrompt] = useState("");
  const [configAiLoading, setConfigAiLoading] = useState(false);
  const [policyAiLoading, setPolicyAiLoading] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: "welcome",
      role: "system",
      text: "Paste or generate configuration JSON (inventory) and policies separately. Each rule must declare a category: security, cost, or operational — in JSON use the category field; as bullets use a prefix like [security]. OpenAI can draft either side from plain English (server needs OPENAI_API_KEY). The scan itself is deterministic.",
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

  const generateInfrastructureWithAi = useCallback(async () => {
    if (!configAiPrompt.trim()) return;
    setConfigAiLoading(true);
    appendLine({
      role: "user",
      text: "Generate infrastructure JSON from the configuration prompt (OpenAI).",
    });
    try {
      const res = await fetch("/api/infrastructure/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: configAiPrompt.trim() }),
      });
      const data = (await res.json()) as { infrastructure?: string; error?: string };
      if (!res.ok) {
        appendLine({ role: "result", text: data.error ?? "Infrastructure generation failed" });
        return;
      }
      if (typeof data.infrastructure === "string") {
        setInfrastructureJson(data.infrastructure);
        appendLine({
          role: "result",
          text: "Configuration JSON was generated and loaded into the editor. Review it, add policies, then run scan.",
        });
      }
    } catch (e) {
      appendLine({
        role: "result",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setConfigAiLoading(false);
    }
  }, [appendLine, configAiPrompt]);

  const generatePoliciesWithAi = useCallback(async () => {
    if (!policyAiPrompt.trim()) return;
    setPolicyAiLoading(true);
    appendLine({
      role: "user",
      text: "Generate policy bundle JSON from the policy prompt (OpenAI).",
    });
    try {
      const res = await fetch("/api/policies/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: policyAiPrompt.trim() }),
      });
      const data = (await res.json()) as { policies?: string; error?: string };
      if (!res.ok) {
        appendLine({ role: "result", text: data.error ?? "Policy generation failed" });
        return;
      }
      if (typeof data.policies === "string") {
        setPolicies(data.policies);
        appendLine({
          role: "result",
          text: "Policy JSON was generated and loaded into the policies editor. Every rule includes a category. Review, then run scan.",
        });
      }
    } catch (e) {
      appendLine({
        role: "result",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setPolicyAiLoading(false);
    }
  }, [appendLine, policyAiPrompt]);

  const runScan = useCallback(async () => {
    setLoading(true);
    appendLine({
      role: "user",
      text: "Run scan — configuration + policies from editors.",
    });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policies,
          infrastructure: infrastructureJson.trim(),
        }),
      });
      const data = (await res.json()) as ScanResult & {
        error?: string;
      };
      if (!res.ok) {
        appendLine({
          role: "result",
          text: data.error ?? "Request failed",
        });
        return;
      }
      const violations: Violation[] = (data.violations ?? []).map((v) => ({
        ...v,
        category:
          v.category === "security" || v.category === "cost" || v.category === "operational"
            ? v.category
            : "operational",
        recommendation:
          typeof v.recommendation === "string" && v.recommendation.length > 0
            ? v.recommendation
            : "Update configuration to satisfy the policy, verify in inventory, and re-scan.",
      }));
      const passes: PassedCheck[] = (data.passes ?? []).map((p) => ({
        ...p,
        category:
          p.category === "security" || p.category === "cost" || p.category === "operational"
            ? p.category
            : "operational",
      }));
      const passCount = passes.length;
      const violCount = violations.length;
      const summary = data.passed
        ? `Clean run — ${data.serviceCount} services, ${data.ruleCount} rules, zero violations${passCount ? `, ${passCount} passed (service × rule) check${passCount === 1 ? "" : "s"}` : ""}.`
        : `Found ${violCount} violation(s)${passCount ? ` and ${passCount} passed check${passCount === 1 ? "" : "s"}` : ""} across ${data.serviceCount} services (${data.ruleCount} rules).`;
      appendLine({
        role: "result",
        text: summary,
        violations,
        passes,
        passed: data.passed,
        meta: `Inventory from configuration editor\n${data.scannedAt}`,
      });
    } catch (e) {
      appendLine({
        role: "result",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLine, policies, infrastructureJson]);

  const canScan =
    infrastructureJson.trim().length > 0 && policies.trim().length > 0 && !loading;

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
      </header>

      <div className="relative z-10 grid flex-1 gap-6 lg:grid-cols-2">
        <section className="flex max-h-[min(92vh,1400px)] flex-col gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/40 p-5 shadow-xl backdrop-blur-md">
          <h2 className="text-sm font-medium text-indigo-200/90">Configuration (inventory JSON)</h2>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Object with a <code className="text-slate-400">services</code> array. Each service needs{" "}
            <code className="text-slate-400">id</code>, <code className="text-slate-400">type</code>,{" "}
            <code className="text-slate-400">environment</code>, and optional fields such as{" "}
            <code className="text-slate-400">automatedBackups</code>,{" "}
            <code className="text-slate-400">encryptionAtRest</code>,{" "}
            <code className="text-slate-400">publiclyAccessible</code>,{" "}
            <code className="text-slate-400">replicaCount</code>,{" "}
            <code className="text-slate-400">instanceType</code>.
          </p>

          <details className="rounded-xl border border-cyan-500/25 bg-cyan-950/15 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-cyan-200/90">
              Ideas for what to model (5–10 services)
            </summary>
            <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] leading-relaxed text-slate-400">
              <li>Production OLTP database: backups on, encryption on, not public, HA replicas.</li>
              <li>Second prod DB (e.g. audit) with different flags to create violations.</li>
              <li>Staging analytics DB: different instance class / encryption choices.</li>
              <li>Development sandbox DB or cache with looser settings.</li>
              <li>Compute or batch instances in dev/staging with instance types you want to govern.</li>
              <li>Mix <code className="text-slate-500">production</code>,{" "}
                <code className="text-slate-500">staging</code>, and{" "}
                <code className="text-slate-500">development</code> so policies can target environments.
              </li>
            </ul>
          </details>

          <div className="rounded-xl border border-sky-500/20 bg-sky-950/15 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-sky-200/80">
              Draft configuration with OpenAI
            </p>
            <textarea
              className="mb-2 min-h-[72px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-slate-200 outline-none focus:border-sky-400/40 focus:ring-1 focus:ring-sky-500/30"
              spellCheck={false}
              value={configAiPrompt}
              onChange={(e) => setConfigAiPrompt(e.target.value)}
              placeholder="e.g. 2 prod RDS databases (one with backups off and public), 1 staging DB with encryption off, 2 dev DBs on small burstable classes, 1 dev EC2 worker…"
              aria-label="Prompt for AI infrastructure generation"
            />
            <button
              type="button"
              onClick={() => void generateInfrastructureWithAi()}
              disabled={configAiLoading || !configAiPrompt.trim()}
              className="rounded-lg bg-sky-600/80 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              {configAiLoading ? "Calling OpenAI…" : "Generate configuration JSON"}
            </button>
          </div>

          <textarea
            className="min-h-[200px] flex-1 resize-y rounded-xl border border-white/10 bg-black/30 p-3 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-slate-200 outline-none ring-indigo-500/30 focus:border-indigo-400/50 focus:ring-2"
            spellCheck={false}
            value={infrastructureJson}
            onChange={(e) => setInfrastructureJson(e.target.value)}
            aria-label="Infrastructure snapshot JSON"
            placeholder='{ "version": "1", "services": [ ... ] }'
          />

          <h2 className="text-sm font-medium text-indigo-200/90">Policies</h2>
          <p className="text-[11px] text-slate-500">
            <strong className="text-slate-400">JSON:</strong> every rule must include{" "}
            <code className="text-slate-400">&quot;category&quot;: &quot;security&quot; | &quot;cost&quot; | &quot;operational&quot;</code>
            . <strong className="text-slate-400">Bullets:</strong> start each line with{" "}
            <code className="text-slate-400">[security]</code>, <code className="text-slate-400">[cost]</code>, or{" "}
            <code className="text-slate-400">[operational]</code>. Server needs{" "}
            <code className="text-slate-400">OPENAI_API_KEY</code> for AI drafting.
          </p>

          <details className="rounded-xl border border-violet-500/25 bg-violet-950/15 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold text-violet-200/90">
              Example policy lines (bullets) — copy &amp; edit
            </summary>
            <ul className="mt-2 space-y-2 font-[family-name:var(--font-mono)] text-[10px] leading-relaxed text-slate-400">
              <li>[operational] All production databases must have automated backups enabled</li>
              <li>[security] All databases must use encryption at rest</li>
              <li>[security] Production databases cannot be publicly accessible</li>
              <li>[operational] Production databases must have at least 2 replicas for high availability</li>
              <li>[cost] Development and staging databases must use cost-optimized or burstable instance types</li>
            </ul>
          </details>

          <div className="rounded-xl border border-violet-500/20 bg-violet-950/15 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-200/80">
              Draft policies with OpenAI
            </p>
            <textarea
              className="mb-2 min-h-[72px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-slate-200 outline-none focus:border-violet-400/40 focus:ring-1 focus:ring-violet-500/30"
              spellCheck={false}
              value={policyAiPrompt}
              onChange={(e) => setPolicyAiPrompt(e.target.value)}
              placeholder="List rules and say which are security vs cost vs operational, e.g. security: no public prod DBs, encryption at rest; operational: prod backups and 2+ replicas; cost: dev/staging on burstable classes…"
              aria-label="Prompt for AI policy generation"
            />
            <button
              type="button"
              onClick={() => void generatePoliciesWithAi()}
              disabled={policyAiLoading || !policyAiPrompt.trim()}
              className="rounded-lg bg-violet-600/80 px-3 py-2 text-xs font-semibold text-white transition hover:bg-violet-500 disabled:opacity-40"
            >
              {policyAiLoading ? "Calling OpenAI…" : "Generate policy JSON"}
            </button>
          </div>

          <textarea
            className="min-h-[min(280px,35vh)] flex-1 resize-y rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-slate-200 outline-none ring-indigo-500/30 focus:border-indigo-400/50 focus:ring-2"
            spellCheck={false}
            value={policies}
            onChange={(e) => setPolicies(e.target.value)}
            aria-label="Policies as bullet list or JSON"
            placeholder='JSON: { "version": "1", "rules": [ { "category": "security", ... } ] }  or bullets with [security] / [cost] / [operational] prefixes'
          />

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-center text-[11px] text-slate-500 sm:text-left">
              Scans <span className="font-medium text-indigo-200/90">configuration + policies</span> together
            </p>
            <button
              type="button"
              onClick={runScan}
              disabled={!canScan}
              className="rounded-full bg-gradient-to-r from-indigo-500 to-violet-600 px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:brightness-110 disabled:opacity-50"
            >
              {loading ? "Scanning…" : "Run scan"}
            </button>
          </div>
        </section>

        <section className="flex max-h-[min(70vh,720px)] flex-col rounded-2xl border border-white/10 bg-slate-950/50 shadow-xl backdrop-blur-md">
          <div className="border-b border-white/10 px-5 py-3">
            <h2 className="text-sm font-medium text-indigo-200/90">Results</h2>
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
                  <p className="mt-2 whitespace-pre-line font-[family-name:var(--font-mono)] text-[10px] text-slate-500">
                    {line.meta}
                  </p>
                ) : null}
                {line.violations && line.violations.length > 0 ? (
                  <>
                    <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-rose-200/80">
                      Violations
                    </p>
                    <div className="mt-2 space-y-4">
                      {violationsByCategory(line.violations).map(({ category, items }) => (
                        <div key={category}>
                          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-rose-300/70">
                            {CATEGORY_LABEL[category]}
                          </p>
                          <ul className="space-y-3">
                            {items.map((v, i) => (
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
                                <p className="mt-2 text-[13px] leading-relaxed text-slate-200/95">
                                  {violationSummaryPlain(v)}
                                </p>
                                <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-950/25 p-2 text-[11px] leading-relaxed text-amber-100/90">
                                  <span className="font-semibold text-amber-200/95">
                                    Recommendation:{" "}
                                  </span>
                                  {v.recommendation}
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}
                {line.passes && line.passes.length > 0 ? (
                  <>
                    <p className="mt-4 text-[10px] font-semibold uppercase tracking-wide text-emerald-200/80">
                      Passed checks
                    </p>
                    <div className="mt-2 space-y-4">
                      {passesByCategory(line.passes).map(({ category, items }) => (
                        <div key={category}>
                          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-emerald-300/70">
                            {CATEGORY_LABEL[category]}
                          </p>
                          <ul className="space-y-2">
                            {items.map((p) => (
                              <li
                                key={`${p.ruleId}-${p.serviceId}`}
                                className="rounded-xl border border-emerald-500/25 bg-emerald-950/25 p-3 text-xs"
                              >
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">
                                    pass · {p.severity}
                                  </span>
                                  <span className="font-medium text-emerald-100">{p.ruleName}</span>
                                </div>
                                <p className="mt-1 text-slate-300">
                                  <span className="text-indigo-300">{p.serviceId}</span>
                                  {p.serviceName ? ` (${p.serviceName})` : ""}
                                </p>
                                <p className="mt-1 text-slate-500">
                                  All assertions passed for this service.
                                </p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </>
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
        Reference policy JSON shape under{" "}
        <code className="font-[family-name:var(--font-mono)] text-slate-500">examples/policies/sample.json</code>
        . Rules require <code className="text-slate-500">category</code>: security | cost | operational.
      </footer>
    </main>
  );
}
