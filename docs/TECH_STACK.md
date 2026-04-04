# Tech stack, solution overview, and where it lives

Plain-English map: stakeholder intent, inputs, Git/privacy/AI vs rules, then technologies, files, and future ideas.

---

## Solution overview

Audience: **service owners** and platform teams who want to check whether a **service configuration** (inventory) satisfies **compliance policies** before or alongside release processes.

### What the solution does

Service owners provide:

1. **Service configuration** — What you’re checking (databases, compute, environments, flags like backups, encryption, public access, replicas, instance types).  
   **Acceptable inputs in this product today:**
   - **JSON** — Normalized inventory (`services[]`) pasted in the UI or sent to the API.
   - **Natural language** — Plain-English description; the app can call **OpenAI** to **draft** that JSON (optional). The owner should **review and edit** the draft before scanning.

2. **Policies** — Rules that say what “good” looks like.  
   **Acceptable inputs today:**
   - **JSON** — Policy bundle with `rules[]`; each rule must declare a **category**: **security**, **cost**, or **operational**.
   - **Natural language** — Bullet lines with `[security]`, `[cost]`, or `[operational]` prefixes (pattern-matched into rules), or English prompts to **draft** JSON via OpenAI (optional).

The app runs a **deterministic rule engine** on the final JSON: it reports **violations** (with plain-language reasoning and **recommendations**) and **passes**. A prominent **disclaimer** in the UI states that **AI-assisted drafting** can be wrong and that results depend on the data and rules you supply—service owners should **proceed with caution** and validate against real systems.

### Policy categories

| Category | Typical focus |
|----------|----------------|
| **Security** | Encryption, exposure, access (e.g. public databases). |
| **Cost** | Instance classes, waste, non-prod sizing. |
| **Operational** | Backups, HA/replicas, runbook-style resilience. |

This matches how rules are authored (JSON `category` field or bullet prefixes) and how scan results are grouped in the UI and PDF.

### Defining and storing policies (including Git)

**In this repository**, policies are **files and editor text**, not a dedicated policy database.

**Why store policies in Git (recommended for teams):**

- **Version history** — Every change is attributed and reversible.
- **Review workflow** — Pull requests let security/platform peers review rule changes before they apply.
- **Environment alignment** — Branches or paths can mirror production / staging policy sets without silent drift.
- **Auditability** — “Policy as code” in Git is easier to evidence than rules only in a UI.
- **CI integration** — The same JSON can be scanned in pipelines (`npm run scan` / `POST /api/scan`) from committed files.

The web UI is for **authoring and trying** rules; **Git** remains the system of record when you adopt policy-as-code.

### How AI fits (and what is *not* in this product)

- **Today’s implementation** uses a **general-purpose OpenAI model** (Chat Completions) with **prompting** and **JSON-shaped output** to help **draft** inventory or policy JSON. It is **not** a separate **fine-tuned** model trained only on your policies.
- **Compliance decisions** (pass / fail per rule per service) come from **rule-based logic** in the TypeScript engine, not from the LLM re-judging each scan.
- **Recommendations** on violations use **engine defaults and rule `remediation` text**; the LLM does not re-interpret each violation at scan time unless you add that in a future version.

For **audit clarity**: treat **OpenAI** as a **drafting assistant**; treat the **scan result** as the output of **your frozen JSON + the engine**. Record **model name and prompt version** outside the app if you need traceability for AI drafts.

### Infrastructure data: sources, access, and privacy

**How it is accessed here (internal data):** the owner supplies configuration only—over **TLS** into your Next.js **`POST /api/scan`** body (or from **local files** via the CLI)—the server processes it **in memory** for that request (**no** app-side database persistence, **no** AWS/GCP/Azure inventory APIs in v1); using **OpenAI** to draft text sends that content to a **third party**, so skip or redact for the strictest internal-data posture.

**How service configuration is obtained in this project:**

| Source | How it’s used | Notes |
|--------|----------------|--------|
| **User input in the browser** | Plain English or JSON → optional OpenAI → state → **`POST /api/scan`** as `infrastructure`. | **Browser → your app** over HTTPS. |
| **“Advanced” paste** | Full inventory JSON in the UI. | No automatic cloud discovery. |
| **CLI** | `npm run scan -- <infra.json> <policies.json>` reads **local files**. | Good for CI. |
| **Bundled examples** | `examples/infrastructure/*.json` / optional `GET /api/infrastructure`. | Demo data only. |

There is **no** built-in connector to **AWS, GCP, or Azure APIs** for live inventory in v1.

**Privacy and security (internal data):**

1. **Data in transit** — Use **TLS** to your Next.js host. Payloads are handled **in memory** per request; this app **does not** persist inventory or policies to an application database.
2. **OpenAI** — Using **Build inventory** or **Generate policy JSON** sends text to **OpenAI** under their terms and your key. For sensitive internal data, **redact**, use **enterprise agreements**, or **paste JSON only** from a trusted environment.
3. **Secrets** — `OPENAI_API_KEY` in **environment variables** only, never in Git.
4. **Demo login** — Uniphore screen is **client-side demo** (`sessionStorage`); not enterprise IdP SSO.

**Not in scope today:** cloud asset API pull, Redis/DB cache of inventories, job queues—**future** hardening for very large scale.

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

If this doc drifts from the repo, check `package.json` and the `src/app/api/` folder first. End-user steps: **README.md**.
