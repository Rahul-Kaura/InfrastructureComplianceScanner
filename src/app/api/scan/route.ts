import { NextResponse } from "next/server";
import { parseInfrastructureJson, parsePoliciesInput, scan } from "@/lib/engine";
import {
  getBundledInfrastructureJson,
  isSnapshotId,
  type SnapshotId,
} from "@/lib/infrastructureSnapshots";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      infrastructure?: string;
      policies?: string;
      snapshotId?: string;
    };
    const policyText = body.policies;
    if (typeof policyText !== "string") {
      return NextResponse.json(
        {
          error:
            "Request body must be JSON with a string field policies (bullet-list policies or JSON starting with '{'). Optional snapshotId: \"default\" | \"variant\", or pass infrastructure JSON string.",
        },
        { status: 400 },
      );
    }

    let snapshotIdUsed: SnapshotId = "default";
    let infraText: string;
    if (typeof body.infrastructure === "string" && body.infrastructure.trim() !== "") {
      infraText = body.infrastructure;
    } else {
      const sid = body.snapshotId;
      if (sid !== undefined && sid !== "" && !isSnapshotId(sid)) {
        return NextResponse.json(
          { error: 'Invalid snapshotId. Use "default", "variant", or omit for default.' },
          { status: 400 },
        );
      }
      if (isSnapshotId(sid)) {
        snapshotIdUsed = sid;
      }
      infraText = getBundledInfrastructureJson(snapshotIdUsed);
    }

    const infra = parseInfrastructureJson(infraText);
    const policies = parsePoliciesInput(policyText);
    const result = scan(infra, policies);
    return NextResponse.json({ ...result, snapshotId: snapshotIdUsed });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Scan failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
