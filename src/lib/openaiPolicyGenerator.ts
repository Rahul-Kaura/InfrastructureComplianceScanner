/**
 * Server-only: calls OpenAI to produce a PolicyBundle JSON string.
 * Requires OPENAI_API_KEY in the environment (never commit keys).
 */

const SYSTEM_PROMPT = `You output ONLY valid JSON for a compliance "policy bundle" used by a TypeScript rule engine. No markdown, no commentary. The root object must have exactly "version" (string) and "rules" (array) — do not nest under another key.

Schema:
{
  "version": "1",
  "rules": [
    {
      "id": "unique-kebab-id",
      "name": "Short title",
      "description": "What this rule checks",
      "severity": "critical" | "high" | "medium" | "low",
      "category": "security" | "cost" | "operational",
      "remediation": "1-3 sentences: what the operator should change in cloud console or IaC, then re-scan.",
      "appliesTo": {
        "type": "database" | "compute" | optional string,
        "environment": "production" | "staging" | "development" | or array of those
      },
      "assert": [
        {
          "field": "automatedBackups" | "encryptionAtRest" | "publiclyAccessible" | "replicaCount" | "instanceType" | string,
          "op": "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in" | "notIn" | "matches",
          "value": boolean | number | string | array (depends on op),
          "expect": "human-readable expectation for violation messages"
        }
      ]
    }
  ]
}

Rules:
- Service objects in inventory have: id, type, environment, automatedBackups, encryptionAtRest, publiclyAccessible, replicaCount, instanceType (optional), name, tags.
- For "dev/staging must use cheaper instance types" use op "matches", value "costOptimizedInstance", field "instanceType", appliesTo environment ["development","staging"] and type "database" if DB-only.
- Use "eq" with boolean true/false for backups, encryption, public access.
- Use "gte" with number for replica counts.
- Every rule must have at least one assert. Use sensible ids and remediation text.`;

export async function generatePolicyBundleJsonWithOpenAI(userPrompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to your environment (e.g. Render dashboard) — never commit API keys to git.",
    );
  }

  const model = process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Produce a policy bundle JSON from this request:\n\n${userPrompt.trim()}`,
        },
      ],
    }),
  });

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`OpenAI API error (${res.status}): ${raw.slice(0, 400)}`);
  }

  let data: {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    throw new Error("Invalid JSON from OpenAI transport");
  }

  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") {
    throw new Error("OpenAI returned no message content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Model output was not valid JSON");
  }

  return JSON.stringify(parsed, null, 2);
}
