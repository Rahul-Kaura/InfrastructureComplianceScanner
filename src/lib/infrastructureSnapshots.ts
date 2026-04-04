import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SNAPSHOT_MANIFEST, type SnapshotId } from "./snapshotManifest";

export type { SnapshotId } from "./snapshotManifest";

const cache = new Map<string, string>();

function pathForFile(file: string): string {
  return join(process.cwd(), "examples/infrastructure", file);
}

/** JSON text for a bundled snapshot file. */
export function getBundledInfrastructureJson(id: SnapshotId | string | undefined): string {
  const key: SnapshotId =
    id === "variant" || id === "default" ? id : "default";
  const file = SNAPSHOT_MANIFEST[key].file;
  if (!cache.has(file)) {
    cache.set(file, readFileSync(pathForFile(file), "utf8"));
  }
  return cache.get(file)!;
}

export function isSnapshotId(value: unknown): value is SnapshotId {
  return value === "default" || value === "variant";
}

/** @deprecated use getBundledInfrastructureJson("default") */
export function getDefaultInfrastructureJson(): string {
  return getBundledInfrastructureJson("default");
}
