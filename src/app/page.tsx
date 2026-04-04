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
import { SCAN_PRESETS_CLEAN, SCAN_PRESETS_MIXED, SCAN_PRESETS_VIOLATIONS } from "@/lib/scanPresets";
import { SNAPSHOT_IDS, SNAPSHOT_MANIFEST, type SnapshotId } from "@/lib/snapshotManifest";

function isResponseSnapshotId(x: string | undefined): x is SnapshotId {
  return x === "default" || x === "variant";
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

const DEFAULT_POLICIES = `Example policies:
- All production databases must have automated backups enabled
- All databases must use encryption at rest
- Production databases cannot be publicly accessible
- Production databases must have at least 2 replicas for high availability
- Dev/staging environments must use cost-optimized instance types`;

function MoonOrb() {
  return (
    <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-gradient-to-br from-slate-200/90 via-indigo-200/40 to-transparent opacity-90 shadow-[0_0_80px_rgba(180,200,255,0.35)] ring-1 ring-white/20" />
  );
}

export default function Home() {
  const [policies, setPolicies] = useState(DEFAULT_POLICIES);
  const [snapshotId, setSnapshotId] = useState<SnapshotId>("default");
  const [infrastructureJson, setInfrastructureJson] = useState("");
  const [infraLoading, setInfraLoading] = useState(true);
  const [policyAiPrompt, setPolicyAiPrompt] = useState("");
  const [policyAiLoading, setPolicyAiLoading] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([
    {
      id: "welcome",
      role: "system",
      text: "Configuration (left) is your infrastructure JSON: services[] with id, type, environment, and fields like automatedBackups. Load A/B templates or paste your own. Policies are separate (bullets or JSON). Optional: describe rules in plain English and use OpenAI to draft policy JSON (set OPENAI_API_KEY on the server). The engine still evaluates everything deterministically — the model only helps author rules.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  useEffect(() => {
    let cancelled = false;
    setInfraLoading(true);
    fetch(`/api/infrastructure?snapshotId=${snapshotId}`)
      .then(async (r) => {
        const d = (await r.json()) as { content?: string; error?: string };
        if (!r.ok) throw new Error(d.error ?? "Failed to load infrastructure");
        return d.content ?? "";
      })
      .then((text) => {
        if (!cancelled) setInfrastructureJson(text);
      })
      .catch(() => {
        if (!cancelled) setInfrastructureJson("");
      })
      .finally(() => {
        if (!cancelled) setInfraLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  const appendLine = useCallback((line: Omit<ChatLine, "id">) => {
    setLines((prev) => [...prev, { ...line, id: `${Date.now()}-${Math.random()}` }]);
  }, []);

  const generatePoliciesWithAi = useCallback(async () => {
    if (!policyAiPrompt.trim()) return;
    setPolicyAiLoading(true);
    appendLine({
      role: "user",
      text: "Generate policy bundle JSON from the AI prompt (OpenAI).",
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
          text: "Policy JSON was generated and loaded into the policies editor. Review it, then run scan.",
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
      text: `Run scan — configuration from editor (template: ${SNAPSHOT_MANIFEST[snapshotId].shortLabel}).`,
    });
    try {
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policies,
          infrastructure: infrastructureJson.trim(),
          inventoryTemplate: snapshotId,
        }),
      });
      const data = (await res.json()) as ScanResult & {
        error?: string;
        snapshotId?: string;
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
      const invMeta =
        isResponseSnapshotId(data.snapshotId) && data.snapshotId
          ? `${SNAPSHOT_MANIFEST[data.snapshotId].label}\n${SNAPSHOT_MANIFEST[data.snapshotId].file}`
          : "Custom infrastructure JSON";
      appendLine({
        role: "result",
        text: summary,
        violations,
        passes,
        passed: data.passed,
        meta: `${invMeta}\n${data.scannedAt}`,
      });
    } catch (e) {
      appendLine({
        role: "result",
        text: e instanceof Error ? e.message : "Network error",
      });
    } finally {
      setLoading(false);
    }
  }, [appendLine, policies, snapshotId, infrastructureJson]);

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

      <div className="relative z-10 mx-auto mb-8 w-full max-w-2xl px-2">
        <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.2em] text-indigo-300/90">
          Choose infrastructure
        </p>
        <p className="mb-4 text-center text-sm text-slate-400">
          Loads the template into the configuration JSON editor below. Edit services there, then add policies separately.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          {SNAPSHOT_IDS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setSnapshotId(id)}
              title={SNAPSHOT_MANIFEST[id].description}
              className={`min-h-[4.5rem] flex-1 rounded-2xl border-2 px-5 py-3 text-left shadow-lg transition sm:max-w-[min(100%,280px)] ${
                snapshotId === id
                  ? "border-indigo-400 bg-gradient-to-br from-indigo-600/40 to-violet-600/30 text-white ring-2 ring-indigo-400/50"
                  : "border-white/20 bg-slate-900/60 text-slate-200 hover:border-indigo-400/40 hover:bg-slate-800/80"
              }`}
            >
              <span className="block text-base font-bold">{SNAPSHOT_MANIFEST[id].shortLabel}</span>
              <span className="mt-1 block text-xs font-normal leading-snug text-slate-300/90">
                {SNAPSHOT_MANIFEST[id].buttonTitle}
              </span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-[11px] text-slate-500">
          Last loaded template:{" "}
          <code className="rounded bg-black/30 px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-slate-400">
            examples/infrastructure/{SNAPSHOT_MANIFEST[snapshotId].file}
          </code>
          {infraLoading ? " · loading…" : ""}
        </p>
      </div>

      <div className="relative z-10 grid flex-1 gap-6 lg:grid-cols-2">
        <section className="flex max-h-[min(92vh,1400px)] flex-col gap-4 overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/40 p-5 shadow-xl backdrop-blur-md">
          <h2 className="text-sm font-medium text-indigo-200/90">Configuration (inventory JSON)</h2>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Normalized snapshot: an object with a <code className="text-slate-400">services</code> array.
            Each service needs <code className="text-slate-400">id</code>,{" "}
            <code className="text-slate-400">type</code>, <code className="text-slate-400">environment</code>,
            plus optional <code className="text-slate-400">automatedBackups</code>,{" "}
            <code className="text-slate-400">encryptionAtRest</code>,{" "}
            <code className="text-slate-400">publiclyAccessible</code>,{" "}
            <code className="text-slate-400">replicaCount</code>,{" "}
            <code className="text-slate-400">instanceType</code>.
          </p>
          <textarea
            className="min-h-[200px] flex-1 resize-y rounded-xl border border-white/10 bg-black/30 p-3 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-slate-200 outline-none ring-indigo-500/30 focus:border-indigo-400/50 focus:ring-2"
            spellCheck={false}
            value={infrastructureJson}
            onChange={(e) => setInfrastructureJson(e.target.value)}
            disabled={infraLoading}
            aria-label="Infrastructure snapshot JSON"
            placeholder='{ "version": "1", "services": [ ... ] }'
          />

          <h2 className="text-sm font-medium text-indigo-200/90">Policies</h2>
          <p className="text-[11px] text-slate-500">
            Separate from configuration: bullet lines or a policy bundle JSON. Optional AI assist (server needs{" "}
            <code className="text-slate-400">OPENAI_API_KEY</code>).
          </p>
          <div className="rounded-xl border border-violet-500/20 bg-violet-950/15 p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-violet-200/80">
              Draft policies with OpenAI
            </p>
            <textarea
              className="mb-2 min-h-[72px] w-full resize-y rounded-lg border border-white/10 bg-black/30 p-2 text-xs text-slate-200 outline-none focus:border-violet-400/40 focus:ring-1 focus:ring-violet-500/30"
              spellCheck={false}
              value={policyAiPrompt}
              onChange={(e) => setPolicyAiPrompt(e.target.value)}
              placeholder="e.g. Production databases must have backups and encryption; no public prod DBs; staging DBs should use burstable instance classes…"
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
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Example scans (uses {SNAPSHOT_MANIFEST[snapshotId].shortLabel} when you run)
            </p>
            <p className="mb-2 text-[10px] text-rose-200/70">Should report violations</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {SCAN_PRESETS_VIOLATIONS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => setPolicies(p.policies)}
                  className="rounded-lg border border-rose-500/35 bg-rose-950/20 px-2.5 py-1 text-left text-[11px] text-rose-100/90 transition hover:border-rose-400/50 hover:bg-rose-950/35"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[10px] text-sky-200/80">Violations + green passes</p>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {SCAN_PRESETS_MIXED.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => setPolicies(p.policies)}
                  className="rounded-lg border border-sky-500/35 bg-sky-950/20 px-2.5 py-1 text-left text-[11px] text-sky-100/90 transition hover:border-sky-400/50 hover:bg-sky-950/35"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[10px] text-emerald-200/70">Should pass (clean run)</p>
            <div className="flex flex-wrap gap-1.5">
              {SCAN_PRESETS_CLEAN.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  title={p.hint}
                  onClick={() => setPolicies(p.policies)}
                  className="rounded-lg border border-emerald-500/35 bg-emerald-950/20 px-2.5 py-1 text-left text-[11px] text-emerald-100/90 transition hover:border-emerald-400/50 hover:bg-emerald-950/35"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            className="min-h-[min(280px,35vh)] flex-1 resize-y rounded-xl border border-white/10 bg-black/30 p-3 text-sm leading-relaxed text-slate-200 outline-none ring-indigo-500/30 focus:border-indigo-400/50 focus:ring-2"
            spellCheck={false}
            value={policies}
            onChange={(e) => setPolicies(e.target.value)}
            aria-label="Policies as bullet list or JSON"
          />
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-center text-[11px] text-slate-500 sm:text-left">
              Scans <span className="font-medium text-indigo-200/90">configuration + policies</span> together
              {infraLoading ? " (loading config…)" : ""}
            </p>
            <button
              type="button"
              onClick={runScan}
              disabled={loading || infraLoading || !infrastructureJson.trim()}
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
        Policy samples under{" "}
        <code className="font-[family-name:var(--font-mono)] text-slate-500">examples/policies/</code>
        ; default snapshot under{" "}
        <code className="font-[family-name:var(--font-mono)] text-slate-500">examples/infrastructure/</code>
      </footer>
    </main>
  );
}
