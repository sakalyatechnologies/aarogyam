#!/usr/bin/env node
/**
 * Regenerates `src/generated/openapi.ts` from `docs/api/openapi.json`.
 *
 * `openapi-typescript` keys its `operations` type by `operationId`, so a duplicate produces
 * invalid TypeScript (`Duplicate identifier`). The API gives every operation its own explicit
 * `operation_id` and a Rust test fails on duplicates; this script fails loudly too, rather than
 * rename anything.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const specPath = join(packageRoot, "../../../docs/api/openapi.json");
const outPath = join(packageRoot, "src/generated/openapi.ts");

const spec = JSON.parse(readFileSync(specPath, "utf8"));

const seen = new Map();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!op || typeof op !== "object" || !("operationId" in op)) continue;
    const key = `${method.toUpperCase()} ${path}`;
    const prior = seen.get(op.operationId);
    if (prior) {
      throw new Error(
        `scripts/generate-openapi.mjs: duplicate operationId "${op.operationId}" on both ` +
          `${prior} and ${key}. Give one of them a unique operation_id in its route annotation.`,
      );
    }
    seen.set(op.operationId, key);
  }
}

execFileSync(
  "pnpm",
  ["exec", "openapi-typescript", specPath, "-o", outPath, "--empty-objects-unknown"],
  { cwd: packageRoot, stdio: "inherit" },
);
