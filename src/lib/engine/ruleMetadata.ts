import type { ComplianceRule, PolicyCategory } from "./types";

export const POLICY_CATEGORY_ORDER: PolicyCategory[] = ["security", "cost", "operational"];

/** Resolve category from rule JSON or infer from id/name. */
export function resolvePolicyCategory(
  rule: Pick<ComplianceRule, "id" | "name" | "category">,
): PolicyCategory {
  const c = rule.category;
  if (c === "security" || c === "cost" || c === "operational") return c;

  const id = rule.id.toLowerCase();
  const name = rule.name.toLowerCase();

  if (
    id.includes("cost") ||
    name.includes("cost optim") ||
    name.includes("cost-optim") ||
    name.includes("burstable") ||
    (name.includes("instance") && (name.includes("smaller") || name.includes("dev/staging")))
  ) {
    return "cost";
  }

  if (
    name.includes("encrypt") ||
    name.includes("public") ||
    name.includes("publicly") ||
    id.includes("encrypt") ||
    id.includes("public")
  ) {
    return "security";
  }

  if (
    name.includes("backup") ||
    name.includes("replica") ||
    name.includes("availability") ||
    name.includes("ha ") ||
    id.includes("backup") ||
    id.includes("replica") ||
    id.includes("ha")
  ) {
    return "operational";
  }

  return "operational";
}

/** Steps to remediate when a specific field check fails (unless rule.remediation is set). */
export function defaultRecommendationForField(field: string | undefined): string {
  switch (field) {
    case "automatedBackups":
      return "In your cloud console or IaC, enable automated backups (and a retention window / PITR if applicable) for this database. Apply the change, wait for it to take effect, then refresh the infrastructure snapshot and re-scan.";
    case "encryptionAtRest":
      return "Enable encryption at rest for this database (or migrate to an encrypted instance). Update Terraform/CloudFormation or the console, then re-import the snapshot so encrypted=true is reflected.";
    case "publiclyAccessible":
      return "Disable public accessibility; place the database in private subnets and restrict security groups / firewall rules to trusted networks (VPN, bastion, or application tier only). Update IaC or console settings and re-scan.";
    case "replicaCount":
      return "Add read replicas or increase replica count to meet the policy (RDS Multi-AZ / cluster readers / equivalent). Roll out via your standard change process, verify replicaCount in inventory, then re-scan.";
    case "instanceType":
      return "Change the instance class to one that matches the policy (e.g. burstable t3/t4g families for non-prod cost rules). Resize in the provider or IaC, confirm the new instanceType in snapshot, then re-scan.";
    default:
      return "Adjust this service’s configuration so the field meets the expected value in your cloud provider or IaC, verify in inventory, and run the scan again.";
  }
}

export function resolveRecommendation(rule: ComplianceRule, field: string | undefined): string {
  if (rule.remediation?.trim()) return rule.remediation.trim();
  return defaultRecommendationForField(field);
}
