import { describe, expect, it } from "vitest";

import { patientId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

// 11:00 in Pune: mid-morning clinic hours.
const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const PEOPLE = {
  asha: "a1a1a1a1-0000-4000-8000-000000000001",
  dev: "a1a1a1a1-0000-4000-8000-000000000002",
  farah: "a1a1a1a1-0000-4000-8000-000000000003",
  bina: "b1b1b1b1-0000-4000-8000-000000000001",
  admin: "c1c1c1c1-0000-4000-8000-000000000001",
} as const;

function setup() {
  const fixtures = createFixtures({ now: NOW });
  const backend = createFakeBackend(fixtures);
  const as = (who: string | null, host?: string): ApiClient =>
    backend.client({
      ...(host === undefined ? {} : { host }),
      getToken: () => (who === null ? null : fakeTokenFor({ id: who })),
      now: () => NOW,
    });
  return { fixtures, backend, as };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}`);
  }
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

describe("fixtures", () => {
  it("match the API's development seed and hold about sixty synthetic patients", () => {
    const { users, platformUsers, clinics, patients } = createFixtures({ now: NOW });
    expect(users.map((u) => u.id).sort()).toEqual([PEOPLE.asha, PEOPLE.dev, PEOPLE.farah, PEOPLE.bina].sort());
    expect(platformUsers.map((u) => [u.id, u.role])).toEqual([[PEOPLE.admin, "owner"]]);
    expect(clinics.slice(0, 2).map((c) => [c.name, c.host])).toEqual([
      ["Sunrise Dental", SUNRISE],
      ["Lotus Dental Care", LOTUS],
    ]);
    expect(patients.length).toBeGreaterThanOrEqual(50);
    for (const p of patients) {
      if (p.email != null) expect(p.email).toMatch(/@example\.com$/);
      if (p.phone != null) expect(p.phone).toMatch(/^\+919876\d{6}$/);
    }
  });
});

describe("fake client: identity and tenancy", () => {
  it("needs a token, and lists the clinics the person belongs to", async () => {
    const { as } = setup();
    expect(errorOf(await as(null).getMe())?.status).toBe(401);
    const me = value(await as(PEOPLE.dev).getMe());
    expect(me.clinics.map((c) => [c.slug, c.role_key, c.host])).toEqual([
      ["sunrise", "doctor", SUNRISE],
      ["lotus", "consultant", LOTUS],
    ]);
  });

  it("resolves the clinic from the host, and a non-member gets 404", async () => {
    const { as } = setup();
    const session = value(await as(PEOPLE.bina, LOTUS).getSession());
    expect(session.clinic.slug).toBe("lotus");
    expect(session.user.display_name).toBe("Bina Joshi");
    expect(errorOf(await as(PEOPLE.bina, SUNRISE).getSession())?.status).toBe(404);
  });

  it("enforces permissions: a visiting consultant cannot list patients", async () => {
    const { as } = setup();
    expect(errorOf(await as(PEOPLE.dev, LOTUS).listPatients())?.status).toBe(403);
    expect(value(await as(PEOPLE.dev, LOTUS).getToday()).appointments.length).toBeGreaterThan(0);
  });

  it("answers 404 for another clinic's patient", async () => {
    const { as, fixtures } = setup();
    const lotus = fixtures.clinics.find((c) => c.slug === "lotus");
    const theirs = fixtures.patients.find((p) => p.clinic_id === lotus?.id);
    const result = await as(PEOPLE.asha, SUNRISE).getPatient(patientId.parse(theirs?.id));
    expect(errorOf(result)?.status).toBe(404);
    expect(errorOf(result)?.requestId).toBeTruthy();
  });
});

describe("fake client: patients", () => {
  it("lists recent patients first", async () => {
    const { as } = setup();
    const { items } = value(await as(PEOPLE.farah, SUNRISE).listPatients());
    const visits = items.map((p) => p.last_visit_at ?? "");
    expect(visits).toEqual([...visits].sort().reverse());
  });

  it("finds patients by name prefix, clinic number or phone digits", async () => {
    const { as, fixtures } = setup();
    const client = as(PEOPLE.farah, SUNRISE);
    const target = fixtures.patients.find((p) => p.number === "SD-5");
    const [first = "", last = ""] = (target?.full_name ?? "").split(" ");
    expect(value(await client.searchPatients({ q: `${last.slice(0, 3)} ${first.slice(0, 2)}` })).items.map((p) => p.number)).toContain("SD-5");
    expect(value(await client.searchPatients({ q: "SD-5" })).items[0]?.number).toBe("SD-5");
    const withPhone = fixtures.patients.find((p) => p.number.startsWith("SD-") && p.phone != null);
    expect(value(await client.searchPatients({ q: (withPhone?.phone ?? "").slice(-6) })).items.map((p) => p.id)).toContain(withPhone?.id);
    expect(value(await client.searchPatients({ q: "zzzz qqqq" })).items).toEqual([]);
  });

  it("masks contact details for members without patients.contact", async () => {
    const { fixtures } = setup();
    const farah = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (farah !== undefined) farah.role = { key: "assistant", name: "Assistant", permissions: ["patients.read"] };
    const backend = createFakeBackend(fixtures);
    const client = backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: PEOPLE.farah }), now: () => NOW });
    const phones = value(await client.listPatients()).items.flatMap((p) => (p.phone == null ? [] : [p.phone]));
    expect(phones.length).toBeGreaterThan(0);
    for (const phone of phones) expect(phone).toMatch(/^\+91 ••••• •\d{4}$/);
  });

  it("answers input errors as the API does, so the field can be read from the message", async () => {
    const { as } = setup();
    const error = errorOf(await as(PEOPLE.farah, SUNRISE).createPatient({ full_name: "Asha Rane", sex: "female", phone: "+91123" }));
    expect(error).toMatchObject({ status: 400, code: "invalid_request", field: "phone", message: "Invalid phone number" });
  });

  it("assigns the next clinic number, keeps an age estimate, and finds the patient by ID", async () => {
    const { as } = setup();
    const client = as(PEOPLE.farah, SUNRISE);
    const created = value(await client.createPatient({ full_name: "Asha  Rane", sex: "female", age_years: 34, phone: "+919811122233" }));
    expect(created.number).toBe("SD-49");
    expect(created.full_name).toBe("Asha Rane");
    expect(created.birth_date_estimated).toBe(true);
    expect(created.age_years).toBe(34);
    expect(value(await client.getPatient(created.id)).number).toBe("SD-49");
  });
});

describe("fake client: today", () => {
  it("has one patient in the chair and two waiting, with money only for finance.view", async () => {
    const { as } = setup();
    const today = value(await as(PEOPLE.farah, SUNRISE).getToday());
    expect(today.date).toBe("2026-10-03");
    expect(today.appointments.filter((a) => a.status === "in_progress")).toHaveLength(1);
    expect(today.appointments.filter((a) => a.status === "arrived")).toHaveLength(2);
    expect(today.money).toBeNull();
    expect(value(await as(PEOPLE.asha, SUNRISE).getToday()).money?.collected_paise).toBe(2_850_000);
  });
});

describe("fake client: console", () => {
  it("is only for the Sakalya team", async () => {
    const { as, fixtures } = setup();
    expect(errorOf(await as(null).listClinics())?.status).toBe(401);
    expect(errorOf(await as(PEOPLE.asha).listClinics())?.status).toBe(403);
    const { items } = value(await as(PEOPLE.admin).listClinics());
    expect(items).toHaveLength(fixtures.clinics.length);
    expect(items.find((c) => c.slug === "sunrise")).toMatchObject({ portal_host: SUNRISE, active_members: 3, patients: 48 });
  });

  it("creates a clinic with an owner invitation, refusing reserved and taken addresses", async () => {
    const { as } = setup();
    const admin = as(PEOPLE.admin);
    expect(errorOf(await admin.createClinic({ name: "Admin Dental", slug: "admin", owner_email: "a@example.com" }))?.field).toBe("slug");
    expect(errorOf(await admin.createClinic({ name: "Sunrise", slug: "sunrise", owner_email: "a@example.com" }))?.status).toBe(409);
    expect(errorOf(await admin.createClinic({ name: "Asha Dental", owner_email: "nope" }))?.field).toBe("owner_email");

    const created = value(await admin.createClinic({ name: "Asha Dental Care", owner_email: "asha@example.com" }));
    expect(created.slug).toBe("asha-dental-care");
    expect(created.portal_host).toBe("asha-dental-care.localtest.me");
    expect(created.invite_token.length).toBeGreaterThan(20);
  });

  it("lets the invited owner join once, by email, as a new person", async () => {
    const { backend, as } = setup();
    const created = value(await as(PEOPLE.admin).createClinic({ name: "Asha Dental Care", owner_email: "asha@example.com" }));
    const newcomer = (email: string) =>
      backend.client({ getToken: () => fakeTokenFor({ id: "d1d1d1d1-0000-4000-8000-000000000009", email }), now: () => NOW });

    expect(errorOf(await newcomer("someone@example.com").acceptInvitation({ token: created.invite_token }))?.status).toBe(409);
    const joined = value(await newcomer("asha@example.com").acceptInvitation({ token: created.invite_token, display_name: "Dr Asha Rane" }));
    expect(joined.org_id).toBe(created.id);
    expect(value(await newcomer("asha@example.com").getMe()).clinics.map((c) => c.host)).toEqual([created.portal_host]);
    expect(errorOf(await newcomer("asha@example.com").acceptInvitation({ token: created.invite_token }))?.status).toBe(404);
  });

  it("serves metrics per range", async () => {
    const { as } = setup();
    const metrics = value(await as(PEOPLE.admin).getMetrics("24h"));
    expect(metrics.api.series).toHaveLength(24);
    expect(metrics.api.routes[0]?.route).toMatch(/^\/api\/v1\//);
    expect(value(await as(PEOPLE.admin).getMetrics("1h")).api.series).toHaveLength(12);
  });
});

describe("fake client: cancellation", () => {
  it("resolves to an aborted error when the signal is already cancelled", async () => {
    const { as } = setup();
    const controller = new AbortController();
    controller.abort();
    expect(errorOf(await as(PEOPLE.farah, SUNRISE).listPatients({ signal: controller.signal }))?.code).toBe("aborted");
  });
});
