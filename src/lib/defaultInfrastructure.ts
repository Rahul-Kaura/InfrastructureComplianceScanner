import { readFileSync } from "node:fs";
import { join } from "node:path";

let cached: string | null = null;

/** JSON text of the bundled sample infrastructure snapshot (examples/infrastructure/sample.json). */
export function getDefaultInfrastructureJson(): string {
  if (cached === null) {
    const path = join(process.cwd(), "examples/infrastructure/sample.json");
    cached = readFileSync(path, "utf8");
  }
  return cached;
}
