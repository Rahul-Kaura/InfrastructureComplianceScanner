import { NextResponse } from "next/server";
import { parseInfrastructureJson, parsePoliciesInput, scan } from "@/lib/engine";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      infrastructure?: string;
      policies?: string;
    };
    const policyText = body.policies;
    if (typeof policyText !== "string") {
      return NextResponse.json(
        {
          error:
            'Request body must be JSON with a string field "policies" (bullet list with [security]/[cost]/[operational] prefixes, or JSON starting with "{").',
        },
        { status: 400 },
      );
    }

    if (typeof body.infrastructure !== "string" || !body.infrastructure.trim()) {
      return NextResponse.json(
        {
          error:
            'Request body must include a non-empty string field "infrastructure" (JSON with a "services" array). Paste or generate configuration in the UI.',
        },
        { status: 400 },
      );
    }

    const infraText = body.infrastructure.trim();
    const infra = parseInfrastructureJson(infraText);
    const policies = parsePoliciesInput(policyText);
    const result = scan(infra, policies);
    return NextResponse.json({ ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
