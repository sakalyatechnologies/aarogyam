import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const as = (who: string, host: string): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${String(result.error.status)} ${result.error.message}`);
  return result.value;
}
const status = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);

describe("fake client: roles and access", () => {
  it("edits a role, applies it at once, records who changed what, and keeps clinics apart", async () => {
    const { as } = setup();
    const owner = as(ASHA, SUNRISE);
    const desk = as(FARAH, SUNRISE);
    expect(status(await desk.listPatients())).toBe(200);
    const catalogue = value(await owner.getAccessCatalogue());
    expect(catalogue.permissions.some((p) => p.key === "roles.manage")).toBe(true);
    const before = value(await owner.getRole("front_desk"));
    const kept = before.permissions.filter((p) => !p.key.startsWith("patients."));
    const saved = value(await owner.setRolePermissions("front_desk", { permissions: kept }));
    expect(saved.changed).toBe(true);
    expect(status(await desk.listPatients())).toBe(403);
    const after = value(await owner.getRole("front_desk"));
    expect(after.history[0]?.changed_by_name).toBe("Asha Kulkarni");
    expect(after.history[0]?.before).toEqual(before.permissions);
    // Lotus's front desk is untouched.
    const theirs = value(await as(BINA, LOTUS).getRole("front_desk"));
    expect(theirs.permissions).toEqual(theirs.default_permissions);
  });

  it("guards the owner role, your own role and roles.manage", async () => {
    const { as } = setup();
    const owner = as(ASHA, SUNRISE);
    expect(status(await owner.setRolePermissions("owner", { permissions: [] }))).toBe(403);
    expect(status(await owner.setRolePermissions("finance", { permissions: [{ key: "finance.view", scope: "own" }] }))).toBe(400);
    expect(status(await as(FARAH, SUNRISE).getAccessCatalogue())).toBe(403);
    const created = value(await owner.createRole({ name: "Senior nurse", template_key: "assistant" }));
    expect(created.key).toBe("senior_nurse");
    expect(status(await owner.deleteRole("doctor"))).toBe(409);
    expect(status(await owner.deleteRole("senior_nurse"))).toBe(200);
  });
});
