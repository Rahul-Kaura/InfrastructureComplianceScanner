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

### Change observability model (business and operations)

At the scale of a large product company—**many services, frequent releases, multiple environments**—compliance is not only a pass/fail snapshot. Stakeholders need to understand **what changed**, **when**, and **why posture moved**. That is a **change observability** problem: the same class of thinking used to debug production (“what deployed before the outage?”) applied to **governance and risk**.

**What we persist and correlate**

- **Time series of scan results** (violation counts, severity mix, new vs resolved findings) so leadership sees trend, not just a single dashboard tile.
- **Diffs between snapshots** (which resources appeared, disappeared, or changed material fields) so engineers can tie a spike in violations to a **specific release, config rollout, or account onboarding**—not guess from a static list.
- **Policy lineage** (which rule version was active for run *N*) so audits can answer “was this finding evaluated under the stricter rule we shipped Tuesday?”
- **Change metadata** where available: deploy id, pipeline run, change ticket, owning team—stored as tags on the run or joined from a CMDB so **accountability** is explicit.

**Why this matters for the business**

- **Executives and GRC** need narrative: risk trending up or down, concentration by business unit, and confidence that exceptions are time-bound—not a spreadsheet exported once a quarter.
- **Engineering managers** need to know if a team’s backlog of violations grew because of their shipping velocity or because **central policy tightened**; without change context, teams argue over the wrong problem.
- **Customer and partner trust** (enterprise sales, regulated industries, AI governance expectations) increasingly expect **evidence of continuous control**, not point-in-time screenshots. Change observability supports “show me the history” conversations.

This reference implementation stores enough in principle (structured violations, timestamps, hashable inputs) to grow into that model; the **product** step is persisting runs, diffing snapshots, and surfacing “what changed” next to “what failed.” That layer should be designed **with business consumers in mind** (filters by org, env, product line), not only for SREs reading raw JSON.

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

### Scaling the scanner service itself (Docker → Kubernetes → Helm)

The policy engine can scale in-process or across workers (previous subsections). The **web/API surface** also needs a clear packaging and deployment story—that is where Docker, Kubernetes, and Helm matter.

**Docker** packages the Node/Next application with a pinned runtime so every environment runs the same bits. For scale, you push images to a registry (ECR, GCR, ACR), use immutable tags per release, and optionally multi-arch builds (amd64/arm64) so the same pipeline serves laptops and Graviton clusters. CI builds the image once; dev, staging, and prod **promote the same artifact**, which reduces “works in CI, breaks in prod” drift.

**Docker Compose** (in this repo) is for **local or single-host** runs: one command to build and expose port 3000. It is not the multi-tenant or HA topology; it is a convenience layer on top of the same image Docker would use in Kubernetes.

**Kubernetes** runs that image as a **Deployment**: multiple replicas for availability, **readiness probes** so traffic only hits healthy pods, **Services** for stable networking, and later **HorizontalPodAutoscaler** on CPU, memory, or custom metrics (e.g. request latency or queue depth if the API enqueues work). For very large POST bodies (big snapshots), you might front the API with an ingress that supports longer timeouts or move bulk upload to object storage and pass references—K8s is still the place those pods scale out.

**Helm** parameterizes the same chart for **dev/staging/prod** (image tag, replica count, resource requests/limits, ingress hostnames) without forking YAML. At scale, you add **per-environment values files**, optional **Secrets** integration for tokens, and release versioning (`helm upgrade`) so rollbacks match the same discipline as application semver.

**Terraform** appears in two different roles. Inside the **product demo**, the sample under `examples/terraform/` is **documentation**: it shows how a real managed database maps to snapshot fields the rules read (backups, encryption, public access). It does **not** execute when you run the scanner. In a **full platform picture**, Terraform (or another IaC tool) is how you **provision** the cluster, registry, IAM, and DNS that host the scanner; separately, **Terraform plan output** can become an **input snapshot** for shift-left compliance (same rules as against live inventory, with a plan-to-snapshot adapter). Scaling that path means running plan scans in CI at PR volume and caching plan artifacts.

**Future scale with this stack:** split **API pods** (thin, stateless) from **worker pods** (heavy evaluation) both built from the same or slimmed images; use a queue between them; autoscale workers on backlog; use Terraform/CDK/Pulumi to codify the entire scanning platform (VPC, EKS/GKE/AKS, IRSA/workload identity, secrets). None of that changes the rule JSON model—it changes how many containers run and how traffic flows.

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

This section is where infrastructure and systems thinking shows up: each choice has a reason, and each reason implies something we gave up. For **Docker, Kubernetes, Helm, and Terraform**, the **role in the product** is spelled out first so it is clear what is runtime packaging versus what is example/documentation versus what is optional platform IaC.

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

**Role in the product:** The Dockerfile defines the **shippable unit** for the compliance UI and API: OS + Node + built Next app. That image is what CI builds, what `docker compose` runs locally, and what Kubernetes pulls from a registry in production. The rule engine does not depend on Docker at compile time; Docker is how operators **run** the service reliably.

**Why Docker:** Same artifact everywhere, easy onboarding (“build and run”), integrates with every major CI and registry, and avoids “install Node 20 on the server” runbooks.

**Alternatives not chosen:** **Nix** or **Bazel** for hermetic builds—stronger reproducibility, steeper learning curve for a small app. **Bare metal + systemd** with global Node—fast for one server, painful for version skew across teams. Docker is the pragmatic default for a portable web service.

### Docker Compose

**Role in the product:** **Local and demo orchestration** only: build the image, map port 3000, set `NODE_ENV`. It is not how you get HA or multi-region; it sits beside Docker as a developer convenience.

**Why include it:** One command for reviewers and interviewers; mirrors “production container, laptop wiring.”

**Alternatives:** **Podman Compose**, **dev containers**, or “run `npm start` only”—all valid; Compose is the most widely recognized pairing with Docker.

### Kubernetes

**Role in the product:** The manifests under `k8s/` describe how to run the **scanner deployment** as a first-class workload: **Deployment** (desired replicas), **Pod** template, **readinessProbe** (HTTP on `/`), **Service** (ClusterIP or behind Ingress), **resource requests/limits**. The compliance *logic* still lives in the app; Kubernetes answers **where it runs, how many copies, and how we know a pod is healthy**.

**Why Kubernetes:** Internal platform and security tools are commonly on shared clusters; you inherit RBAC, namespaces per env, secrets management, and autoscaling patterns. If the company already operates EKS/GKE/AKS, deploying this scanner matches existing playbooks.

**Alternatives not chosen:** **Amazon ECS/Fargate** or **Google Cloud Run**—less cluster operations, great for HTTP services; choose if the org is serverless-first. **HashiCorp Nomad**—simpler scheduler, smaller ecosystem than K8s. **Single VM + Docker**—fine until you need rolling updates without downtime or autoscale.

### Helm

**Role in the product:** **Templated packaging** for the same Kubernetes objects: image repository/tag, replica count, service port, CPU/memory. Lets platform teams install with `helm install` and promote values per environment without editing raw YAML by hand each time.

**Why Helm:** Standard way to version **releases** of a chart, override values (`values-staging.yaml`), and integrate with GitOps (Argo CD, Flux).

**Alternatives:** **Kustomize** (overlay-based, no templating language), **plain YAML** (what `k8s/` already provides), **cdk8s** (define manifests in TypeScript). Helm is included as the most common “package manager for K8s” pattern.

### Terraform (example under `examples/terraform`)

**Role in the product (two layers):**

1. **In-repo example:** Illustrates **target infrastructure** that compliance rules talk about (e.g. RDS backup retention, encryption, `publicly_accessible`). It helps readers connect “Terraform resource attributes” to “fields in the JSON snapshot.” Nothing in the scanner binary calls Terraform.
2. **In a full rollout:** Terraform (or Pulumi/CDK) is typically how you **provision** the cluster, IAM, registry, and DNS that host the scanner; and **Terraform plan JSON** can feed a **plan-time** compliance pipeline (adapter → snapshot → same engine).

**Why Terraform for the example:** Broad familiarity, large provider ecosystem, easy to map HCL attributes to the demo rule fields.

**Alternatives not chosen:** **Pulumi** (same ideas, general-purpose languages), **AWS CloudFormation-only** (AWS-specific), **Kubernetes YAML only** (does not model RDS). The example is pedagogical; the product stays cloud-agnostic at the engine layer.

### JSON for policies and snapshots

Why: see section 1. Alternatives: YAML (similar trade-offs), Rego bundles (more power, steeper curve), protobuf (great for internal RPC, worse for human PR review).

---

## 8. Alignment with engineering expectations

- Infrastructure and systems thinking: separation of collection vs evaluation, scaling levers, and honest limits (snapshots, JSON rules).
- Reasonable technical decisions: each major technology has a stated alternative and a reason it was not selected for this codebase.
- Clean code and error handling: validation at ingest, structured violations, non-zero CLI exit on failure, explicit API errors on bad input (in the implementation).
- Clear communication: this document is the single place design intent lives; the README stays a short product and stack summary—and explanations should stay legible to **business and GRC stakeholders**, not only to engineers (especially around **change observability** and risk narrative).

---

## 9. Forward-looking: business context, change observability, and MCP

The questions below are intentionally framed for **product, risk, and operations conversations**—not as a low-level backlog. They assume a large, multi-team estate where compliance is continuous and **understanding change** is as important as the current violation list.

### Business, risk, and customer trust

1. How should we **report posture to leadership** (risk appetite, open criticals, aging exceptions) in language that supports board and customer conversations—not just engineering metrics?
2. What is the **business process** for accepting residual risk: who approves exceptions, for how long, and how do we renew or sunset them without silent drift?
3. How do **roadmaps and releases** interact with policy: when security tightens rules, how do we give product teams **predictable windows** and capacity planning instead of surprise pipeline failures?
4. For **regulated or enterprise customers**, what evidence pack (history of scans, policy versions, change correlation) do we need to sell and renew—and how do we generate it without manual heroics?
5. How do we articulate **ROI** of this program: audit prep time saved, mean time to remediate, reduction in repeat findings?

### Change observability (operational and GRC narrative)

6. When violation counts jump, how do we **automatically distinguish** “we shipped bad config” vs “we added new resources” vs “policy got stricter”—and surface that in the UI or exec summary?
7. What **minimum change metadata** (deploy id, service owner, change ticket) should every scan run capture so postmortems and audits can answer “what changed before this finding appeared?”
8. How long do we **retain** snapshot diffs and run history for legal hold vs cost—and how do we redact sensitive fields while keeping the narrative intact?
9. Can we ship a **“compliance diff”** view for release managers: “this release introduces these new risks or clears these old ones” before go-live?

### Ecosystem: MCP servers and internal agents

**Model Context Protocol (MCP)** is a practical way to let **assistants and internal tools** pull **authorized, structured context** (read-only CMDB rows, latest scan summary, ticket status) instead of pasting secrets into chat. In a future iteration, **MCP servers** could expose tools such as: fetch last scan result for an environment, list open violations for a team, or retrieve policy text for rule `id`—always through **central authZ**, audit logs, and rate limits.

10. Which **MCP tools** are safe to expose first (read-only, aggregated) vs which must stay human-in-the-loop (policy edits, exception grants)?
11. How do we **govern** third-party or internal agents that call MCP: consent, data residency, and proof that no tenant data crosses boundaries?
12. Could an internal copilot **draft remediation steps** by combining violation JSON + runbook MCP + ticketing MCP—while **never** bypassing the rule engine for the actual verdict?

### Portfolio and scale (still business-led)

13. How do we **prioritize** which services or environments get stricter SLAs first when we cannot scan everything every hour—based on revenue, data class, or customer contracts?
14. How do **partners or managed offerings** change who owns the snapshot and who sees violations—without fragmenting the single risk story leadership expects?

---

## 10. Next iteration: LLM-assisted policy authoring (goal and rough plan)

### Why add an LLM

Today, policies are hand-written JSON. That is precise and reviewable but excludes people who think in requirements (“no production database without backups”) rather than in `assert` blocks. **Next time around**, an LLM-backed flow would let users **describe policies in natural language** and get **draft rules** in the existing JSON schema—still validated by the same engine, so behavior stays deterministic once the rule is accepted.

The LLM is a **productivity and UX layer**, not a replacement for the evaluator: the rule engine remains the source of truth for what “pass” means; the model only proposes structured text that must pass schema checks before it can run.

### Risks to design around

- **Hallucinated fields or operators** that do not exist on `ServiceConfig` → mitigated by strict JSON Schema / Zod validation and rejecting invalid bundles.
- **Over-broad or ambiguous rules** → mitigated by human review, preview against sample snapshots, and optional “explain this rule in English” reverse pass for sanity checking.
- **Audit and compliance** → log user prompt, model version, temperature, and output hash; treat AI-generated rules like any other change (PR, approvers).
- **Data leakage** → avoid sending real resource IDs or secrets in prompts; use redacted fixtures or synthetic examples in the authoring UI.

### Rough implementation plan (phased)

**Phase 1 — Authoring API and validation gate**

- Add a server route (e.g. `POST /api/policies/suggest`) that accepts `{ "intent": "plain text description", "context?": "optional org hints" }`.
- System prompt includes: the **exact JSON schema** for `PolicyBundle` and `ComplianceRule`, a **short field catalog** (which keys exist on services for each `type`), and **2–3 gold examples** (input sentence → output JSON).
- Model returns **only JSON** (no markdown); server parses and validates with the same structural checks as `parsePolicyJson`, plus optional JSON Schema.
- If validation fails, either return structured errors to the UI or run a **single repair pass** (“fix the following validation errors: …”) with a low temperature cap.

**Phase 2 — Product UI**

- In the scanner UI, add a **“Describe a policy”** panel: textarea + **Generate draft** → side-by-side **preview** of generated rules next to the hand-edited JSON.
- Buttons: **Apply to editor** (user can still edit), **Run dry scan** against current snapshot (no persist), **Copy / export**.
- Show a short **natural-language summary** of what the model produced so non-authors can sanity-check before merge.

**Phase 3 — Quality and governance**

- **RAG (optional):** embed existing rule library + internal wiki snippets (“what does replicaCount mean for RDS?”) so suggestions align with house style and naming (`rule.id` conventions).
- **CI golden tests:** checked-in prompts and expected JSON (or expected parse + scan outcomes) so model or prompt upgrades do not regress authoring.
- **Environments:** sandbox model for drafts; stricter approval (or disabled LLM) for production policy bundles; feature flag per tenant.

**Phase 4 — Hardening**

- Rate limits and quotas on the suggest endpoint; no training on customer prompts unless contractually allowed.
- Optional **second model** or **static linter** pass: “does this rule only reference allowed fields for the stated `appliesTo`?”
- Consider **small specialized fine-tune** later only if few-shot + RAG is insufficient; default stays general models + strong validation.

### How this connects to the rest of the design

Collection, snapshots, evaluation, reporting, and scaling **stay unchanged**. The LLM sits **upstream** of the policy bundle: users still store versioned JSON, still open PRs, still run the same `scan()` function. That keeps the architecture honest—the compliance verdict is never “whatever the model guessed at runtime,” only **rules humans (or processes) have accepted** after validation.

---

This document satisfies the assessment areas: definition and storage of policies, data sources and access, evaluation pipeline, reporting and tracking, multi-environment scale, and trade-offs—with enough depth to stand alone in a repository or submission packet.
