/** Declared state for a single deployable (DB, compute, etc.) */
export type ServiceType = "database" | "compute" | "cache" | "storage" | string;

export type Environment = "production" | "staging" | "development" | string;

/** Grouping for policies and scan results: security posture, cost controls, operational resilience. */
export type PolicyCategory = "security" | "cost" | "operational";

export interface ServiceConfig {
  id: string;
  name?: string;
  type: ServiceType;
  environment: Environment;
  /** RDS-style flags */
  automatedBackups?: boolean;
  encryptionAtRest?: boolean;
  publiclyAccessible?: boolean;
  replicaCount?: number;
  /** e.g. db.t3.micro, m5.large */
  instanceType?: string;
  /** arbitrary tags for future rules */
  tags?: Record<string, string>;
  [key: string]: unknown;
}

export interface InfrastructureSnapshot {
  version?: string;
  generatedAt?: string;
  services: ServiceConfig[];
}

export type Operator =
  | "eq"
  | "neq"
  | "gte"
  | "lte"
  | "gt"
  | "lt"
  | "in"
  | "notIn"
  | "matches";

export interface Assertion {
  /** Dot path into service object, e.g. "automatedBackups" */
  field: string;
  op: Operator;
  value?: unknown;
  /** Human-readable expectation for violation messages */
  expect?: string;
}

export interface RuleSelector {
  type?: ServiceType | ServiceType[];
  environment?: Environment | Environment[];
}

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
  /** If omitted, inferred from rule id/name when parsing JSON */
  category?: PolicyCategory;
  /** Optional remediation steps; violations fall back to field-based defaults */
  remediation?: string;
  /** If omitted, rule applies to every service */
  appliesTo?: RuleSelector;
  /** All must pass */
  assert: Assertion[];
}

export interface PolicyBundle {
  version?: string;
  rules: ComplianceRule[];
}

export interface Violation {
  ruleId: string;
  ruleName: string;
  severity: ComplianceRule["severity"];
  category: PolicyCategory;
  serviceId: string;
  serviceName?: string;
  reason: string;
  field?: string;
  actual?: unknown;
  expected?: string;
  recommendation: string;
}

/** Rule applied to this service and every assertion succeeded. */
export interface PassedCheck {
  ruleId: string;
  ruleName: string;
  severity: ComplianceRule["severity"];
  category: PolicyCategory;
  serviceId: string;
  serviceName?: string;
}

export interface ScanResult {
  scannedAt: string;
  serviceCount: number;
  ruleCount: number;
  violations: Violation[];
  /** One entry per (service, rule) where the rule applied and produced zero violations. */
  passes: PassedCheck[];
  passed: boolean;
}
