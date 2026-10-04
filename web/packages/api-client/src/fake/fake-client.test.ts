import { describe, expect, it } from "vitest";

import { patientNumber, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor, type FakeUser, type Fixtures } from "./index.js";

// 11:00 in Pune: mid-morning clinic hours.
const NOW = new Date("2026-10-03T05:30:00Z");
const SMILE = "smilecatchers.localtest.me:8080";
const HASYA = "hasya.localtest.me:8080";

function setup() {
  const fixtures = createFixtures({ now: NOW });
  const backend = createFakeBackend(fixtures);
  const user = (name: string): FakeUser => {
    const found = fixtures.users.find((u) => u.display_name.includes(name));
    if (found === undefined) {
      throw new Error(`no fixture user ${name}`);
    }
    return found;
  };
  const as = (who: { id: string } | null, host?: string): ApiClient =>
    backend.client({
      ...(host === undefined ? {} : { host }),
      getToken: () => (who === null ? null : fakeTokenFor(who.id)),
      now: () => NOW,
    });
  return { fixtures, backend, user, as };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected success, got ${result.error.code}`);
  }
  return result.value;
}

function errorCode<T>(result: ApiResult<T>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

describe("fixtures", () => {
  it("hold about fifty synthetic patients, identical for the same seed", () => {
    const a = createFixtures({ now: NOW });
    const b = createFixtures({ now: NOW });
    expect(a.patients.length).toBeGreaterThanOrEqual(50);
    expect(a.patients.length).toBeLessThanOrEqual(70);
    expect(a.patients.map((p) => p.full_name)).toEqual(b.patients.map((p) => p.full_name));
  });

  it("use only reserved email domains and the made-up phone block", () => {
    const { patients }: Fixtures = createFixtures({ now: NOW });
    for (const p of patients) {
      if (p.email != null) expect(p.email).toMatch(/@example\.com$/);
      if (p.phone != null) expect(p.phone).toMatch(/^\+919876\d{6}$/);
    }
  });
});

describe("fake client: identity and tenancy", () => {
  it("needs a token, and lists the clinics the user belongs to", async () => {
    const { as, user } = setup();
    expect(errorCode(await as(null).getMe())).toBe("unauthenticated");

    const me = value(await as(user("Anika")).getMe());
    expect(me.clinics.map((c) => c.slug)).toEqual(["smilecatchers", "hasya"]);
    expect(me.clinics[0]?.host).toBe(SMILE);
  });

  it("resolves the clinic from the host and refuses non-members", async () => {
    const { as, user } = setup();
    const session = value(await as(user("Anika"), HASYA).getSession());
    expect(session.clinic.slug).toBe("hasya");
    expect(session.membership.role_key).toBe("doctor");

    expect(errorCode(await as(user("Sunita"), HASYA).getSession())).toBe("not_a_member");
    expect(errorCode(await as(user("Sunita"), "nowhere.localtest.me:8080").getSession())).toBe("clinic_not_found");
  });

  it("enforces permissions: a visiting consultant cannot list patients", async () => {
    const { as, user } = setup();
    const consultant = as(user("Vivek"), SMILE);
    expect(errorCode(await consultant.listPatients({}))).toBe("forbidden");
    expect(value(await consultant.getToday()).appointments.length).toBeGreaterThan(0);
  });

  it("answers 404, not 403, for another clinic's patient", async () => {
    const { as, user, fixtures } = setup();
    const hasyaClinic = fixtures.clinics.find((c) => c.slug === "hasya");
    const hasyaPatient = fixtures.patients.find((p) => p.clinic_id === hasyaClinic?.id);
    const ref = patientNumber.parse(hasyaPatient?.number);

    const result = await as(user("Anika"), SMILE).getPatient(ref);
    expect(result.ok ? null : result.error.status).toBe(404);
    expect(result.ok ? null : result.error.requestId).toBeTruthy();
  });
});

describe("fake client: patient search", () => {
  it("lists recent patients first when the query is empty, with masked phones", async () => {
    const { as, user } = setup();
    const page = value(await as(user("Sunita"), SMILE).listPatients({ limit: 10 }));
    expect(page.items).toHaveLength(10);
    expect(page.next_cursor).toBe("10");
    const visits = page.items.map((p) => p.last_visit_at ?? "");
    expect(visits).toEqual([...visits].sort().reverse());
    for (const item of page.items) {
      if (item.phone_masked != null) expect(item.phone_masked).toMatch(/^\+91 ••••• •\d{4}$/);
    }
  });

  it("finds patients by name prefix, clinic number or phone digits", async () => {
    const { as, user, fixtures } = setup();
    const client = as(user("Sunita"), SMILE);
    const target = fixtures.patients.find((p) => p.number === "SC-1005");
    const [first = "", last = ""] = (target?.full_name ?? "").split(" ");

    const byName = value(await client.listPatients({ q: `${last.slice(0, 3)} ${first.slice(0, 2)}` }));
    expect(byName.items.map((p) => p.number)).toContain("SC-1005");

    const byNumber = value(await client.listPatients({ q: "1005" }));
    expect(byNumber.items[0]?.number).toBe("SC-1005");

    const withPhone = fixtures.patients.find((p) => p.number.startsWith("SC-") && p.phone != null);
    const byPhone = value(await client.listPatients({ q: (withPhone?.phone ?? "").slice(-6) }));
    expect(byPhone.items.map((p) => p.id)).toContain(withPhone?.id);
  });

  it("returns an empty page when nothing matches", async () => {
    const { as, user } = setup();
    const page = value(await as(user("Sunita"), SMILE).listPatients({ q: "zzzz qqqq" }));
    expect(page.items).toEqual([]);
    expect(page.next_cursor).toBeNull();
  });
});

describe("fake client: registering a patient", () => {
  it("returns field errors the form can show", async () => {
    const { as, user } = setup();
    const client = as(user("Sunita"), SMILE);
    const bad = await client.createPatient({ full_name: "Asha Rane", sex: "female", phone: "+91123" });
    expect(bad.ok ? null : { code: bad.error.code, field: bad.error.field, status: bad.error.status }).toEqual({
      code: "validation_failed",
      field: "phone",
      status: 422,
    });
  });

  it("assigns the next clinic number, keeps an age estimate, and finds the patient afterwards", async () => {
    const { as, user } = setup();
    const client = as(user("Sunita"), SMILE);
    const created = value(await client.createPatient({ full_name: "Asha  Rane", sex: "female", age_years: 34, phone: "+919811122233" }));
    expect(created.number).toBe("SC-1049");
    expect(created.full_name).toBe("Asha Rane");
    expect(created.birth_date_estimated).toBe(true);
    expect(created.date_of_birth).toBe("1992-01-01");

    const found = value(await client.getPatient(created.number));
    expect(found.id).toBe(created.id);
  });

  it("refuses members without patients.write", async () => {
    const { as, user } = setup();
    expect(errorCode(await as(user("Ravi"), SMILE).createPatient({ full_name: "Asha Rane", sex: "female" }))).toBe("forbidden");
  });
});

describe("fake client: today", () => {
  it("has one patient in the chair and two waiting, measured from as_of", async () => {
    const { as, user } = setup();
    const today = value(await as(user("Farhan"), SMILE).getToday());
    expect(today.date).toBe("2026-10-03");
    expect(today.appointments.filter((a) => a.status === "in_progress")).toHaveLength(1);
    expect(today.appointments.filter((a) => a.status === "arrived")).toHaveLength(2);
    expect(today.money).toBeNull();
  });

  it("includes the day's money only for members with finance.view", async () => {
    const { as, user } = setup();
    const today = value(await as(user("Anika"), SMILE).getToday());
    expect(today.money?.collected_paise).toBe(2_850_000);
  });
});

describe("fake client: console", () => {
  it("is only for the Sakalya team", async () => {
    const { as, user, fixtures } = setup();
    expect(errorCode(await as(null).listClinics())).toBe("unauthenticated");
    expect(errorCode(await as(user("Anika")).listClinics())).toBe("forbidden");
    const admin = fixtures.platformUsers[0] ?? { id: "" };
    expect(value(await as(admin).listClinics()).items.length).toBe(fixtures.clinics.length);
  });

  it("validates new clinics: reserved and taken addresses are slug errors", async () => {
    const { as, fixtures } = setup();
    const admin = as(fixtures.platformUsers[0] ?? { id: "" });
    const base = { name: "Asha Dental", specialty: "dental" as const, owner: { display_name: "Dr. Asha Rane", email: "asha@example.com" } };

    const reserved = await admin.createClinic({ ...base, slug: "admin" });
    expect(reserved.ok ? null : reserved.error.field).toBe("slug");

    const taken = await admin.createClinic({ ...base, slug: "smilecatchers" });
    expect(taken.ok ? null : [taken.error.status, taken.error.field]).toEqual([409, "slug"]);

    const noContact = await admin.createClinic({ ...base, slug: "ashadental", owner: { display_name: "Dr. Asha Rane" } });
    expect(noContact.ok ? null : noContact.error.field).toBe("owner.email");

    const created = value(await admin.createClinic({ ...base, slug: "ashadental" }));
    expect(created.status).toBe("trial");
    expect(created.timezone).toBe("Asia/Kolkata");
    expect(created.domains[0]?.hostname).toBe("ashadental.aarogyam.example");
  });

  it("serves metrics per range, with edge analytics only where connected", async () => {
    const { as, fixtures } = setup();
    const admin = as(fixtures.platformUsers[0] ?? { id: "" });
    const production = value(await admin.getMetrics({ range: "24h", environment: "production" }));
    expect(production.api.series).toHaveLength(24);
    expect(production.api.routes[0]?.route).toMatch(/^\/api\/v1\//);
    expect(production.edge).not.toBeNull();

    const staging = value(await admin.getMetrics({ range: "1h", environment: "staging" }));
    expect(staging.api.series).toHaveLength(12);
    expect(staging.edge).toBeNull();
  });
});

describe("fake client: cancellation", () => {
  it("resolves to an aborted error when the signal is already cancelled", async () => {
    const { as, user } = setup();
    const controller = new AbortController();
    controller.abort();
    expect(errorCode(await as(user("Sunita"), SMILE).listPatients({}, { signal: controller.signal }))).toBe("aborted");
  });
});
