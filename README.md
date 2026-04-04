# Infrastructure compliance scanner

Web app and shared TypeScript engine that evaluates **policies** against a normalized **infrastructure snapshot** (a JSON `services[]` list with fields such as environment, backups, encryption, public access, replicas, and instance types).

## How the UI works

1. **Inventory** — In **Enter Service Configuration (In Plain English)**, describe the services you want (environments, databases, compute, posture). **Build inventory** calls OpenAI (`OPENAI_API_KEY` on the server) to produce the internal snapshot. Alternatively, open **Advanced** and paste or edit full inventory JSON (`version` + `services`).
2. **Policies** — Enter rules as JSON (each rule must include `category`: `security`, `cost`, or `operational`) or as bullet lines prefixed with `[security]`, `[cost]`, or `[operational]`. You can **Draft policies with OpenAI** from plain English.
3. **Run scan** — The rule engine runs in-process; results are deterministic.
4. **After a successful scan** — The results panel shows **Sent to Service Manager** and a **Download PDF of compliance results** button (browser download via `jspdf`). Violations still show severity; **passed checks** are labeled **pass** only (no severity chip in the UI).

## API

- `POST /api/scan` — Body: `{ "infrastructure": "<JSON string>", "policies": "<bullets or JSON>" }`. Both are required.
- `POST /api/infrastructure/generate` — `{ "prompt": "..." }` for plain-English inventory generation, or `{ "categories": "...", "requirements": "..." }` plus optional `additionalNotes` for structured spec mode.
- `POST /api/policies/generate` — `{ "prompt": "..." }` returns validated policy bundle JSON.

## Same engine elsewhere

The CLI (`npm run scan`) and `POST /api/scan` use the same `src/lib/engine` evaluation logic.

## Configuration

- Local: copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` (and optional `OPENAI_MODEL`).
- Hosted (e.g. Render): set `OPENAI_API_KEY` in the service environment; see `render.yaml`.

## Stack

TypeScript, Node.js 20+, Next.js (App Router), React, Tailwind CSS, **jspdf** (PDF export). Docker / Compose, and example Kubernetes / Helm manifests are included for deployment patterns.

## Screenshots

![UI empty state](assets/ui-empty.png)

![UI with violations](assets/ui-violations.png)

## Future ideas

- Terraform / other IaC importers that emit the same snapshot JSON for pre-deploy checks in CI.
