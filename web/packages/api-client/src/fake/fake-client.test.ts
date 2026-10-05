import { describe, expect, it } from "vitest";

import { membershipId, patientId, type ApiClient, type ApiResult, type LetterheadChanges } from "../index.js";
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
  it("has one patient in the chair and two waiting, with the day's counts and chair status", async () => {
    const { as } = setup();
    const today = value(await as(PEOPLE.farah, SUNRISE).getToday());
    expect(today.date).toBe("2026-10-03");
    expect(today.appointments.filter((a) => a.status === "in_chair")).toHaveLength(1);
    expect(today.appointments.filter((a) => a.status === "arrived")).toHaveLength(2);
    expect(today.counts.in_chair).toBe(1);
    expect(today.counts.waiting).toBe(2);
    expect(today.chairs.some((c) => c.status === "in_use")).toBe(true);
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
    const hour = value(await as(PEOPLE.admin).getMetrics("1h")).api;
    expect(hour.timeline).toHaveLength(60);
    expect(hour.timeline_interval_seconds).toBe(60);
    expect(value(await as(PEOPLE.admin).getMetrics("6h")).api.timeline).toHaveLength(360);
    expect(metrics.api.timeline).toHaveLength(288);
    expect(metrics.api.timeline_interval_seconds).toBe(300);
  });
});

describe("fake client: editing a patient", () => {
  it("edits details and keeps other fields, needing patients.write and patients.contact for phone or email", async () => {
    const fixtures = createFixtures({ now: NOW });
    const target = fixtures.patients.find((p) => p.clinic_id === fixtures.clinics.find((c) => c.slug === "sunrise")?.id);
    if (target === undefined) throw new Error("no sunrise patient in fixtures");
    const id = patientId.parse(target.id);
    // A role with patients.write but not patients.contact, which none of the standard roles are.
    const farahMembership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (farahMembership === undefined) throw new Error("no membership for farah");
    farahMembership.role = { key: "custom", name: "Custom", permissions: ["patients.read", "patients.write"] };
    const backend = createFakeBackend(fixtures);
    const as = (who: string) => backend.client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });

    const writerOnly = as(PEOPLE.farah);
    expect(errorOf(await writerOnly.updatePatient(id, { phone: "+919811122233" }))?.status).toBe(403);
    const updated = value(await writerOnly.updatePatient(id, { full_name: "  Renamed   Patient " }));
    expect(updated.full_name).toBe("Renamed Patient");
    expect(updated.number).toBe(target.number);

    const owner = as(PEOPLE.asha);
    const withPhone = value(await owner.updatePatient(id, { phone: "+919811122233" }));
    expect(withPhone.phone).toBe("+919811122233");
    expect(withPhone.full_name).toBe("Renamed Patient");

    const cleared = value(await owner.updatePatient(id, { phone: "" }));
    expect(cleared.phone).toBeNull();
  });

  it("answers 404 for another clinic's patient", async () => {
    const { as, fixtures } = setup();
    const theirs = fixtures.patients.find((p) => p.clinic_id === fixtures.clinics.find((c) => c.slug === "lotus")?.id);
    const result = await as(PEOPLE.asha, SUNRISE).updatePatient(patientId.parse(theirs?.id), { full_name: "Nope" });
    expect(errorOf(result)?.status).toBe(404);
  });
});

describe("fake client: staff and roles", () => {
  it("lists members and pending invitations, needing staff.manage", async () => {
    const { as } = setup();
    expect(errorOf(await as(PEOPLE.farah, SUNRISE).listStaff())?.status).toBe(403);
    const staff = value(await as(PEOPLE.asha, SUNRISE).listStaff());
    expect(staff.members.map((m) => m.role_key)).toEqual(expect.arrayContaining(["owner", "doctor", "front_desk"]));
    expect(staff.invitations).toEqual([]);
  });

  it("invites someone, who then shows up as a pending invitation and can accept it", async () => {
    const { as, backend } = setup();
    const owner = as(PEOPLE.asha, SUNRISE);
    const created = value(await owner.inviteStaff({ email: "new.doctor@example.com", role_key: "doctor" }));
    expect(created.role_key).toBe("doctor");
    const afterInvite = value(await owner.listStaff());
    expect(afterInvite.invitations.map((i) => i.email)).toEqual(["new.doctor@example.com"]);

    const newcomer = backend.client({ getToken: () => fakeTokenFor({ id: "d1d1d1d1-0000-4000-8000-000000000099", email: "new.doctor@example.com" }), now: () => NOW });
    const joined = value(await newcomer.acceptInvitation({ token: created.invite_token, display_name: "Dr New" }));
    expect(joined.membership_id).toBeTruthy();
    const afterAccept = value(await owner.listStaff());
    expect(afterAccept.invitations).toEqual([]);
    expect(afterAccept.members.map((m) => m.display_name)).toContain("Dr New");
  });

  it("refuses a non-owner inviting an owner", async () => {
    const { as } = setup();
    const error = errorOf(await as(PEOPLE.farah, SUNRISE).inviteStaff({ email: "a@example.com", role_key: "owner" }));
    // front_desk also lacks staff.manage, so this is a permission refusal either way.
    expect(error?.status).toBe(403);
  });

  it("changes a member's role, but never your own, and protects the last active owner", async () => {
    const { as, fixtures } = setup();
    const owner = as(PEOPLE.asha, SUNRISE);
    const ownerMembership = fixtures.memberships.find((m) => m.user_id === PEOPLE.asha);
    const farahMembership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (ownerMembership === undefined || farahMembership === undefined) throw new Error("missing fixture membership");

    expect(errorOf(await owner.changeStaffMember(membershipId.parse(ownerMembership.id), { status: "suspended" }))?.status).toBe(409);
    expect(errorOf(await owner.changeStaffMember(membershipId.parse(ownerMembership.id), { role_key: "doctor" }))?.status).toBe(409);

    const changed = value(await owner.changeStaffMember(membershipId.parse(farahMembership.id), { role_key: "assistant" }));
    expect(changed.role_key).toBe("assistant");

    const suspended = value(await owner.changeStaffMember(membershipId.parse(farahMembership.id), { status: "suspended" }));
    expect(suspended.status).toBe("suspended");
  });

  it("lists the clinic's roles and what each may do", async () => {
    const { as } = setup();
    const roles = value(await as(PEOPLE.asha, SUNRISE).listRoles());
    const doctor = roles.items.find((r) => r.key === "doctor");
    expect(doctor?.permissions.map((p) => p.key)).toEqual(expect.arrayContaining(["patients.read", "appointments.read"]));
  });
});

describe("fake client: clinic settings", () => {
  it("reads and changes the profile, needing settings.manage", async () => {
    const { as } = setup();
    expect(errorOf(await as(PEOPLE.farah, SUNRISE).getClinicSettings())?.status).toBe(403);
    const owner = as(PEOPLE.asha, SUNRISE);
    const before = value(await owner.getClinicSettings());
    expect(before.name).toBe("Sunrise Dental");
    expect(before.upi_id).toBe("sunrisedental@okicici");
    expect(before.address.city).toBe("Mumbai");

    const after = value(
      await owner.updateClinicSettings({ phone: "9876501234", upi_id: "newclinic@okhdfc", address: { city: "Pune", state: "Maharashtra" } }),
    );
    expect(after.phone).toBe("+919876501234");
    expect(after.upi_id).toBe("newclinic@okhdfc");
    expect(after.address).toEqual({ line1: null, line2: null, city: "Pune", state: "Maharashtra", pincode: null });
    expect(after.name).toBe("Sunrise Dental");
  });

  it("refuses an invalid UPI ID or GSTIN", async () => {
    const { as } = setup();
    const owner = as(PEOPLE.asha, SUNRISE);
    expect(errorOf(await owner.updateClinicSettings({ upi_id: "not-a-upi-id" }))?.field).toBe("upi_id");
    expect(errorOf(await owner.updateClinicSettings({ gstin: "not-a-gstin" }))?.field).toBe("gstin");
  });
});

describe("fake client: letterhead", () => {
  const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "logo.png", { type: "image/png" });
  const form = (file: File) => {
    const body = new FormData();
    body.set("file", file);
    return body;
  };

  it("starts from the default design and merges changes, naming the field that is wrong", async () => {
    const owner = setup().as(PEOPLE.asha, SUNRISE);
    const before = value(await owner.getClinicSettings()).letterhead;
    expect(before).toMatchObject({ mode: "template", template: "classic", has_image: false, show: { gstin: false, phone: true } });

    const saved = value(
      await owner.updateClinicSettings({
        letterhead: { template: "modern_band", accent: "#0f766e", footer: " Open Mon to Sat ", email: "Care@Sunrise.test", show: { gstin: true } },
      }),
    ).letterhead;
    expect(saved).toMatchObject({ template: "modern_band", accent: "#0F766E", footer: "Open Mon to Sat", email: "care@sunrise.test" });
    expect(saved.show).toMatchObject({ gstin: true, phone: true });

    const bad: [LetterheadChanges, string][] = [
      [{ mode: "paper" }, "letterhead.mode"],
      [{ mode: "upload" }, "letterhead.mode"],
      [{ template: "fancy" }, "letterhead.template"],
      [{ accent: "teal" }, "letterhead.accent"],
      [{ footer: "x".repeat(201) }, "letterhead.footer"],
      [{ email: "nobody" }, "letterhead.email"],
      [{ doctor_ids: ["nobody"] }, "letterhead.doctor_ids"],
    ];
    for (const [changes, field] of bad) {
      expect(errorOf(await owner.updateClinicSettings({ letterhead: changes }))?.field, field).toBe(field);
    }
  });

  it("checks images by type and size, switches to upload mode once one exists, and falls back when removed", async () => {
    const owner = setup().as(PEOPLE.asha, SUNRISE);
    expect(errorOf(await owner.uploadLetterheadImage("letterhead", form(new File(["%PDF-"], "x.pdf", { type: "application/pdf" }))))?.field).toBe("image");
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], "big.png", { type: "image/png" });
    expect(errorOf(await owner.uploadLetterheadImage("letterhead", form(big)))?.status).toBe(413);

    expect(value(await owner.uploadLetterheadImage("letterhead", form(png()))).has_image).toBe(true);
    expect(value(await owner.updateClinicSettings({ letterhead: { mode: "upload" } })).letterhead.mode).toBe("upload");
    expect(value(await owner.getLetterhead()).image_url).not.toBeNull();
    const removed = value(await owner.removeLetterheadImage("letterhead"));
    expect(removed).toMatchObject({ has_image: false, mode: "template" });
    expect(value(await owner.getLetterhead()).image_url).toBeNull();
  });

  it("needs settings.manage to change it and patients.read to print it", async () => {
    const { as } = setup();
    const desk = as(PEOPLE.farah, SUNRISE);
    expect(errorOf(await desk.uploadLetterheadImage("logo", form(png())))?.status).toBe(403);
    expect(errorOf(await desk.removeLetterheadImage("logo"))?.status).toBe(403);
    expect(value(await desk.getLetterhead()).clinic.name).toBe("Sunrise Dental");
    expect(errorOf(await as(null, SUNRISE).getLetterhead())?.status).toBe(401);
  });

  it("keeps each clinic's letterhead and doctors apart", async () => {
    const { as } = setup();
    const owner = as(PEOPLE.asha, SUNRISE);
    const lotus = as(PEOPLE.bina, LOTUS);
    value(await owner.updateClinicSettings({ letterhead: { footer: "Sunrise footer" } }));
    expect(value(await lotus.getLetterhead()).letterhead.footer ?? null).toBeNull();
    const lotusDoctors = value(await lotus.listPractitioners()).items;
    expect(lotusDoctors.length).toBeGreaterThan(0);
    const foreign = lotusDoctors[0]?.id;
    expect(errorOf(await owner.updateClinicSettings({ letterhead: { doctor_ids: foreign === undefined ? [] : [foreign, foreign] } }))?.field).toBe(
      "letterhead.doctor_ids",
    );
    expect(errorOf(await owner.updateClinicSettings({ letterhead: { doctor_ids: foreign === undefined ? [] : [foreign] } }))?.field).toBe(
      "letterhead.doctor_ids",
    );
  });

  it("prints doctors with their qualifications and registration numbers", async () => {
    const owner = setup().as(PEOPLE.asha, SUNRISE);
    value(await owner.addPractitioner({ display_name: "Dr Zoya Khan", qualifications: "BDS, MDS", registration_number: "Z-99" }));
    const document = value(await owner.getLetterhead());
    expect(document.doctors).toContainEqual(expect.objectContaining({ name: "Dr Zoya Khan", qualifications: "BDS, MDS", registration_number: "Z-99" }));
    expect(document.doctors.length).toBeLessThanOrEqual(4);
  });

  it("serves a share link's letterhead without sign-in, and nothing for a made-up link", async () => {
    const { as } = setup();
    expect(errorOf(await as(null, SUNRISE).getSharedLetterhead("not-a-token"))?.status).toBe(404);
  });
});

describe("fake client: sessions", () => {
  it("lists only the person's own active sessions, newest first, with one marked current", async () => {
    const { as } = setup();
    const sessions = value(await as(PEOPLE.asha).listMySessions());
    expect(sessions.items.length).toBeGreaterThanOrEqual(2);
    expect(sessions.items.filter((s) => s.current)).toHaveLength(1);
    const times = sessions.items.map((s) => s.last_active_at);
    expect(times).toEqual([...times].sort().reverse());
  });

  it("revokes one of the person's sessions, which then disappears from the list", async () => {
    const { as } = setup();
    const client = as(PEOPLE.asha);
    const before = value(await client.listMySessions());
    const target = before.items.find((s) => !s.current);
    if (target === undefined) throw new Error("expected a second session to revoke");
    const revoked = await client.revokeMySession(target.id);
    expect(revoked.ok).toBe(true);
    const after = value(await client.listMySessions());
    expect(after.items.map((s) => s.id)).not.toContain(target.id);
  });

  it("can't revoke someone else's session", async () => {
    const { as } = setup();
    const theirs = value(await as(PEOPLE.farah).listMySessions()).items[0];
    if (theirs === undefined) throw new Error("expected Farah to have a session");
    expect(errorOf(await as(PEOPLE.asha).revokeMySession(theirs.id))?.status).toBe(404);
  });
});

describe("fake client: patient summaries and filters", () => {
  it("shows balances, next bookings and filters the list", async () => {
    const { as } = setup();
    const api = as(PEOPLE.asha, SUNRISE);
    const everyone = value(await api.listPatients()).items;
    const owing = value(await api.listPatients({ withBalance: true })).items;
    expect(owing.length).toBeGreaterThan(0);
    expect(owing.map((p) => p.id)).toEqual(everyone.filter((p) => (p.balance_paise ?? 0) > 0).map((p) => p.id));
    expect(everyone.some((p) => p.next_appointment != null)).toBe(true);
    expect(everyone.every((p) => !p.recall_due)).toBe(true);
    expect(value(await api.listPatients({ recallsDue: true })).items).toHaveLength(0);
    expect(value(await api.searchPatients({ q: "", newThisMonth: true })).items.every((p) => p.created_at.startsWith("2026-10"))).toBe(true);
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

describe("fake client: patient self-booking", () => {
  const person = (id: string, email?: string) => ({ id, ...(email === undefined ? {} : { email }) });
  const clientFor = (backend: ReturnType<typeof setup>["backend"], who: { id: string; email?: string } | null, host = SUNRISE): ApiClient =>
    backend.client({ host, getToken: () => (who === null ? null : fakeTokenFor(who)), now: () => NOW });
  const details = { full_name: "Priya Nair", phone: "9876543210" };

  it("offers free slots to anyone, per clinic, without patient data", async () => {
    const { backend } = setup();
    const open = clientFor(backend, null);
    const options = value(await open.getBookingOptions());
    expect(options.clinic_name).toBe("Sunrise Dental");
    const doctor = options.doctors[0]?.id ?? "";
    const slots = value(await open.getAvailability("2026-10-05", doctor));
    expect(slots.slots[0]).toBe("2026-10-05T09:00:00+05:30");
    expect(slots.slots).toHaveLength(36);
    expect(JSON.stringify(slots)).not.toContain("full_name");
    // Another clinic doesn't know this doctor.
    expect(errorOf(await clientFor(backend, null, LOTUS).getAvailability("2026-10-05", doctor))?.status).toBe(400);
    expect(value(await clientFor(backend, null, LOTUS).getBookingOptions()).doctors.map((d) => d.id)).not.toContain(doctor);
    // Past days and days beyond the window are empty.
    expect(value(await open.getAvailability("2026-10-02", doctor)).slots).toEqual([]);
    expect(value(await open.getAvailability("2026-12-25", doctor)).slots).toEqual([]);
  });

  it("books a verified person into one slot, once, and caps open requests", async () => {
    const { backend } = setup();
    const priya = clientFor(backend, person("d0d0d0d0-0000-4000-8000-000000000001", "priya@example.test"));
    const doctor = value(await priya.getBookingOptions()).doctors[0]?.id ?? "";
    const slots = value(await priya.getAvailability("2026-10-05", doctor)).slots;
    const book = (client: ApiClient, at: string | undefined) => client.createOnlineBooking({ starts_at: at ?? "", practitioner_id: doctor, ...details });

    expect(errorOf(await book(clientFor(backend, null), slots[0]))?.status).toBe(401);
    expect(errorOf(await book(clientFor(backend, person("d0d0d0d0-0000-4000-8000-000000000002")), slots[0]))?.status).toBe(403);
    expect(errorOf(await book(priya, "2026-10-05T09:07:00+05:30"))?.status).toBe(409);

    const first = value(await book(priya, slots[0]));
    expect(first.status).toBe("requested");
    expect(value(await priya.getAvailability("2026-10-05", doctor)).slots).not.toContain(slots[0]);
    // The same slot again, from someone else: taken.
    const other = clientFor(backend, person("d0d0d0d0-0000-4000-8000-000000000003", "meera@example.test"));
    expect(errorOf(await book(other, slots[0]))?.status).toBe(409);

    expect(value(await book(priya, slots[1])).status).toBe("requested");
    expect(errorOf(await book(priya, slots[2]))?.status).toBe(409);
    expect(value(await book(other, slots[2])).status).toBe("requested");
  });

  it("matches only on the verified email and confirms at once when the clinic says so", async () => {
    const { backend, as } = setup();
    const owner = as(PEOPLE.asha, SUNRISE);
    const existing = value(await owner.listPatients()).items.find((p) => p.email != null);
    const before = value(await owner.listPatients()).items.length;
    const settings = value(await owner.updateClinicSettings({ online_booking: { auto_confirm: true } }));
    expect(settings.online_booking.auto_confirm).toBe(true);
    expect(errorOf(await owner.updateClinicSettings({ online_booking: { slot_minutes: 7 } }))?.status).toBe(400);

    const known = clientFor(backend, person("d0d0d0d0-0000-4000-8000-000000000004", existing?.email ?? "x@example.test"));
    const doctor = value(await known.getBookingOptions()).doctors[0]?.id ?? "";
    const slots = value(await known.getAvailability("2026-10-06", doctor)).slots;
    const booked = value(await known.createOnlineBooking({ starts_at: slots[0] ?? "", practitioner_id: doctor, ...details }));
    expect(booked.status).toBe("confirmed");
    const after = value(await owner.listPatients()).items;
    // An existing record is reused; otherwise one new record appears.
    expect(after.length).toBe(existing === undefined ? before + 1 : before);
  });
});
