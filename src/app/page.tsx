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
import { downloadCompliancePdf, type ComplianceReportPayload } from "@/lib/compliancePdf";

function serviceCountFromInventory(json: string): number | null {
  try {
    const o = JSON.parse(json) as { services?: unknown[] };
    return Array.isArray(o.services) ? o.services.length : null;
  } catch {
    return null;
  }
}

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
  const [serviceConfigPlainEnglish, setServiceConfigPlainEnglish] = useState("");
  /** Built snapshot sent to /api/scan; filled by OpenAI from plain English or pasted in Advanced. */
  const [builtInventoryJson, setBuiltInventoryJson] = useState("");
  const [policyAiPrompt, setPolicyAiPrompt] = useState("");
  const [configAiLoading, setConfigAiLoading] = useState(false);
  const [policyAiLoading, setPolicyAiLoading] = useState(false);
  const [lastComplianceReport, setLastComplianceReport] = useState<ComplianceReportPayload | null>(
    null,
  );
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: "welcome",
      role: "system",
      text: "Describe your services in plain English below; OpenAI turns that into inventory JSON for scanning (set OPENAI_API_KEY on the server). You can paste full inventory JSON under Advanced if you prefer. Policies are separate — each rule needs security, cost, or operational. After a scan, results are labeled for Service Manager and you can download a PDF report.",
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

  const buildInventoryFromPlainEnglish = useCallback(async () => {
    if (!serviceConfigPlainEnglish.trim()) return;
    setConfigAiLoading(true);
    appendLine({
      role: "user",
      text: "Build inventory snapshot from service configuration (plain English, OpenAI).",
    });
    try {
      const res = await fetch("/api/infrastructure/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: serviceConfigPlainEnglish.trim() }),
      });
      const data = (await res.json()) as { infrastructure?: string; error?: string };
      if (!res.ok) {
        appendLine({ role: "result", text: data.error ?? "Infrastructure generation failed" });
        return;
      }
      if (typeof data.infrastructure === "string") {
        setBuiltInventoryJson(data.infrastructure);
        const n = serviceCountFromInventory(data.infrastructure);
        appendLine({
          role: "result",
          text:
            n !== null
              ? `Inventory built: ${n} service(s). Run scan when policies are ready. (Optional: edit raw JSON under Advanced.)`
              : "Inventory built. Run scan when policies are ready.",
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
  }, [appendLine, serviceConfigPlainEnglish]);

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
      text: "Run scan — built inventory + policies.",
    });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policies,
          infrastructure: builtInventoryJson.trim(),
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
      setLastComplianceReport({
        scannedAt: data.scannedAt,
        passed: data.passed,
        summary,
        serviceCount: data.serviceCount,
        ruleCount: data.ruleCount,
        violations,
        passes,
      });
      appendLine({
        role: "result",
        text: summary,
        violations,
        passes,
        passed: data.passed,
        meta: `Inventory (built or pasted)\n${data.scannedAt}`,
      });
    } catch (e) {
      appendLine({
        role: "result",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLine, policies, builtInventoryJson]);

  const builtServiceCount = serviceCountFromInventory(builtInventoryJson);
  const canScan =
    builtInventoryJson.trim().length > 0 && policies.trim().length > 0 && !loading;

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
          <h2 className="text-sm font-medium text-indigo-200/90">Inventory</h2>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Describe the services you want modeled in plain English. OpenAI converts that into the internal snapshot
            (with <code className="text-slate-400">services[]</code>) used for scanning. Or skip the model and paste JSON
            under <strong className="text-slate-400">Advanced</strong>.
          </p>

          <div className="rounded-xl border border-slate-500/20 bg-slate-900/40 p-3">
            <label
              htmlFor="service-config-plain"
              className="mb-1 block text-[11px] font-semibold tracking-wide text-slate-300"
            >
              Enter Service Configuration (In Plain English)
            </label>
            <textarea
              id="service-config-plain"
              className="mb-2 min-h-[120px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-2 text-xs leading-relaxed text-slate-200 outline-none focus:border-slate-400/40 focus:ring-1 focus:ring-slate-500/30"
              spellCheck={false}
              value={serviceConfigPlainEnglish}
              onChange={(e) => setServiceConfigPlainEnglish(e.target.value)}
              placeholder="e.g. Two production RDS databases (one well-hardened with backups and private; one audit DB without backups and public). One staging DB with encryption off. Two dev DBs on small burstable classes. One dev EC2 worker…"
              aria-label="Enter Service Configuration (In Plain English)"
            />
            <button
              type="button"
              onClick={() => void buildInventoryFromPlainEnglish()}
              disabled={configAiLoading || !serviceConfigPlainEnglish.trim()}
              className="rounded-lg bg-sky-600/80 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-500 disabled:opacity-40"
            >
              {configAiLoading ? "Calling OpenAI…" : "Build inventory"}
            </button>
            <p className="mt-2 text-[11px] text-slate-500">
              {builtInventoryJson.trim()
                ? builtServiceCount !== null
                  ? `Ready to scan: ${builtServiceCount} service(s) in built inventory.`
                  : "Built inventory present. Run scan when policies are set."
                : "Build inventory from English or paste JSON under Advanced before scanning."}
            </p>
          </div>

          <details className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
            <summary className="cursor-pointer text-[11px] font-medium text-slate-400">
              Advanced — paste or edit full inventory JSON
            </summary>
            <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
              Direct <code className="text-slate-500">services[]</code> snapshot used for the scan. Not synced with the
              plain-English field above.
            </p>
            <textarea
              className="mt-2 min-h-[160px] w-full resize-y rounded-lg border border-white/10 bg-black/40 p-2 font-[family-name:var(--font-mono)] text-[10px] leading-relaxed text-slate-300 outline-none focus:border-indigo-400/40 focus:ring-1"
              spellCheck={false}
              value={builtInventoryJson}
              onChange={(e) => setBuiltInventoryJson(e.target.value)}
              aria-label="Full infrastructure snapshot JSON"
              placeholder='{ "version": "1", "services": [ ... ] }'
            />
          </details>

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

        <section className="flex max-h-[min(70vh,720px)] min-h-0 flex-col rounded-2xl border border-white/10 bg-slate-950/50 shadow-xl backdrop-blur-md">
          <div className="shrink-0 border-b border-white/10 px-5 py-3">
            <h2 className="text-sm font-medium text-indigo-200/90">Results</h2>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
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
                                    pass
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
          {lastComplianceReport ? (
            <div className="shrink-0 space-y-3 border-t border-white/10 bg-slate-900/50 px-5 py-4">
              <p className="text-center text-sm font-medium text-slate-200">Sent to Service Manager</p>
              <button
                type="button"
                onClick={() => downloadCompliancePdf(lastComplianceReport)}
                className="w-full rounded-xl border border-indigo-500/40 bg-indigo-950/40 px-4 py-2.5 text-sm font-semibold text-indigo-100 transition hover:border-indigo-400/60 hover:bg-indigo-900/50"
              >
                Download PDF of compliance results
              </button>
            </div>
          ) : null}
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
