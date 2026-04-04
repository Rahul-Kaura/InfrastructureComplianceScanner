# Tech stack and where it lives

Plain-English map of what this project uses, which files matter, and what might come next.

---

## Runtime app (what users hit in the browser)

| Technology | What it’s for | Main files |
|------------|----------------|------------|
| **Next.js 15** | Web framework: pages, API routes, server/client components. | `package.json`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx` |
| **React 19** | UI for the scanner, login gate, results, forms. | `src/app/page.tsx`, `src/components/UniphoreSsoLogin.tsx` |
| **TypeScript** | Typed code across the repo. | `tsconfig.json`, all `*.ts` / `*.tsx` |
| **Tailwind CSS 4** | Styling (layout, colors, responsive classes). | `src/app/globals.css`, `postcss.config.mjs`, class names in components |
| **Node.js** | Runs the server (dev, build, production). | `package.json` (`engines`), `Dockerfile` |

---

## Compliance engine (no AI — deterministic)

| Technology | What it’s for | Main files |
|------------|----------------|------------|
| **TypeScript rule engine** | Parses inventory + policies, evaluates rules, returns violations and passes. | `src/lib/engine/` (`evaluate.ts`, `parseBulletPolicies.ts`, `types.ts`, `ruleMetadata.ts`, `violationPlainEnglish.ts`, etc.) |
| **CLI (`tsx`)** | Run the same scan from the terminal (good for CI). | `scripts/scan-cli.ts`, `npm run scan` |

---

## OpenAI (optional — drafting only)

| Technology | What it’s for | Main files |
|------------|----------------|------------|
| **OpenAI Chat Completions API** | Turns plain English into **inventory JSON** or **policy bundle JSON**. The scan itself does **not** call OpenAI; it only uses whatever JSON you have. | `src/lib/openaiInfrastructureGenerator.ts`, `src/lib/openaiPolicyGenerator.ts` |
| **API routes** | HTTP endpoints the UI calls. | `src/app/api/infrastructure/generate/route.ts`, `src/app/api/policies/generate/route.ts` |
| **Environment** | API key and model name (never commit keys). | `.env.example`, `render.yaml` (`OPENAI_API_KEY`, `OPENAI_MODEL`) |

---

## PDF export (browser)

| Technology | What it’s for | Main files |
|------------|----------------|------------|
| **jsPDF** | Builds a downloadable PDF of scan results after a run. | `src/lib/compliancePdf.ts`, button handler in `src/app/page.tsx` |

---

## HTTP API (same engine as UI)

| What | Purpose | File |
|------|---------|------|
| `POST /api/scan` | Scan with body: infrastructure JSON + policies string. | `src/app/api/scan/route.ts` |
| `POST /api/infrastructure/generate` | LLM → inventory JSON (prompt or categories+requirements). | `src/app/api/infrastructure/generate/route.ts` |
| `POST /api/policies/generate` | LLM → policy JSON. | `src/app/api/policies/generate/route.ts` |
| `GET /api/infrastructure` | Optional: load bundled sample inventory by `snapshotId`. | `src/app/api/infrastructure/route.ts` |

---

## Packaging and hosting

| Technology | What it’s for | Main files |
|------------|----------------|------------|
| **Docker** | Build a production image: install deps, `next build`, run `next start` on port 3000. | `Dockerfile` |
| **Docker Compose** | One-command local run of that image (`docker compose up`). | `docker-compose.yml` |
| **Render** | Example hosted deploy (blueprint + env vars). | `render.yaml` |
| **Kubernetes (plain YAML)** | Example Deployment + Service in one file (`kubectl apply -f k8s/deployment.yaml`). | `k8s/deployment.yaml` |
| **Helm** | Chart to install the app on Kubernetes with values. | `helm/scanner/` (`Chart.yaml`, `values.yaml`, `templates/deployment.yaml`, `templates/service.yaml`) |

---

## Quality and tooling

| Technology | What it’s for | Main files |
|------------|----------------|------------|
| **ESLint** | Lint rules for JS/TS/React. | `eslint.config.mjs`, `eslint-config-next` in `package.json` |

---

## Data / examples (not “tech,” but referenced)

| What | Where |
|------|--------|
| Sample infrastructure JSON | `examples/infrastructure/` |
| Sample policies JSON | `examples/policies/sample.json` |
| Sample scan output shape | `examples/output/sample-scan.json` |

---

## Future-style directions (not built yet)

These are natural extensions; the README already hints at some.

| Idea | Why it’s useful |
|------|------------------|
| **Terraform / OpenTofu / Pulumi** | Turn plan or state output into the same `services[]` JSON so you can scan **before** or **after** apply in CI. |
| **Deeper Kubernetes integration** | Scan cluster objects (CRDs, labels) into the snapshot format, or run the scanner as a Job after deploy. |
| **Real SSO** | Replace the demo Uniphore gate with OIDC/SAML (Auth.js, Clerk, etc.). |
| **Persistence** | Store scan history and PDFs in a database or object storage instead of only in-browser / download. |
| **Policy marketplace** | Share rule bundles as versioned JSON packages. |

---

## Quick dependency list (npm)

From `package.json` **dependencies**: `next`, `react`, `react-dom`, `jspdf`.  
**DevDependencies**: TypeScript, ESLint, Tailwind 4, `tsx` (CLI runner), types for Node/React.

If this doc drifts from the repo, check `package.json` and the `src/app/api/` folder first.
