import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const STAFF = "support@example.com";

const SEEDED = "d1d1d1d1-0000-4000-8000-000000000001";

function setup() {
  const fixtures = createFixtures({ now: NOW });
  fixtures.platformUsers.push({ id: "c1c1c1c1-0000-4000-8000-000000000002", display_name: "Sam Support", email: STAFF, role: "support", description: "Support." });
  const clinicId = fixtures.clinics.find((c) => c.host === "sunrise.localtest.me")?.id ?? "";
  const asha = fixtures.memberships.find((m) => m.user_id === ASHA)?.id ?? "";
  fixtures.supportGrants = [{ id: SEEDED, clinic_id: clinicId, staff_user_id: "c1c1c1c1-0000-4000-8000-000000000001", starts_at: inHours(-3), ends_at: inHours(-1), reason: "Old check", granted_by: asha }];
  fixtures.supportActions = [
    { grant_id: SEEDED, at: inHours(-2.5), method: "GET", route: "/api/v1/patients" },
    { grant_id: SEEDED, at: inHours(-2), method: "GET", route: "/api/v1/patients/{id}" },
  ];
  const backend = createFakeBackend(fixtures);
  const as = (who: string): ApiClient => backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { as, fixtures, backend };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

const inHours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const statusOf = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);

describe("fake client: the clinic's own dental terms", () => {
  it("lists, renames, retires and restores an own term, and refuses a duplicate label", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const a = value(await asha.addDentalTerm({ kind: "procedure", label: "Laser whitening" }));
    const b = value(await asha.addDentalTerm({ kind: "procedure", label: "Gum sculpt" }));
    expect(value(await asha.listOwnDentalTerms()).items.map((t) => t.label)).toEqual(["Gum sculpt", "Laser whitening"]);
    expect(value(await asha.renameDentalTerm(a.id, { label: "Laser bleaching" })).label).toBe("Laser bleaching");
    expect(statusOf(await asha.renameDentalTerm(a.id, { label: "gum sculpt" }))).toBe(409);
    expect(statusOf(await asha.renameDentalTerm(a.id, { label: "Filling" }))).toBe(409);
    expect(statusOf(await asha.renameDentalTerm(a.id, { label: "  " }))).toBe(400);
    expect(value(await asha.retireDentalTerm(b.id)).retired).toBe(true);
    expect(value(await asha.listOwnDentalTerms()).items.find((t) => t.id === b.id)?.retired).toBe(true);
    expect(value(await asha.restoreDentalTerm(b.id)).retired).toBe(false);
    expect(statusOf(await asha.retireDentalTerm("zirconia"))).toBe(404);
  });

  it("lets clinical.read list but only settings.manage change", async () => {
    const { as } = setup();
    const added = value(await as(ASHA).addDentalTerm({ kind: "material", label: "Bonding agent" }));
    const farah = as(FARAH);
    expect(statusOf(await farah.listOwnDentalTerms())).toBe(403);
    expect(statusOf(await farah.renameDentalTerm(added.id, { label: "Bond" }))).toBe(403);
  });
});

describe("fake client: support grants", () => {
  it("grants read access from now, lists it, and refuses a second active grant for the same person", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const grant = value(await asha.createSupportGrant({ staff_email: STAFF, reason: "Fix a billing view", ends_at: inHours(24) }));
    expect(grant).toMatchObject({ status: "active", access: "read", staff_email: STAFF, staff_name: "Sam Support", actions: 0, starts_at: NOW.toISOString() });
    expect(value(await asha.listSupportGrants()).items).toHaveLength(2);
    expect(statusOf(await asha.createSupportGrant({ staff_email: STAFF, reason: "Again", ends_at: inHours(2) }))).toBe(409);
  });

  it("checks the reason, the end and that the email is staff", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    expect(statusOf(await asha.createSupportGrant({ staff_email: STAFF, reason: "ab", ends_at: inHours(2) }))).toBe(400);
    expect(statusOf(await asha.createSupportGrant({ staff_email: STAFF, reason: "Fine reason", ends_at: inHours(0.1) }))).toBe(400);
    expect(statusOf(await asha.createSupportGrant({ staff_email: STAFF, reason: "Fine reason", ends_at: inHours(24 * 8) }))).toBe(400);
    expect(statusOf(await asha.createSupportGrant({ staff_email: "nobody@example.com", reason: "Fine reason", ends_at: inHours(2) }))).toBe(400);
  });

  it("shows an ended grant, lists what was looked at newest first, and revokes once", async () => {
    const { as } = setup();
    const asha = as(ASHA);
    const old = value(await asha.listSupportGrants()).items.find((g) => g.id === SEEDED);
    expect(old).toMatchObject({ status: "ended", actions: 2, granted_by: "Asha Kulkarni" });
    expect(value(await asha.listSupportGrantActions(SEEDED)).items.map((a) => a.route)).toEqual(["/api/v1/patients/{id}", "/api/v1/patients"]);
    expect(statusOf(await asha.revokeSupportGrant(SEEDED))).toBe(409);
    const grant = value(await asha.createSupportGrant({ staff_email: STAFF, reason: "Fix a billing view", ends_at: inHours(2) }));
    expect(value(await asha.revokeSupportGrant(grant.id)).status).toBe("revoked");
    expect(statusOf(await asha.revokeSupportGrant("nope"))).toBe(404);
  });

  it("is for the owner only", async () => {
    const { as } = setup();
    expect(statusOf(await as(FARAH).listSupportGrants())).toBe(403);
  });
});
