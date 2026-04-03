# Infrastructure compliance scanner

Small full-stack demo for an infra auditing take-home: you feed it a JSON snapshot of services plus a JSON policy pack, and it lists every rule failure with enough context to fix the drift.

The UI is a dark “moon” layout (inspired by community chat components like [Ruixen Moon Chat](https://21st.dev/community/components/ruixenui/ruixen-moon-chat/default))—orb glow, glassy panels, and a session feed so results read like a conversation instead of a raw log dump.

## What’s included

- **Rule engine** (`src/lib/engine`) — parses infra + policies, evaluates assertions, returns structured violations. Same code paths back the HTTP API and the CLI.
- **Web app** — edit/paste JSON, hit *Run scan*, see violations as cards in the feed.
- **REST** — `POST /api/scan` with `{ "infrastructure": "<json string>", "policies": "<json string>" }`.
- **Samples** — `examples/infrastructure/sample.json`, `examples/policies/sample.json`, and a frozen example report in `examples/output/sample-scan.json`.
- **Design write-up** — `DESIGN.md` (policy storage, data sources, scaling, trade-offs).
- **Ops glue** — `Dockerfile`, `docker-compose.yml`, `k8s/deployment.yaml`, `helm/scanner/`, and a Terraform-shaped example under `examples/terraform/` (RDS fields mapped to the same concepts the rules use).

## Formats (short version)

**Infrastructure snapshot:** top-level `services` array. Each service needs at least `id`, `type`, `environment`. The sample rules also use `automatedBackups`, `encryptionAtRest`, `publiclyAccessible`, `replicaCount`, `instanceType`.

**Policies:** top-level `rules` array. Each rule has `id`, `name`, `description`, `severity`, optional `appliesTo` (`type` / `environment`, string or array), and `assert` entries with `field`, `op`, and usually `value` + `expect` for messages.

Supported `op` values today: `eq`, `neq`, `gte`, `lte`, `gt`, `lt`, `in`, `notIn`, and `matches` with `value: "costOptimizedInstance"` for the dev/staging instance-family heuristic.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000 — defaults are preloaded so you can scan immediately.

## CLI

```bash
npm run scan -- examples/infrastructure/sample.json examples/policies/sample.json
```

Exit code `0` if nothing failed, `2` if there are violations, `1` for bad args / parse errors. Output is JSON on stdout.

## Docker

```bash
docker compose up --build
```

Then http://localhost:3000 again.

## Kubernetes / Helm

Raw manifests: `k8s/deployment.yaml` (expects an image tagged `compliance-scanner:latest` in your cluster).

Helm:

```bash
helm install scanner ./helm/scanner
```

Point `values.yaml` at your registry image when you have one.

## Repo layout

| Path | Purpose |
|------|---------|
| `src/lib/engine` | Types + evaluator |
| `src/app/api/scan` | POST endpoint |
| `src/app/page.tsx` | UI |
| `scripts/scan-cli.ts` | CLI entry |
| `examples/` | Sample inputs + example output |
| `DESIGN.md` | System design (assessment part 1) |

## Assumptions

Real life you’d build collectors that turn AWS/Azure/GCP (or Terraform plans) into this snapshot shape. Here the JSON is the source of truth so the focus stays on rule evaluation and reporting.

Node 20+ is fine; CI often pins 22 to match the Dockerfile.
