import type { Violation } from "./types";

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    automatedBackups: "Automated backups",
    encryptionAtRest: "Encryption at rest",
    publiclyAccessible: "Public accessibility",
    replicaCount: "Read replica count",
    instanceType: "Instance type",
  };
  return labels[field] ?? field.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();
}

function fmt(v: unknown): string {
  if (v === undefined || v === null) return "not set";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string") return v || "(empty)";
  return JSON.stringify(v);
}

/** Human-readable explanation of why the check failed (replaces raw field/actual/expected lines). */
export function violationSummaryPlain(v: Violation): string {
  if (!v.field) {
    return v.reason || "This requirement was not met for the listed service.";
  }

  const label = fieldLabel(v.field);
  const a = v.actual;

  switch (v.field) {
    case "automatedBackups":
      if (a === false) {
        return `${label} are turned off for this service, but the policy requires them to be on. This check did not pass.`;
      }
      if (a === true) {
        return `${label} are on, but the policy expected a different setting. This check did not pass.`;
      }
      return `${label} are ${fmt(a)}; the policy requires automated backups to be enabled. This check did not pass.`;

    case "encryptionAtRest":
      if (a === false) {
        return `${label} is disabled on this database, but the policy requires it to be enabled. This check did not pass.`;
      }
      return `${label} is ${fmt(a)}; the policy requires encryption at rest to be on. This check did not pass.`;

    case "publiclyAccessible":
      if (a === true) {
        return `This database is publicly accessible, but the policy requires it to be private (not reachable from the public internet). This check did not pass.`;
      }
      if (a === false) {
        return `Public accessibility is off, but the policy expected a different value. This check did not pass.`;
      }
      return `${label} is ${fmt(a)}; the policy requires this database not to be publicly accessible. This check did not pass.`;

    case "replicaCount":
      return `${label} is ${fmt(a)}, which does not satisfy what this policy expects (${v.expected ?? "minimum replica count"}). This check did not pass.`;

    case "instanceType":
      return `${label} is ${fmt(a)}, which is not in the cost-optimized families this policy allows for dev/staging. This check did not pass.`;

    default:
      return `For ${label}, the live value is ${fmt(a)}, but the policy requires something different (${v.expected ?? "see rule"}). This check did not pass.`;
  }
}
