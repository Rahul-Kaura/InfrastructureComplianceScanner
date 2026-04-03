# Infrastructure Compliance Scanner — System Design

## 1. Goals

Continuously prove that deployed (or planned) infrastructure matches organizational policies: security, cost, and operations. The scanner compares **declared state** (from APIs, IaC, or inventory jobs) against **versioned rules**, then emits violations that humans or ticketing systems can act on.

## 2. Policy / rule model

**Storage:** Policies live as JSON documents in git (like this repo), an object store (S3/GCS), or a policy service database. Each bundle has a version string and an ordered list of rules.

**Rule shape:** Each rule has an `id`, human title, `severity`, optional `appliesTo` selector (e.g. `type: database` and `environment: production`), and a list of `assert` clauses. Assertions reference a **field path** on a service record and an **operator** (`eq`, `gte`, `matches`, …). This keeps the engine small while staying expressive enough for the sample policies (backups, encryption, public access, replica count, instance class).

**Extensibility:** Richer deployments would add Rego (OPA), CEL, or WASM plugins for rules that need graph logic (e.g. “subnet must have no IGW route”). The JSON layer remains useful for simple guardrails and for teams that do not want a full policy language on day one.

## 3. Infrastructure data sources

| Source | What you get | How to access |
|--------|----------------|---------------|
| Cloud control planes | RDS, EC2, ElastiCache, etc. | AWS Config, Resource Groups Tagging API, Azure Resource Graph, GCP Asset Inventory |
| IaC | Intended state before apply | Terraform plan JSON, `terraform show -json`, Helm/Kustomize rendered manifests |
| K8s | Workloads, storage, networking | API server (in-cluster controller or CI job with kubeconfig) |
| CMDB / service catalog | Ownership, environment, cost center | REST from internal tools |

**Assumption for this demo:** A periodic job (Lambda, CronJob, GitHub Action) normalizes provider responses into the **service snapshot JSON** used here. Same schema can be produced from Terraform outputs or a small adapter script.

## 4. Evaluation pipeline

1. **Ingest:** Load snapshot + policy bundle; validate schema.
2. **Fan-out:** For each `(service, rule)` pair, skip if `appliesTo` does not match.
3. **Assert:** Run each assertion; collect structured failures (service id, rule id, field, actual vs expected).
4. **Aggregate:** Sort by severity, dedupe if needed, attach links to runbooks.

The reference implementation is synchronous and in-memory; latency is dominated by snapshot size, not CPU.

## 5. Reporting and tracking violations

- **API/UI:** POST snapshot + policies, return JSON; UI renders a session feed (moon-chat style) for interactive triage.
- **CI:** Exit non-zero when violations exist; print SARIF or JSON for GitHub Advanced Security / Sonar-style dashboards.
- **Tickets:** Webhook to Jira/ServiceNow with stable `ruleId` + `serviceId` for deduplication.
- **History:** Store each run’s result blob in object storage or a table (`run_id`, `passed`, `violation_count`, `hash(snapshot)` ) for trend charts and “drift since last deploy.”

## 6. Scale (thousands of services, many environments)

- **Sharding:** Partition snapshots by account, region, or `environment` and scan in parallel workers; merge violation lists.
- **Caching:** Hash normalized resources; skip unchanged hashes between runs.
- **Rule indexing:** Pre-index rules by `type` / `environment` to avoid evaluating every rule on every service (bitmap or inverted index).
- **Streaming:** For very large inventories, stream resources through the evaluator instead of loading one giant JSON file.

**Bottleneck:** Cloud API rate limits and data freshness, not the rule engine.

## 7. Trade-offs and limits

| Choice | Upside | Downside |
|--------|--------|----------|
| JSON rules | Easy to review in PRs, no new DSL | Awkward for cross-resource constraints |
| Snapshot vs live API | Reproducible, testable | Stale if sync lag is large |
| Generic `ServiceConfig` | Fast to adopt | Loses provider-specific nuance unless extended |

**Not covered in v0:** Network path analysis, secrets scanning, IAM policy simulation, cost forecasting. Those plug in as additional normalizers + rule types with more time.
