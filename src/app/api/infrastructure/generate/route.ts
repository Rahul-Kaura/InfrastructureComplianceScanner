import { NextResponse } from "next/server";
import { parseInfrastructureJson } from "@/lib/engine";
import { generateInfrastructureJsonWithOpenAI } from "@/lib/openaiInfrastructureGenerator";

/**
 * POST { "prompt": "natural language description of services/environments you want" }
 * Returns { "infrastructure": "<pretty-printed JSON string>" } validated by parseInfrastructureJson.
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

    const infrastructure = await generateInfrastructureJsonWithOpenAI(body.prompt);
    parseInfrastructureJson(infrastructure);
    return NextResponse.json({ infrastructure });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Infrastructure generation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
