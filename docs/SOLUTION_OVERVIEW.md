# Solution overview

Audience: **service owners** and platform teams who want to check whether a **service configuration** (inventory) satisfies **compliance policies** before or alongside release processes.

---

## What the solution does

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

---

## Policy categories

Policies are grouped into three categories so results and reporting stay clear:

| Category | Typical focus |
|----------|----------------|
| **Security** | Encryption, exposure, access (e.g. public databases). |
| **Cost** | Instance classes, waste, non-prod sizing. |
| **Operational** | Backups, HA/replicas, runbook-style resilience. |

This matches how rules are authored (JSON `category` field or bullet prefixes) and how scan results are grouped in the UI and PDF.

---

## Defining and storing policies (including Git)

**In this repository**, policies are **files and editor text**, not a dedicated policy database.

**Why store policies in Git (recommended for teams):**

- **Version history** — Every change is attributed and reversible; you can see *who* changed *what* and *when*.
- **Review workflow** — Pull requests let security/platform peers review rule changes before they apply.
- **Environment alignment** — Branches or paths can mirror `production` / `staging` policy sets without silent drift.
- **Auditability** — For internal compliance, “policy as code” in Git is easier to evidence than rules hidden in a UI-only store.
- **CI integration** — The same JSON can be scanned in pipelines (`npm run scan` / `POST /api/scan`) using the committed files.

The web UI is for **authoring and trying** rules; **Git** remains the system of record when you adopt policy-as-code.

---

## How AI fits (and what is *not* in this product)

- **Today’s implementation** uses a **general-purpose OpenAI model** (e.g. via Chat Completions) with **prompting** and **JSON-shaped output** to help **draft** inventory or policy JSON. It is **not** a separate **fine-tuned** model trained only on your policies.
- **Compliance decisions** (pass / fail per rule per service) come from **rule-based logic** in the TypeScript engine, not from the LLM re-judging each scan.
- **Recommendations** on violations use **engine defaults and rule `remediation` text**; the LLM does not re-interpret each violation at scan time unless you add that in a future version.

For **audit clarity**: treat **OpenAI** as a **drafting assistant**; treat the **scan result** as the output of **your frozen JSON + the engine**. If you need traceability for AI drafts, record **model name and prompt version** outside the app (e.g. in Git commit messages or runbooks).

---

## Infrastructure data: sources, access, and privacy

### How service configuration is obtained **in this project**

| Source | How it’s used | Notes |
|--------|----------------|--------|
| **User input in the browser** | Typed JSON or plain English → optional OpenAI → JSON stored in page state → sent to **`POST /api/scan`** as the `infrastructure` body. | Data moves **browser → your deployed app** over HTTPS. |
| **“Advanced” paste** | Full inventory JSON edited locally, same as above. | No automatic cloud discovery. |
| **CLI** | `npm run scan -- <infra.json> <policies.json>` reads **local files** from disk. | Good for CI; paths are under your control. |
| **Bundled examples** | `examples/infrastructure/*.json` for demos / optional `GET /api/infrastructure`. | Not customer production data. |

There is **no** built-in connector that calls **AWS, GCP, or Azure APIs** to pull live inventories in v1.

### Privacy and security considerations (internal data)

1. **Data in transit** — Browser ↔ your Next.js host should use **TLS**. API routes run on **your** server; payloads are processed **in memory** for the request; this codebase does **not** persist inventory or policies to an application database.
2. **Data sent to OpenAI** — If you use **Build inventory** or **Generate policy JSON**, **natural language (and resulting structured text)** is sent to **OpenAI’s APIs** under **their** terms and your **API key**. For **strict internal-only** data, either **do not use** those features for sensitive fields, **redact** prompts, use **enterprise/OpenAI agreements** as required, or **paste JSON only** after generating it in a trusted environment.
3. **Secrets** — `OPENAI_API_KEY` and similar belong in **environment variables** (e.g. Render dashboard, `.env.local`), never in Git.
4. **Demo login** — The Uniphore SSO screen is a **client-side demo gate** (`sessionStorage`); it is **not** enterprise SSO and does not replace IdP-backed auth for production.

### Summary

- **Access pattern:** configuration is **supplied by the owner** (paste, file, or LLM-assisted draft), then **validated and scanned server-side** per request.  
- **Not in scope today:** automated subscription to cloud asset APIs, Redis/DB caching of tenant inventories, or job queues—those would be **future** platform hardening if you scale beyond single-request scans.

---

## Related technical detail

- File and API map: **[TECH_STACK.md](./TECH_STACK.md)**  
- User-facing flow: **README.md**
