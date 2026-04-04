import { NextResponse } from "next/server";
import { parsePolicyJson } from "@/lib/engine";
import { generatePolicyBundleJsonWithOpenAI } from "@/lib/openaiPolicyGenerator";

/**
 * POST { "prompt": "natural language description of rules you want" }
 * Returns { "policies": "<pretty-printed JSON string>" } validated by parsePolicyJson.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { prompt?: string };
    if (typeof body.prompt !== "string" || !body.prompt.trim()) {
      return NextResponse.json(
        { error: 'Request body must be JSON with a non-empty string field "prompt".' },
        { status: 400 },
      );
    }

    const policies = await generatePolicyBundleJsonWithOpenAI(body.prompt);
    parsePolicyJson(policies);
    return NextResponse.json({ policies });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Policy generation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
