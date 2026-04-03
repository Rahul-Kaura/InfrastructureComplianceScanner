import type { ComplianceRule, PolicyBundle } from "./types";
import { parsePolicyJson } from "./evaluate";

function normalizeBulletLine(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^[-*•]\s+/, "").replace(/^\d+[.)]\s+/, "").trim();
  if (!s) return null;
  if (/^example\s+policies?:?\s*$/i.test(s)) return null;
  if (/^policies?:?\s*$/i.test(s)) return null;
  return s;
}

function mentionsProduction(line: string): boolean {
  return /\bproduction\b/i.test(line) || /\bprod\.?\b/i.test(line);
}

function mentionsDatabase(line: string): boolean {
  return /\bdatabases?\b/i.test(line);
}

function mentionsDevStaging(line: string): boolean {
  return (
    /\bdevelopment\b/i.test(line) ||
    /\bstaging\b/i.test(line) ||
    /\bdev\b/i.test(line) ||
    /dev\s*[/&]\s*staging/i.test(line)
  );
}

function negativePublicAccess(line: string): boolean {
  return (
    /cannot\s+be\s+public/i.test(line) ||
    /must\s+not\s+be\s+public/i.test(line) ||
    /not\s+publicly\s+accessible/i.test(line) ||
    /no\s+public(ly)?\s+access/i.test(line) ||
    /non-?public/i.test(line) ||
    (/must\s+not/i.test(line) && /public/i.test(line))
  );
}

/** Production + (database or replica) + minimum replica count: >= N, ≥ N, or "at least N". */
function parseProductionReplicaMinimum(line: string): number | null {
  const l = line.toLowerCase();
  if (!mentionsProduction(l)) return null;
  const hasDb = mentionsDatabase(l);
  const hasReplica = /\breplicas?\b/.test(l);
  const hasHa = /\bha\b/i.test(line) || /high\s+availability/i.test(l);
  if (!hasReplica && !hasHa) return null;
  if (!hasDb && !hasReplica) return null;

  const ge = line.match(/>=\s*(\d+)|≥\s*(\d+)/);
  if (ge) {
    return parseInt(ge[1] || ge[2] || "0", 10);
  }
  const atLeast = line.match(/\bat\s+least\s+(\d+)\b/i);
  if (atLeast) {
    return parseInt(atLeast[1], 10);
  }
  if (
    hasHa ||
    /\b2\b/.test(line) ||
    /\btwo\b/i.test(line) ||
    /more\s+than\s+one/i.test(line)
  ) {
    return 2;
  }
  return null;
}

function mentionsAutomatedBackups(line: string): boolean {
  return /backup/i.test(line);
}

function mentionsEncryptionAtRest(line: string): boolean {
  return /encryption/i.test(line) && /\bat\s+rest\b/i.test(line);
}

function mentionsCostOptimizedInstances(line: string): boolean {
  return (
    (/cost/i.test(line) && /optimi[sz]ed/i.test(line)) ||
    /burstable/i.test(line) ||
    /cost-?optim/i.test(line)
  );
}

function mentionsInstanceSizing(line: string): boolean {
  return /\binstances?\b/i.test(line) || /\btypes?\b/i.test(line) || /\bclass(es)?\b/i.test(line);
}

function ruleFromLine(line: string, index: number): ComplianceRule | null {
  const l = line.toLowerCase();
  const suffix = `${index}`;

  if (
    mentionsProduction(l) &&
    mentionsDatabase(l) &&
    mentionsAutomatedBackups(l)
  ) {
    return {
      id: `nl-prod-db-backups-${suffix}`,
      name: line.length > 90 ? `${line.slice(0, 87)}…` : line,
      description: line,
      severity: "critical",
      appliesTo: { type: "database", environment: "production" },
      assert: [
        {
          field: "automatedBackups",
          op: "eq",
          value: true,
          expect: "automatedBackups === true",
        },
      ],
    };
  }

  if (mentionsDatabase(l) && mentionsEncryptionAtRest(l)) {
    return {
      id: `nl-db-encryption-${suffix}`,
      name: line.length > 90 ? `${line.slice(0, 87)}…` : line,
      description: line,
      severity: "high",
      appliesTo: { type: "database" },
      assert: [
        {
          field: "encryptionAtRest",
          op: "eq",
          value: true,
          expect: "encryptionAtRest === true",
        },
      ],
    };
  }

  if (mentionsProduction(l) && mentionsDatabase(l) && /public/i.test(l) && negativePublicAccess(line)) {
    return {
      id: `nl-prod-db-no-public-${suffix}`,
      name: line.length > 90 ? `${line.slice(0, 87)}…` : line,
      description: line,
      severity: "critical",
      appliesTo: { type: "database", environment: "production" },
      assert: [
        {
          field: "publiclyAccessible",
          op: "eq",
          value: false,
          expect: "publiclyAccessible === false",
        },
      ],
    };
  }

  const prodReplicaMin = parseProductionReplicaMinimum(line);
  if (prodReplicaMin !== null && (mentionsDatabase(l) || /\breplicas?\b/.test(l))) {
    return {
      id: `nl-prod-db-replicas-${suffix}`,
      name: line.length > 90 ? `${line.slice(0, 87)}…` : line,
      description: line,
      severity: prodReplicaMin >= 2 ? "high" : "low",
      appliesTo: { type: "database", environment: "production" },
      assert: [
        {
          field: "replicaCount",
          op: "gte",
          value: prodReplicaMin,
          expect: `replicaCount >= ${prodReplicaMin}`,
        },
      ],
    };
  }

  if (mentionsDevStaging(l) && mentionsCostOptimizedInstances(line) && mentionsInstanceSizing(line)) {
    return {
      id: `nl-dev-cost-instance-${suffix}`,
      name: line.length > 90 ? `${line.slice(0, 87)}…` : line,
      description: line,
      severity: "medium",
      appliesTo: { environment: ["development", "staging"] },
      assert: [
        {
          field: "instanceType",
          op: "matches",
          value: "costOptimizedInstance",
          expect: "instance type matches t3/t4g/t3a/m6g/r6g/db.t* pattern",
        },
      ],
    };
  }

  return null;
}

/** One policy per non-empty line; lines starting with `-`, `*`, or `1.` are stripped. */
export function parseBulletPolicies(input: string): PolicyBundle {
  const lines = input.split(/\r?\n/);
  const rules: ComplianceRule[] = [];
  const errors: string[] = [];
  let physicalLine = 0;

  for (const raw of lines) {
    physicalLine += 1;
    const line = normalizeBulletLine(raw);
    if (line === null) continue;
    const rule = ruleFromLine(line, rules.length + 1);
    if (rule) {
      rules.push(rule);
    } else {
      const preview = line.length > 100 ? `${line.slice(0, 97)}…` : line;
      errors.push(
        `Line ${physicalLine}: could not interpret "${preview}". Try phrases like production databases, encryption at rest, production replica >= 2 (or >= 0), public access, or dev/staging cost-optimized instances.`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  if (rules.length === 0) {
    throw new Error(
      'No policy lines found. Enter one requirement per line (optional "-" bullets), or paste JSON starting with "{".',
    );
  }

  return { version: "1", rules };
}

/**
 * If the trimmed text starts with `{`, parses as policy JSON; otherwise parses as bullet-list policies.
 */
export function parsePoliciesInput(text: string): PolicyBundle {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return parsePolicyJson(text);
  }
  return parseBulletPolicies(text);
}
