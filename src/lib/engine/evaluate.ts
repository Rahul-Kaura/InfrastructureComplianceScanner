import type {
  Assertion,
  ComplianceRule,
  InfrastructureSnapshot,
  PolicyBundle,
  RuleSelector,
  ScanResult,
  ServiceConfig,
  Violation,
} from "./types";

const COST_OPTIMIZED_PREFIXES = ["t3", "t4g", "t3a", "m6g", "r6g", "db.t3", "db.t4g"];

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function matchesSelector(service: ServiceConfig, sel?: RuleSelector): boolean {
  if (!sel) return true;
  if (sel.type !== undefined) {
    const types = Array.isArray(sel.type) ? sel.type : [sel.type];
    if (!types.includes(service.type)) return false;
  }
  if (sel.environment !== undefined) {
    const envs = Array.isArray(sel.environment) ? sel.environment : [sel.environment];
    if (!envs.includes(service.environment)) return false;
  }
  return true;
}

function evalAssertion(service: ServiceConfig, a: Assertion): { ok: boolean; detail?: string } {
  const actual = getByPath(service as Record<string, unknown>, a.field);
  const op = a.op;
  const v = a.value;

  const fail = (msg: string) => ({ ok: false, detail: msg });

  switch (op) {
    case "eq":
      if (actual !== v)
        return fail(
          `expected ${a.expect ?? JSON.stringify(v)}, got ${JSON.stringify(actual)}`,
        );
      return { ok: true };
    case "neq":
      if (actual === v)
        return fail(`must not equal ${JSON.stringify(v)} (was ${JSON.stringify(actual)})`);
      return { ok: true };
    case "gte": {
      const n = Number(actual);
      const target = Number(v);
      if (Number.isNaN(n) || n < target)
        return fail(`expected >= ${target}, got ${JSON.stringify(actual)}`);
      return { ok: true };
    }
    case "lte": {
      const n = Number(actual);
      const target = Number(v);
      if (Number.isNaN(n) || n > target)
        return fail(`expected <= ${target}, got ${JSON.stringify(actual)}`);
      return { ok: true };
    }
    case "gt": {
      const n = Number(actual);
      const target = Number(v);
      if (Number.isNaN(n) || n <= target)
        return fail(`expected > ${target}, got ${JSON.stringify(actual)}`);
      return { ok: true };
    }
    case "lt": {
      const n = Number(actual);
      const target = Number(v);
      if (Number.isNaN(n) || n >= target)
        return fail(`expected < ${target}, got ${JSON.stringify(actual)}`);
      return { ok: true };
    }
    case "in": {
      const arr = Array.isArray(v) ? v : [];
      if (!arr.includes(actual))
        return fail(`expected one of ${JSON.stringify(arr)}, got ${JSON.stringify(actual)}`);
      return { ok: true };
    }
    case "notIn": {
      const arr = Array.isArray(v) ? v : [];
      if (arr.includes(actual))
        return fail(`must not be one of ${JSON.stringify(arr)}`);
      return { ok: true };
    }
    case "matches": {
      if (v === "costOptimizedInstance") {
        const t = String(actual ?? "");
        const ok = COST_OPTIMIZED_PREFIXES.some((p) =>
          t.toLowerCase().includes(p.toLowerCase()),
        );
        if (!ok)
          return fail(
            `dev/staging should use a cost-optimized family (e.g. t3/t4g); got ${t || "unknown"}`,
          );
        return { ok: true };
      }
      return fail(`unknown matcher: ${String(v)}`);
    }
    default:
      return fail(`unsupported op: ${String(op)}`);
  }
}

export function evaluateRule(service: ServiceConfig, rule: ComplianceRule): Violation[] {
  if (!matchesSelector(service, rule.appliesTo)) return [];

  const out: Violation[] = [];
  for (const assertion of rule.assert) {
    const r = evalAssertion(service, assertion);
    if (!r.ok) {
      out.push({
        ruleId: rule.id,
        ruleName: rule.name,
        severity: rule.severity,
        serviceId: service.id,
        serviceName: service.name,
        reason: r.detail ?? "assertion failed",
        field: assertion.field,
        actual: getByPath(service as Record<string, unknown>, assertion.field),
        expected: assertion.expect ?? JSON.stringify(assertion.value),
      });
    }
  }
  return out;
}

export function scan(
  infra: InfrastructureSnapshot,
  policies: PolicyBundle,
  scannedAt = new Date().toISOString(),
): ScanResult {
  const violations: Violation[] = [];
  for (const service of infra.services) {
    for (const rule of policies.rules) {
      violations.push(...evaluateRule(service, rule));
    }
  }
  return {
    scannedAt,
    serviceCount: infra.services.length,
    ruleCount: policies.rules.length,
    violations,
    passed: violations.length === 0,
  };
}

export function parseInfrastructureJson(text: string): InfrastructureSnapshot {
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object")
    throw new Error("Infrastructure JSON must be an object");
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.services)) throw new Error('Missing "services" array');
  for (const s of o.services as unknown[]) {
    if (!s || typeof s !== "object") throw new Error("Each service must be an object");
    const svc = s as Record<string, unknown>;
    if (typeof svc.id !== "string" || !svc.id) throw new Error('Each service needs string "id"');
    if (typeof svc.type !== "string") throw new Error(`Service ${svc.id} needs string "type"`);
    if (typeof svc.environment !== "string")
      throw new Error(`Service ${svc.id} needs string "environment"`);
  }
  return o as unknown as InfrastructureSnapshot;
}

export function parsePolicyJson(text: string): PolicyBundle {
  const data = JSON.parse(text) as unknown;
  if (!data || typeof data !== "object") throw new Error("Policy JSON must be an object");
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.rules)) throw new Error('Missing "rules" array');
  for (const r of o.rules as unknown[]) {
    if (!r || typeof r !== "object") throw new Error("Each rule must be an object");
    const rule = r as Record<string, unknown>;
    if (typeof rule.id !== "string") throw new Error('Rule needs string "id"');
    if (typeof rule.name !== "string") throw new Error(`Rule ${rule.id} needs "name"`);
    if (!Array.isArray(rule.assert)) throw new Error(`Rule ${rule.id} needs "assert" array`);
  }
  return o as unknown as PolicyBundle;
}
