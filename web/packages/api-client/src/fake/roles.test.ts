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

describe("fake client: QA fixes", () => {
  it("lists roles for roles.manage without staff.manage, but not the staff", async () => {
    const fixtures = createFixtures({ now: NOW });
    const farah = fixtures.memberships.find((m) => m.user_id === FARAH);
    if (farah === undefined) throw new Error("no membership");
    farah.role = { key: "reader", name: "Reader", permissions: ["roles.manage"] };
    const backend = createFakeBackend(fixtures);
    const desk = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: FARAH }), now: () => NOW });
    expect(status(await desk.listRoles())).toBe(200);
    expect(status(await desk.listStaff())).toBe(403);
  });

  it("refuses a payment above the balance due, as the API does", async () => {
    const { as } = setup();
    const owner = as(ASHA, SUNRISE);
    const bills = value(await owner.listInvoices({}));
    const bill = bills.items.find((i) => i.balance_paise > 0);
    if (bill === undefined) throw new Error("the fixtures have no bill with a balance");
    const pay = (amount: number, key: string) =>
      owner.recordPayment(
        { patient_id: bill.patient.id, method: "cash", amount_paise: amount, allocations: [{ invoice_id: bill.id, amount_paise: Math.min(amount, bill.balance_paise) }] },
        key,
      );
    const over = await pay(bill.balance_paise + 100, "key-over-0001");
    expect(over.ok ? 200 : over.error.status).toBe(400);
    expect(over.ok ? "" : over.error.message).toMatch(/more than the balance due/);
    expect(status(await pay(bill.balance_paise, "key-exact-0002"))).toBe(200);
  });
});
