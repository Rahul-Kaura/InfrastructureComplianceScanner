import { NextResponse } from "next/server";
import { parseInfrastructureJson } from "@/lib/engine";
import {
  generateInfrastructureFromSpecWithOpenAI,
  generateInfrastructureJsonWithOpenAI,
} from "@/lib/openaiInfrastructureGenerator";

/**
 * POST either:
 * - { "categories": "<JSON string>", "requirements": "<JSON string>", "additionalNotes"?: string } (preferred)
 * - { "prompt": "<natural language>" } (legacy / quick mode)
 * Returns { "infrastructure": "<pretty-printed JSON>" } validated by parseInfrastructureJson.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      prompt?: string;
      categories?: string;
      requirements?: string;
      additionalNotes?: string;
    };

    const cat = typeof body.categories === "string" ? body.categories.trim() : "";
    const reqt = typeof body.requirements === "string" ? body.requirements.trim() : "";
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";

    let infrastructure: string;

    if (cat && reqt) {
      try {
        JSON.parse(cat);
        JSON.parse(reqt);
      } catch {
        return NextResponse.json(
          { error: "categories and requirements must each be valid JSON (parseable strings)." },
          { status: 400 },
        );
      }
      const notes =
        typeof body.additionalNotes === "string" && body.additionalNotes.trim()
          ? body.additionalNotes.trim()
          : undefined;
      infrastructure = await generateInfrastructureFromSpecWithOpenAI({
        categoriesJson: cat,
        requirementsJson: reqt,
        additionalNotes: notes,
      });
    } else if (prompt) {
      infrastructure = await generateInfrastructureJsonWithOpenAI(prompt);
    } else {
      return NextResponse.json(
        {
          error:
            'Send { "categories": "...", "requirements": "..." } as JSON strings, or { "prompt": "..." } for a single description.',
        },
        { status: 400 },
      );
    }

    parseInfrastructureJson(infrastructure);
    return NextResponse.json({ infrastructure });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Infrastructure generation failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
