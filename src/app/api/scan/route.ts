import { NextResponse } from "next/server";
import { parseInfrastructureJson, parsePoliciesInput, scan } from "@/lib/engine";
import { getDefaultInfrastructureJson } from "@/lib/defaultInfrastructure";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { infrastructure?: string; policies?: string };
    const policyText = body.policies;
    if (typeof policyText !== "string") {
      return NextResponse.json(
        {
          error:
            "Request body must be JSON with a string field policies (bullet-list policies or JSON starting with '{'). Optional infrastructure overrides the server default snapshot.",
        },
        { status: 400 },
      );
    }
    const infraText =
      typeof body.infrastructure === "string" && body.infrastructure.trim() !== ""
        ? body.infrastructure
        : getDefaultInfrastructureJson();
    const infra = parseInfrastructureJson(infraText);
    const policies = parsePoliciesInput(policyText);
    const result = scan(infra, policies);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
