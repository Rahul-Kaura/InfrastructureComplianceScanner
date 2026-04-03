#!/usr/bin/env npx tsx
/**
 * Usage:
 *   npx tsx scripts/scan-cli.ts examples/infrastructure/sample.json examples/policies/sample.json
 *   npm run scan -- examples/infrastructure/sample.json examples/policies/sample.json
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseInfrastructureJson, parsePolicyJson, scan } from "../src/lib/engine";

function main() {
  const [, , infraPath, policyPath] = process.argv;
  if (!infraPath || !policyPath) {
    console.error(
      "Usage: scan-cli <infrastructure.json> <policies.json>\n  Exit 0 if clean, 2 if violations, 1 on errors.",
    );
    process.exit(1);
  }
  const infraText = readFileSync(resolve(process.cwd(), infraPath), "utf8");
  const policyText = readFileSync(resolve(process.cwd(), policyPath), "utf8");
  const infra = parseInfrastructureJson(infraText);
  const policies = parsePolicyJson(policyText);
  const result = scan(infra, policies);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 2);
}

main();
