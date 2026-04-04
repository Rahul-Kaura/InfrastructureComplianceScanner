import { NextResponse } from "next/server";
import { getBundledInfrastructureJson, isSnapshotId } from "@/lib/infrastructureSnapshots";

/** GET ?snapshotId=default|variant — raw JSON text for the configuration editor. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("snapshotId") ?? "default";
  if (!isSnapshotId(id)) {
    return NextResponse.json(
      { error: 'snapshotId must be "default" or "variant"' },
      { status: 400 },
    );
  }
  try {
    const content = getBundledInfrastructureJson(id);
    return NextResponse.json({ snapshotId: id, content });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to read snapshot";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
