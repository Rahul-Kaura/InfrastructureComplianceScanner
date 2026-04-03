# Infrastructure compliance scanning — system design

## Purpose

This system verifies that infrastructure, represented as a normalized inventory, meets security, cost, and operational policies.

A collector layer gathers data from cloud APIs, infrastructure-as-code (IaC), or Kubernetes and converts it into a standardized snapshot. A policy engine then evaluates rules against that snapshot and produces violations. These violations can be surfaced in a UI, used to fail CI/CD pipelines, or trigger ticketing workflows.

The design below is written to make the trade-offs explicit: what we optimized for, what we deferred, and what alternatives existed at each layer. That matches how the system would be defended in a design review or interview.

---

## 1. How we define and store compliance policies and rules (in depth)

Policies are organized as versioned bundles of rules.

Each rule includes:

- A stable `id` so violations, tickets, and dashboards can reference the same logical check over time, even if the wording of the name changes.
- A human-readable name and description so operators understand intent without reading implementation code.
- A severity level so routing rules can treat critical findings differently from informational ones (pager vs backlog).
- An optional selector (`appliesTo`) such as resource type or environment, so one bundle can hold both global rules (“every database must encrypt at rest”) and scoped rules (“production databases must have two replicas”).
- A list of assertions that must all hold for the rule to pass for a given service.

Each assertion specifies:

- A field path (dot notation supported) into the normalized service record, keeping the engine ignorant of whether the value originally came from RDS, Azure SQL, or a Terraform attribute.
- An operator (`eq`, `neq`, `gte`, `lte`, `gt`, `lt`, `in`, `notIn`, `matches`, etc.) so the same evaluator handles booleans, numbers, enums, and small domain-specific matchers without one-off code per rule.
- An expected value (where applicable) for machine comparison.
- An optional expectation message used in violation text so humans see “replicaCount >= 2” instead of only a raw JSON delta.

### Storage and lifecycle

Policies are stored as JSON files in this reference implementation. That supports pull-request review, diffs, CODEOWNERS on policy paths, and running the exact same file in CI as in a scheduled scan. In production, the same JSON schema can live in object storage (versioned buckets), a relational or document store (with ACLs per team), or a dedicated policy service that handles approval workflows.

Versioning is non-negotiable for audits: every violation record should be able to answer “which policy bundle hash or semver produced this?” Immutable bundles (content-addressed storage or signed artifacts) are a natural next step.

### Why this rule model

JSON keeps the barrier low: security and platform engineers can author rules without learning Rego or standing up a policy compiler. The cost is expressiveness: cross-resource constraints (“this database’s subnet must not have a default route to an internet gateway”) do not fit a single `ServiceConfig` row. The intended evolution path is to keep JSON for the bulk of simple guardrails and introduce OPA/Rego, CEL, or WASM-backed rules for graph or multi-resource checks, with the collector still feeding the same snapshot or an enriched graph.

---

## 2. Infrastructure data sources and how we access them (in depth)

The system is split deliberately between collection and evaluation. Collectors are allowed to be messy and provider-specific; the engine sees only the snapshot.

### Cloud control planes

Databases, instances, load balancers, and managed services expose attributes relevant to compliance: encryption, backup retention, public accessibility, instance families, tags. Access is typically read-only at organization scale: AWS Config and resource APIs, Azure Resource Graph, GCP Cloud Asset Inventory, often with a central security or platform account assuming into member accounts. Rate limits, pagination, and regional APIs are collector concerns; the engine assumes it receives a coherent list of services.

### Infrastructure as code

Intended state before or after apply is valuable for shift-left: Terraform plan JSON, `terraform show -json`, Helm-rendered manifests, or CDK synth output can be normalized into the same schema as live inventory, so the same rules run in PR checks and in reconciliation jobs. The access pattern is usually repository-based (CI clone + plan) or via a Terraform Cloud / Spacelift API.

### Kubernetes

Workloads, Services, Ingresses, NetworkPolicies, and storage classes map into the same abstraction when policies care about “is this workload exposed?” or “does this PVC use encryption?” Access is via the Kubernetes API from an in-cluster controller (ServiceAccount + RBAC) or from CI with a restricted kubeconfig.

### CMDB or service catalog

Ownership, environment classification, cost center, and on-call rotation rarely live in the cloud API alone. A REST or GraphQL integration enriches or validates snapshot rows (e.g. ensuring `environment` matches the catalog).

### Normalized snapshot

All sources converge on a list of services with at least `id`, `type`, `environment`, and policy-specific fields (backups, encryption, replicas, instance types, etc.). This separation keeps the policy engine portable: swapping AWS for Azure changes collectors and mapping code, not the core evaluator.

---

## 3. How we evaluate rules against infrastructure state (in depth)

The evaluation pipeline is intentional simplicity first, with clear extension points.

1. Ingest the snapshot and policy bundle and validate structure (required fields, types) so failures are explicit parse errors rather than silent skips.
2. For each pair of (service, rule), determine whether `appliesTo` matches. Early exit when it does not, to avoid running assertions on irrelevant resources.
3. For each assertion, resolve the field path from the service object, apply the operator, and compare to the expected value where required.
4. On failure, append a structured violation: rule id and name, service id and optional display name, severity, human-readable reason, and field-level actual vs expected for debugging and automation.
5. Emit an aggregate result: timestamp, counts, pass/fail, and the violation list. The same structure feeds the UI, API, and CLI.

The current implementation runs synchronously in memory in a single process. Complexity is on the order of services × rules × assertions. For inventories up to tens of thousands of resources and hundreds of rules, this is typically CPU-cheap compared to network I/O during collection. When a single snapshot no longer fits memory or scan latency SLOs tighten, the same steps distribute across workers with deterministic merge semantics (union of violations, stable sort by severity and service id).

Error handling at this layer means: invalid JSON or schema violations fail fast with a clear message; unknown operators or malformed rules are rejected at load time where possible; partial evaluation after a bug is avoided by treating rule bundles as atomic for a given run.

---

## 4. How we report and track violations (in depth)

### Interactive UI

Operators paste or edit snapshot and policy JSON and see a session-oriented view of results. The goal is quick triage during development or demos, not a full SIEM replacement.

### API

A stateless HTTP endpoint accepts snapshot and policy payloads and returns the same JSON result model. This supports integration tests, internal portals, and glue code without shelling out to a CLI.

### CLI

Non-zero exit codes when violations exist allow GitHub Actions, GitLab CI, Jenkins, or pre-commit hooks to gate merges or scheduled jobs without custom parsers.

### Historical tracking and deduplication

Production systems should persist each run: run id, timestamp, pass/fail, violation count, hash of the snapshot, hash or version of the policy bundle, and optionally the git SHA of the collector. That enables trend lines (“open critical violations over time”) and diffing (“what changed since yesterday?”). Deduplication for ticketing uses a stable key such as `(ruleId, serviceId)` so the same drift does not open five tickets; resolution workflows can clear the key when the resource is fixed or an exception is granted.

### Integrations

Jira, ServiceNow, PagerDuty, or Slack webhooks sit naturally on top of the structured violation stream. SARIF export is a reasonable addition for security dashboards that already consume static analysis formats.

---

## 5. Scaling to thousands of services across multiple environments (in depth)

### Partitioning and parallelism

Shard snapshots by account, OU, region, or environment. Run N workers, each with a subset of services and the full policy bundle (or a filtered subset of rules per shard), then merge violation lists. Idempotence comes from stable ordering and unique violation keys.

### Rule indexing

Precompute indexes from `appliesTo` to rule ids so a database-shaped service in production is not evaluated against rules that only apply to `compute` in `development`. This cuts evaluations roughly linearly with selectivity.

### Incremental scans

Hash normalized resource records. If a resource’s hash is unchanged since the last run, skip re-evaluating it unless the policy bundle version changed. After a policy update, invalidate caches selectively.

### Streaming and backpressure

Very large inventories benefit from streaming JSON (newline-delimited resources) or chunked uploads into the evaluator so peak memory stays bounded.

### Queue-backed workers

Stateless evaluator containers pulling work from SQS, Google Pub/Sub, or Kafka decouple collection spikes from evaluation throughput and allow horizontal scaling independent of the API tier.

### Realistic bottlenecks

In practice, cloud API rate limits, organizational complexity (thousands of accounts), and data freshness SLAs dominate. The policy engine is rarely the first bottleneck if collection is honest about pagination and retries.

---

## 6. Trade-offs and limitations of this approach (in depth)

### JSON-based assertions

Strength: approachable, diff-friendly, no custom toolchain. Weakness: no first-class notion of relationships between resources, graphs, or IAM policy semantics. Mitigation: evolve toward OPA/Cel for a subset of rules or feed a relationship graph into specialized checks.

### Snapshot-based evaluation

Strength: reproducible runs, easy fixtures for tests, same input replayable after incidents. Weakness: stale data if collection lags; race conditions between deploy and scan. Mitigation: frequent sync, event-driven partial updates, or hybrid live checks for the highest-risk rules.

### Generic service schema

Strength: one engine, many adapters. Weakness: lowest-common-denominator fields; provider-specific edge cases need extensions or tags. Mitigation: version the schema, allow optional typed extensions per cloud, or use embedded JSON blobs for advanced rules.

### Out of scope for the initial version

IAM simulation, secrets detection in repos, deep network path analysis (VPC routing + NACL + SG proofs), and cost forecasting are deliberately excluded. They require different data planes and often different teams; the architecture here does not block adding them as new collectors and rule backends.

---

## 7. Technology choices, rationale, and alternatives not chosen

This section is where infrastructure and systems thinking shows up: each choice has a reason, and each reason implies something we gave up.

### TypeScript and Node.js

Why: one language for the rule engine, HTTP API, and CLI; shared types for snapshot and policy JSON; fast iteration for a small team.

Alternatives considered: Python (excellent for glue and data science teams, weaker if you want one typed model end-to-end in a single repo), Go (great for static binaries and low memory, more ceremony for rapid UI iteration), Rust (maximum performance for huge inventories, higher cost for a take-home scope).

Decision: TypeScript balances velocity, typing, and a single runtime for server and tooling.

### Next.js (React)

Why: App Router gives API routes next to the UI without a separate BFF service; one deployable unit for demos and small deployments.

Alternatives considered: separate Express/Fastify API + Vite SPA (more moving parts and CORS/config), serverless functions only (cold starts and payload limits can hurt large snapshots unless chunked), Remix or SvelteKit (similar consolidation; ecosystem and hiring familiarity often favor Next for full-stack JS shops).

Decision: Next.js keeps the product one repository and one mental model for “where does the scan run.”

### Tailwind CSS

Why: utility-first styling speeds up a distinctive UI without maintaining a large bespoke CSS file.

Alternatives: CSS modules, styled-components, or a component library (MUI/Chakra). Those are fine for larger design systems; Tailwind was chosen for speed and consistency with minimal abstraction.

### Docker

Why: reproducible builds and runs across laptops and CI; the same image can be promoted toward Kubernetes.

Alternatives: Nix, Bazel, or “documented Node version only.” Docker is the lowest-friction common denominator for reviewers cloning the repo.

### Kubernetes and Helm

Why: production patterns—replicas, readiness probes, Services—match how many teams run internal tools. Helm parameterizes image tags, replica counts, and resources per environment.

Alternatives: Nomad or ECS/Fargate (valid; fewer moving parts if the org is not on Kubernetes), plain Docker Compose forever (works until you need rolling deploys and HA). Raw YAML in `k8s/` is included for teams that do not use Helm.

Decision: K8s + Helm signal familiarity with how compliance or platform services are often deployed internally, without requiring this repo to depend on a specific cloud.

### Terraform (example under `examples/terraform`)

Why: shows how real RDS-style resources map to fields the rules care about; demonstrates IaC literacy.

Alternatives: Pulumi, CloudFormation-only samples. Terraform is widely recognized; the example is documentation, not a runtime dependency of the scanner.

### JSON for policies and snapshots

Why: see section 1. Alternatives: YAML (similar trade-offs), Rego bundles (more power, steeper curve), protobuf (great for internal RPC, worse for human PR review).

---

## 8. Alignment with engineering expectations

- Infrastructure and systems thinking: separation of collection vs evaluation, scaling levers, and honest limits (snapshots, JSON rules).
- Reasonable technical decisions: each major technology has a stated alternative and a reason it was not selected for this codebase.
- Clean code and error handling: validation at ingest, structured violations, non-zero CLI exit on failure, explicit API errors on bad input (in the implementation).
- Clear communication: this document is the single place design intent lives; the README stays a short product and stack summary.

---

## 9. Forward-looking questions and product evolution

These are the kinds of updates I would prioritize next; they read as interview-ready “what would you do with more time.”

1. How do we evaluate Terraform plans in pull requests before apply, using the same rules as post-deploy reconciliation, without double-counting resources that exist only in plan?
2. How should exception workflows work (time-bound waivers, approvers, audit trail) without weakening the default deny posture for critical rules?
3. What is the right SLA for snapshot freshness per environment (production hourly vs development daily), and how do we alert when collection falls behind?
4. When should we introduce OPA or CEL for a subset of rules, and how do we keep JSON and advanced rules composable in one bundle?
5. How do we expose compliance posture as metrics (violations by team, by rule, trend over 30 days) for leadership dashboards without leaking resource identifiers?
6. How would multi-tenant SaaS isolation work (per-tenant policy namespaces, encryption at rest for stored runs, row-level security)?
7. What is the incident story when the policy engine has a bug—rollback policy version, replay historical snapshots, or feature-flag individual rules?
8. How do we integrate with AWS Security Hub, Azure Policy insights, or GCP SCC so we do not duplicate findings that already exist natively?
9. Can we generate remediation hints or auto-tickets with direct links to the correct Terraform module or runbook section per rule id?
10. How would we fuzz or property-test the evaluator (random valid snapshots, invariant: no crash, deterministic output for fixed inputs)?

---

This document satisfies the assessment areas: definition and storage of policies, data sources and access, evaluation pipeline, reporting and tracking, multi-environment scale, and trade-offs—with enough depth to stand alone in a repository or submission packet.
