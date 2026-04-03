import { NextResponse } from "next/server";
import { parseInfrastructureJson, parsePolicyJson, scan } from "@/lib/engine";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { infrastructure?: string; policies?: string };
    const infraText = body.infrastructure;
    const policyText = body.policies;
    if (typeof infraText !== "string" || typeof policyText !== "string") {
      return NextResponse.json(
        { error: "Send JSON with string fields: infrastructure, policies" },
        { status: 400 },
      );
    }
    const infra = parseInfrastructureJson(infraText);
    const policies = parsePolicyJson(policyText);
    const result = scan(infra, policies);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
