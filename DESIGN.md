# Infrastructure compliance scanning — system design

## Purpose

The system proves that infrastructure (as represented in a normalized inventory) satisfies security, cost, and operational policies. A **collector layer** turns live cloud APIs, IaC, or Kubernetes into a **snapshot**; a **policy engine** evaluates **rules** against that snapshot and produces **violations** that can be shown in a UI, fail a pipeline, or open tickets.

---

## 1. How we define and store compliance policies and rules

**Definition:** Policies are versioned **bundles** of **rules**. Each rule has a stable `id`, human-readable name and description, a **severity**, an optional **selector** (`appliesTo`: resource `type`, `environment`, or lists thereof), and a list of **assertions**. Each assertion names a **field** on a resource (dot paths allowed), an **operator** (`eq`, `neq`, `gte`, `in`, `matches`, etc.), and usually an expected **value** plus an **expect** string used in violation messages.

**Storage:** In this reference implementation, bundles are JSON files (suitable for git review and CI). In production, the same shape can live in object storage (S3/GCS), a database, or a policy service. Immutability per release (hash or version tag) matters so audit can answer “which rule version flagged this?”

**Why JSON rules:** Reviewable in PRs, no bespoke compiler, easy to generate from higher-level tools later (OPA/Rego, CEL, or WASM) for cross-resource or graph constraints the JSON model does not express well.

---

## 2. Infrastructure data sources and how we access them

| Source | What it supplies | Typical access |
|--------|------------------|----------------|
| **Cloud control planes** | RDS/VMs, encryption, backups, network exposure | AWS Config, Resource Groups Tagging API, Azure Resource Graph, GCP Cloud Asset Inventory; org-wide read roles |
| **IaC** | Intended state before or after apply | Terraform plan JSON / `terraform show -json`, Helm/Kustomize rendered YAML, CDK synth output |
| **Kubernetes** | Workloads, storage classes, Services/Ingress | In-cluster controller or CI with kubeconfig; watch or periodic list |
| **CMDB / service catalog** | Owner, environment, cost center | Internal REST/GraphQL |

**Reference demo:** A job (Lambda, CronJob, GitHub Action) is assumed to **normalize** provider-specific records into one **service snapshot** schema (`services[]` with `id`, `type`, `environment`, and policy-relevant fields). That decouples **collection** from **evaluation** and keeps the engine portable.

**Example Terraform** in this repo illustrates how RDS-style attributes map conceptually into snapshot fields (backups, encryption, public access); it is not required at runtime for the engine.

---

## 3. How we evaluate rules against infrastructure state

1. **Ingest** snapshot and policy bundle; validate structure.
2. **Match** each `(service, rule)` pair: skip if `appliesTo` does not match.
3. **Assert** each clause: resolve the field, apply the operator, record failures with actual vs expected text.
4. **Emit** a structured result: timestamps, counts, and a list of violations (rule id/name, service id/name, severity, reason, field-level detail).

The shipped engine is **synchronous and in-memory**; complexity is O(services × rules × assertions), which is acceptable until inventories reach very large single-process limits.

---

## 4. How we report and track violations

- **Interactive:** Web UI shows a scan session and per-violation cards (rule, service, reason).
- **API:** HTTP endpoint accepts snapshot + policies as JSON strings and returns the same result model the CLI uses.
- **Automation:** CLI exits non-zero when violations exist so CI can gate merges or scheduled scans.
- **Tracking over time:** Persist each run (`run_id`, `passed`, violation count, snapshot hash, policy version) to object storage or a warehouse; dedupe tickets with `(ruleId, serviceId)`; optional SARIF or webhook to Jira/ServiceNow for operational workflows not built into this repo.

---

## 5. Scaling to thousands of services across multiple environments

- **Partitioning:** Shard snapshots by account, region, or environment; run workers in parallel; merge violation lists.
- **Indexing:** Pre-index rules by `type` / `environment` to avoid evaluating every rule on every service.
- **Incremental work:** Hash normalized resources; skip unchanged resources between runs.
- **Streaming:** For multi-GB inventories, stream records through the evaluator instead of one monolithic JSON file.
- **Horizontal scale:** Stateless evaluators behind a queue (SQS, Pub/Sub, Kafka); collectors scale independently.

The practical bottleneck is usually **API rate limits and data freshness**, not CPU spent in assertions.

---

## 6. Trade-offs and limitations

| Choice | Benefit | Cost |
|--------|---------|------|
| JSON assertions | Simple, reviewable, fast to ship | Weak for relationships (“DB subnet must not have IGW”) |
| Snapshot vs live query | Reproducible, testable scans | Stale if sync is slow |
| Generic service record | One engine, many adapters | Loses provider nuance unless fields evolve |

**Out of scope for v0:** IAM simulation, secrets detection, full network path analysis, cost forecasting. Those attach as new normalizers, rule types, or external policy engines.

---

## 7. Technology choices in this repository (and why)

- **TypeScript + Node.js:** One language for the rule engine, HTTP API, and CLI; strong typing for policy and snapshot shapes.
- **Next.js (React):** Server routes for `/api/scan` and a client UI without a separate BFF; fits a small demo that still looks like a real product surface.
- **Tailwind CSS:** Fast, consistent styling for the UI (including the moon-chat-inspired layout).
- **Docker:** Same artifact runs locally and in CI; `docker-compose` models how you’d run the web tier beside other services without “works on my machine” drift.
- **Kubernetes + Helm:** Production-style deployment: replicas, probes, Service abstraction, and Helm for values-per-environment (dev/staging/prod images and resources). The raw `k8s/` manifests show the same app without a chart for teams that do not use Helm.
- **Terraform (example only):** Demonstrates how real RDS (or similar) resources relate to the fields compliance rules care about; it is documentation-by-code for the assessment, not a runtime dependency of the scanner.

---

## 8. How to scale this further (future work)

- **Stronger policy language:** OPA/Cel for rules that reference multiple resources or graphs.
- **Continuous collection:** Push-based Config streams or scheduled inventory with SLAs per environment.
- **Governance:** Policy approval workflow, rule ownership, exception/expiry with audit trail.
- **Observability:** Metrics (violations by rule/team), tracing from collector to evaluator, SLOs on scan latency.
- **Multi-tenant SaaS:** Namespace policies and snapshots per org; row-level security in persistence.
- **IaC-first gates:** Run engine on `terraform plan` JSON in PRs before apply, in addition to post-deploy reconciliation.

This document and the code together satisfy the design deliverable: defined formats, data paths, evaluation, reporting, scale posture, trade-offs, and rationale for the stack used in the implementation.
