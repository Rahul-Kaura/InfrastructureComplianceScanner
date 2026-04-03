Here's the full document humanized, nothing cut:

---

# Infrastructure Compliance Scanner — Design & Implementation

**Live:** https://infrastructurecompliancescannermain.onrender.com/

## What I Built

A policy evaluation service that compares an infrastructure snapshot (a normalized inventory of services) against a bundle of compliance rules and outputs a structured list of violations — each with the service, rule, severity, a human-readable reason, and field-level actual vs. expected values.

Results are available through:

- Web UI: `src/app/page.tsx`
- API: `src/app/api/scan/route.ts` (`POST /api/scan`)
- CLI: `scripts/scan-cli.ts`
- Shared rule engine: `src/lib/engine/`

One engine powers all three. That's intentional — it's the only way to guarantee consistent results across interfaces.

---

## 1) How We Define and Store Compliance Policies

### Rule Model

Policies are versioned JSON bundles containing a list of rules. Each rule has:

- `id`: stable identifier for tracking, dashboards, ticket deduplication, and audits
- `name` / `description`: operator-facing meaning
- `severity`: `critical | high | medium | low`
- `appliesTo` (optional): scopes the rule by `type` and/or `environment`
- `assert`: list of assertions; a rule passes only if all assertions pass

Each assertion specifies:

- `field`: dot-path into the normalized service record (e.g., `encryptionAtRest`, `tags.team`)
- `op`: `eq`, `neq`, `gte`, `lte`, `gt`, `lt`, `in`, `notIn`, `matches`
- `value`: expected comparison input for most operators
- `expect` (optional): message for clearer violation output

### Storage and Lifecycle

In the repo, policy bundles are JSON files (example: `examples/policies/sample.json`, plus whatever a user submits via UI or API). In production, the same bundle format works in object storage with versioned artifacts, a policy service database with approval workflows, or signed/immutable artifacts for stronger audit guarantees.

Versioning matters here: every scan run should be traceable to a specific policy bundle version.

---

## 2) Infrastructure Data Sources and How We Access Them

### The Snapshot as Interface Contract

The policy engine doesn't talk to AWS, Azure, or GCP directly. All upstream systems get normalized into one snapshot schema: a `services[]` list where each service has at least `id`, `type`, `environment`, plus policy-relevant fields like backups, encryption, public access, replicas, instance type, and tags.

This decoupling lets collectors be provider-specific while evaluation stays portable. Swap out AWS for Azure and the engine doesn't notice.

### Typical Sources

Collectors handle pagination, retries, throttling, and normalization. The engine just gets a clean list. Typical sources:

- Cloud control planes: database config, encryption settings, public exposure details
- IaC outputs: Terraform plan or rendered manifests for shift-left checks in CI
- Kubernetes API: workload exposure, storage encryption settings
- CMDB or service catalog: ownership, environment classification, cost center

---

## 3) How We Evaluate Rules Against Infrastructure State

Evaluation is deterministic, synchronous, and side-effect free:

1. Parse and validate the snapshot and policy bundle — fail fast with clear errors, no silent skips
2. For every (service, rule) pair: apply `appliesTo` filtering, then evaluate each assertion via field resolution and operator logic
3. For each failed assertion, emit a Violation containing `ruleId`, `ruleName`, `severity`, `serviceId`, optional `serviceName`, `reason`, and `field` / `actual` / `expected`
4. Aggregate into a `ScanResult` with `passed` and counts

Why this structure works well in a design review: it's easy to explain, outputs are trustworthy because inputs are plain JSON, and adding new operators or matchers doesn't require rethinking the pipeline.

---

## 4) How We Report and Track Violations

### Reporting Channels

- UI: results panel with a summary and per-violation cards
- API: returns the same structured `ScanResult` JSON
- CLI: prints JSON and exits non-zero when violations exist (CI-friendly)

### What to Persist

For operational usefulness and governance, each run should store: run id, timestamp, violation counts with severity breakdown, snapshot hash, policy bundle version, and a stable deduplication key like `(ruleId, serviceId)` for ticketing. That last one matters — without it, the same drift opens five tickets.

### Change Observability

Pass/fail is necessary but not sufficient. In large organizations, the real question is "why did posture change?" — and that's harder to answer than it sounds. Change observability ties compliance outcomes to:

- Snapshot diffs: which resources appeared, disappeared, or changed material fields
- Policy lineage: which policy version and rules were active during a given run
- Change metadata: deploy id, pipeline run, change ticket, service owner from CMDB

This is what lets you build a defensible risk narrative. Leadership can see whether a violation spike came from infrastructure drift or a policy tightening. Engineering managers can tell whether their team caused new criticals or inherited them from a central policy change. Without this layer, teams spend a lot of time arguing over the wrong thing.

---

## 5) Scaling to Thousands of Services

The engine is rarely the bottleneck. Collection — API throttling, pagination, data freshness SLAs — is where you usually hit problems first. That said, the evaluation layer needs to scale too:

- Shard by account, region, or environment and run parallel workers per shard, then merge
- Index rules by `type` / `environment` so you don't evaluate every rule against every service
- Hash normalized resource records and skip unchanged services on incremental runs (unless the policy bundle version changed)
- Stream or chunk large inventories so peak memory stays bounded
- Keep the API layer stateless, enqueue evaluation jobs, and scale workers independently

---

## 6) Trade-offs and Limitations

### JSON-Based Declarative Rules

Good: reviewable, diff-friendly, no arbitrary code execution. Bad: cross-resource relationships and graph checks are awkward in a flat assertion model. Path forward: specialized rule backends (OPA, CEL, WASM) with a common violation output schema.

### Snapshot-Based Evaluation

Good: reproducible and testable — the same inputs always produce the same verdict. Bad: can be stale if collectors lag behind real-world changes. Path forward: higher collection frequency for critical resources, event-driven partial snapshot updates.

### Generic Service Schema

Good: one engine, many collectors. Bad: provider-specific nuance sometimes doesn't fit a flat schema. Path forward: schema versioning plus typed extensions for cloud-specific fields.

---

## 7) Technologies Used

### TypeScript + Node.js

Implements the rule engine, API route logic, and CLI. One language for everything means shared types across the engine, UI, API, and CLI — which catches a surprising number of bugs before runtime. Python, Go, and Rust are all valid; they'd add either type duplication or more overhead for a full-stack demo.

### Next.js (App Router, React)

Renders the web UI and hosts the API route in the same app (`/api/scan`). One repo, one deployment artifact. A separate Express/Fastify + SPA setup works but adds CORS config, separate deployments, and integration complexity that isn't worth it at this scope.

### Tailwind CSS

Handles UI styling — panels, badges, layout. Fast to work with and consistent without a large bespoke design system. CSS modules, styled-components, and component libraries like MUI or Chakra are all fine; Tailwind just reduced time-to-polish.

### Docker

Packages the app into a consistent runnable artifact. Same image runs locally, in CI, and in cluster environments. Avoids the "install Node 20 on the server" runbook problem. Nix and Bazel offer stronger reproducibility guarantees but are heavier for a take-home scope.

### Docker Compose

Local orchestration only — one command to build and run the service. Good for onboarding and demos. Dev containers or plain `npm start` work too; Compose is the most recognizable path for reviewers.

### Kubernetes + Helm

Shows how to run the scanner as a real workload: K8s Deployment and Service with a readiness probe, and a Helm chart to parameterize values per environment. ECS/Fargate and Cloud Run are lower-ops alternatives and are worth choosing if the org is serverless-first. K8s and Helm were chosen here because they make HA patterns explicit and match what most platform teams already run.

### Terraform (Example Only)

Demonstrates how real IaC fields (RDS-style settings) map to snapshot attributes that policies check. Nothing in the scanner runtime calls Terraform. Pulumi and CloudFormation-only samples are valid alternatives; Terraform is widely recognized and the mapping to demo rule fields is easy to follow.

### Render Blueprint (`render.yaml`)

Hosts the web service so demos don't require localhost. The blueprint keeps deployment config versioned alongside the code, which is better than manual dashboard setup and lower friction than most other PaaS IaC options.

---

## 8) What's Next

### Scalability Beyond the Demo

Split the system into an API tier and a worker tier connected by a queue. Add indexing, caching, and incremental evaluation. Persist runs and snapshot diffs so trend reporting doesn't require a custom query every time.

### LLM Integration (Policy Authoring, Not Verdicts)

The next iteration adds an LLM-assisted workflow: users describe policies in plain language, and the system generates rule JSON that conforms to the schema. The guardrails matter here — strict schema validation to reject invalid outputs, prompt and output logging for audit, and human review with a PR workflow before any policy goes live. The LLM suggests; the evaluator decides. That distinction has to be architecturally enforced, not just documented.

### MCP Integration

MCP lets assistants and internal tools pull structured context through controlled, audited interfaces instead of ad-hoc API calls or pasting credentials into chat. Future read-only MCP tools could include: fetch last scan summary for an environment, list open critical violations for a team, retrieve policy text for a rule id. Every call needs authZ and audit logging. Sensitive resource identifiers shouldn't be exposed to unauthorized callers.

### Why This Matters for the Business

Compliance scanning is usually framed as an engineering concern, but the value shows up elsewhere. Engineering catches drift earlier and spends less time on incident-driven firefighting. Security and GRC get structured evidence and can explain risk changes rather than presenting static spreadsheets. Leadership gets trend data, concentration analysis, and visibility into whether exception grants are actually working.

Change observability is what ties all of that together. It answers "what changed and why" so policy enforcement is defensible — not just a list of things that are currently broken.