/**
 * Server-only: calls OpenAI to produce infrastructure snapshot JSON.
 * Requires OPENAI_API_KEY in the environment (never commit keys).
 */

const SYSTEM_PROMPT = `You output ONLY valid JSON for an infrastructure inventory "snapshot" used by a compliance scanner. No markdown, no commentary. The root object must have "version" (string, use "1"), a "services" array, and optionally "generatedAt" (ISO-8601 string).

Each service in "services" MUST include:
- "id": unique string (e.g. rds-prod-orders)
- "type": "database" | "compute" | "cache" | "storage" or similar string
- "environment": "production" | "staging" | "development"

Optional fields (use when relevant to the user's description):
- "name": string
- "automatedBackups": boolean (databases)
- "encryptionAtRest": boolean (databases)
- "publiclyAccessible": boolean (databases / compute)
- "replicaCount": number (non-negative integer)
- "instanceType": string (e.g. db.r5.xlarge, db.t3.medium, t3.small)
- "tags": object of string keys to string values

Typical inventories have roughly 5–12 services. Invent plausible ids and attributes that match the user's scenario; do not invent real AWS account data.`;

export async function generateInfrastructureJsonWithOpenAI(userPrompt: string): Promise<string> {
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
          content: `Produce infrastructure snapshot JSON from this description:\n\n${userPrompt.trim()}`,
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
