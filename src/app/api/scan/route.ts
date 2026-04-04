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
      /** UI hint: which bundled template was used to populate the configuration editor */
      inventoryTemplate?: string;
    };
    const policyText = body.policies;
    if (typeof policyText !== "string") {
      return NextResponse.json(
        {
          error:
            "Request body must be JSON with a string field policies (bullet list or JSON starting with '{'). Send configuration as infrastructure JSON, or omit it and pass snapshotId.",
        },
        { status: 400 },
      );
    }

    let snapshotIdUsed: SnapshotId | undefined;
    let infraText: string;
    if (typeof body.infrastructure === "string" && body.infrastructure.trim() !== "") {
      infraText = body.infrastructure.trim();
      const hint = body.inventoryTemplate;
      if (isSnapshotId(hint)) {
        snapshotIdUsed = hint;
      }
    } else {
      const sid = body.snapshotId;
      if (sid !== undefined && sid !== "" && !isSnapshotId(sid)) {
        return NextResponse.json(
          { error: 'Invalid snapshotId. Use "default", "variant", or send infrastructure JSON.' },
          { status: 400 },
        );
      }
      snapshotIdUsed = isSnapshotId(sid) ? sid : "default";
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
