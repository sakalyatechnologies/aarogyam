#!/usr/bin/env node
/**
 * Regenerates `src/generated/openapi.ts` from `docs/api/openapi.json`.
 *
 * The committed spec can reuse an `operationId` across unrelated routes (for example `list` is
 * used for appointments, queue and staff) because the API names operations per handler, not
 * globally. `openapi-typescript` keys its `operations` type by `operationId`, so a collision
 * produces invalid TypeScript (`Duplicate identifier`). This script renames the known
 * collisions in a copy of the spec before generating.
 *
 * Remove `RENAMES` once the backend assigns unique `operationId`s (AGENTS.md rule 12 says the
 * contract is generated; this is the gap) — the script fails loudly if the spec grows a new,
 * unmapped collision, so it won't silently hide one.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const specPath = join(packageRoot, "../../../docs/api/openapi.json");
const outPath = join(packageRoot, "src/generated/openapi.ts");

/** @type {Record<string, string>} `${METHOD} ${path}` -> new operationId */
const RENAMES = {
  "GET /api/v1/appointments": "list_appointments",
  "GET /api/v1/queue": "list_queue",
  "GET /api/v1/staff": "list_staff",
  "PATCH /api/v1/appointments/{id}": "change_appointment",
  "PATCH /api/v1/staff/{membership_id}": "change_staff",
  "POST /api/v1/appointments/{id}/status": "set_appointment_status",
  "POST /api/v1/queue/{id}/status": "set_queue_status",
  "GET /api/v1/patients/{id}/attachments": "list_attachments",
  "GET /api/v1/patients/{id}/visits": "list_visits",
  "GET /api/v1/visits/{id}": "open_visit",
  "POST /api/v1/patients/{id}/dental-chart": "record_dental_chart",
  "POST /api/v1/visits/{id}/observations": "record_observation",
  "GET /api/v1/payments/{id}": "get_payment",
  "GET /api/v1/prescriptions/{id}": "get_prescription",
  "PATCH /api/v1/prescriptions/{id}": "edit_prescription",
  "POST /api/v1/patients/{id}/recalls": "create_recall",
  "POST /api/v1/registrations": "submit_registration",
  "POST /api/v1/console/clinics/{id}/invitations": "invite_to_clinic",
};

const spec = JSON.parse(readFileSync(specPath, "utf8"));

for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!op || typeof op !== "object" || !("operationId" in op)) continue;
    const rename = RENAMES[`${method.toUpperCase()} ${path}`];
    if (rename) op.operationId = rename;
  }
}

const seen = new Map();
for (const [path, methods] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(methods)) {
    if (!op || typeof op !== "object" || !("operationId" in op)) continue;
    const key = `${method.toUpperCase()} ${path}`;
    const prior = seen.get(op.operationId);
    if (prior) {
      throw new Error(
        `scripts/generate-openapi.mjs: duplicate operationId "${op.operationId}" on both ` +
          `${prior} and ${key}. Add a rename to RENAMES (or ask the backend to make it unique).`,
      );
    }
    seen.set(op.operationId, key);
  }
}

const tmpDir = mkdtempSync(join(tmpdir(), "aarogyam-openapi-"));
const fixedSpecPath = join(tmpDir, "openapi.json");
try {
  writeFileSync(fixedSpecPath, JSON.stringify(spec));
  execFileSync(
    "pnpm",
    ["exec", "openapi-typescript", fixedSpecPath, "-o", outPath, "--empty-objects-unknown"],
    { cwd: packageRoot, stdio: "inherit" },
  );
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
