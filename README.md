# Infrastructure compliance scanner

Description:

The Infrastructure Compliance Scanner takes a clean, standardized snapshot of your infrastructure (a JSON list of services and their details) along with policies you provide. You can write these policies either as simple bullet points in plain English (which are pattern-matched into rules, not using AI) or as JSON.

Everything is then processed by a single TypeScript rule engine. This engine checks each service against each rule and returns:

* **Violations** (what failed)
* **Passes** (which service-rule combinations succeeded)

The web UI uses a fixed sample dataset on the server, so you mainly focus on editing policies. The API endpoint (`POST /api/scan`) and the CLI tool (`scan-cli`) both use the exact same rule engine, making it easy to automate checks or run them in CI pipelines.

The app is packaged using Docker and Docker Compose so it runs the same way locally and on a server. There are also example Kubernetes and Helm setups showing how to deploy it in a cluster with standard health checks and configuration.

Actual data collection (like pulling from cloud providers) is not included in the repo. Instead, the system always works with the same clean JSON format, no matter where the data comes from.

Technologies:

- TypeScript
- Node.js
- Next.js (App Router, React)
- Tailwind CSS
- Docker
- Docker Compose
- Kubernetes (example manifests)
- Helm (example chart)
- JSON (snapshot and policy file formats)
- Render (`render.yaml` blueprint for a hosted web service so you are not tied to localhost)

Screenshots:

![UI empty state](assets/ui-empty.png)

![UI with violations](assets/ui-violations.png)


Future ideas (not implemented yet):

- Terraform / other IaC as an input source (convert plan JSON into the same snapshot format so rules can run pre-deploy in CI)
