/**
 * Ready-made policy texts for the default inventory (`examples/infrastructure/sample.json`).
 * Violation presets are one bullet each; clean presets use JSON rules the sample data satisfies
 * (or selectors that match no services).
 */

export interface ScanPreset {
  id: string;
  /** Short label for UI chips */
  label: string;
  /** One-line hint shown in title attribute */
  hint: string;
  outcome: "violations" | "clean" | "mixed";
  policies: string;
}

/** Single-policy bullets that each fail at least one service in the sample snapshot. */
const VIOLATION_PRESETS: ScanPreset[] = [
  {
    id: "v-prod-backups",
    label: "Prod backups",
    hint: "Fails rds-prod-audit (automatedBackups off)",
    outcome: "violations",
    policies:
      "- All production databases must have automated backups enabled",
  },
  {
    id: "v-encryption",
    label: "Encryption at rest",
    hint: "Fails rds-staging-analytics (encryption off)",
    outcome: "violations",
    policies: "- All databases must use encryption at rest",
  },
  {
    id: "v-no-public-prod",
    label: "No public prod DBs",
    hint: "Fails rds-prod-audit (publicly accessible)",
    outcome: "violations",
    policies: "- Production databases cannot be publicly accessible",
  },
  {
    id: "v-prod-ha",
    label: "Prod HA replicas",
    hint: "Fails rds-prod-audit (replicaCount < 2)",
    outcome: "violations",
    policies:
      "- Production databases must have at least 2 replicas for high availability",
  },
  {
    id: "v-dev-cost",
    label: "Dev/staging cost class",
    hint: "Fails rds-dev-sandbox (db.r5.large not cost-optimized pattern)",
    outcome: "violations",
    policies:
      "- Dev/staging environments must use cost-optimized instance types",
  },
];

/** Five failing bullets plus one that passes on every production DB (replica ≥ 0). */
const MIXED_PRESETS: ScanPreset[] = [
  {
    id: "mix-five-plus-pass",
    label: "5 fail + 1 pass",
    hint: "Same five violation rules plus production replica ≥ 0 (green on rds-prod-orders & rds-prod-audit)",
    outcome: "mixed",
    policies: `- All production databases must have automated backups enabled
- All databases must use encryption at rest
- Production databases cannot be publicly accessible
- Production databases must have at least 2 replicas for high availability
- Dev/staging environments must use cost-optimized instance types
- Production replica >= 0`,
  },
];

/** JSON bundles that produce zero violations against the sample snapshot. */
const CLEAN_PRESETS: ScanPreset[] = [
  {
    id: "c-replica-gte-0",
    label: "Replicas ≥ 0",
    hint: "Every DB in the sample has replicaCount ≥ 0",
    outcome: "clean",
    policies: `{
  "version": "1",
  "rules": [
    {
      "id": "db-replica-non-negative",
      "name": "Database replica count is non-negative",
      "description": "Replica count must be zero or more.",
      "severity": "low",
      "category": "operational",
      "appliesTo": { "type": "database" },
      "assert": [
        {
          "field": "replicaCount",
          "op": "gte",
          "value": 0,
          "expect": ">= 0"
        }
      ]
    }
  ]
}`,
  },
  {
    id: "c-dev-compute-private",
    label: "Dev compute private",
    hint: "Only ec2-dev-batch matches; publiclyAccessible is false",
    outcome: "clean",
    policies: `{
  "version": "1",
  "rules": [
    {
      "id": "dev-compute-not-public",
      "name": "Development compute must not be public",
      "description": "Dev compute instances stay off the public internet.",
      "severity": "medium",
      "category": "security",
      "appliesTo": { "type": "compute", "environment": "development" },
      "assert": [
        {
          "field": "publiclyAccessible",
          "op": "eq",
          "value": false,
          "expect": "publiclyAccessible === false"
        }
      ]
    }
  ]
}`,
  },
  {
    id: "c-no-lambda",
    label: "Lambda runtime (no matches)",
    hint: "Selector type lambda matches nothing — zero violations",
    outcome: "clean",
    policies: `{
  "version": "1",
  "rules": [
    {
      "id": "lambda-runtime",
      "name": "Lambda runtime present",
      "description": "Serverless functions must declare a supported runtime (inventory has no lambdas).",
      "severity": "low",
      "category": "operational",
      "appliesTo": { "type": "lambda" },
      "assert": [
        {
          "field": "runtime",
          "op": "in",
          "value": ["nodejs20", "python3.12"],
          "expect": "runtime in allowed list"
        }
      ]
    }
  ]
}`,
  },
];

export const SCAN_PRESETS: ScanPreset[] = [
  ...VIOLATION_PRESETS,
  ...MIXED_PRESETS,
  ...CLEAN_PRESETS,
];

export const SCAN_PRESETS_VIOLATIONS = VIOLATION_PRESETS;
export const SCAN_PRESETS_MIXED = MIXED_PRESETS;
export const SCAN_PRESETS_CLEAN = CLEAN_PRESETS;
