import { describe, expect, it, vi } from "vitest";

import { appointmentId, createHttpClient, timeOffId, type ApiClient, type ApiResult } from "./index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./fake/index.js";

const REQUEST_ID = "0192f1c4-7a10-7c3e-9b2a-1d2e3f405162";
const ID = timeOffId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405170");

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": REQUEST_ID } });
}

const timeOffBody = {
  id: ID,
  membership_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405171",
  member_name: "Dev Doctor",
  starts_at: "2026-10-13T18:30:00Z",
  ends_at: "2026-10-14T18:30:00Z",
  all_day: true,
  status: "approved",
  kind: null,
  reason: null,
  decided_by: null,
  decided_at: null,
  decision_note: null,
};

describe("createHttpClient time-off requests", () => {
  it("sends each route's method, path, query and body, and decodes what comes back", async () => {
    const calls: { url: string; method: string | undefined; body: unknown }[] = [];
    const fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (url.includes("/affected-appointments") || url === "/api/v1/time-off?from=2026-10-01&to=2026-10-31") {
        return Promise.resolve(json(200, { items: url.includes("affected") ? [] : [timeOffBody] }));
      }
      if (url.includes("/settings/staff-ops")) {
        return Promise.resolve(json(200, { time_off: { requires_approval: false }, tasks: { remind_every_minutes: 30 } }));
      }
      return Promise.resolve(json(200, timeOffBody));
    });
    const client = createHttpClient("", () => "abc", { fetch });

    const listed = await client.listTimeOff({ from: "2026-10-01", to: "2026-10-31" });
    expect(listed.ok && listed.value.items[0]?.member_name).toBe("Dev Doctor");
    await client.requestTimeOff({ kind: "sick", first_day: "2026-10-14", last_day: "2026-10-14", reason: "flu" });
    await client.approveTimeOff(ID, { note: "ok" });
    await client.declineTimeOff(ID);
    const cancelled = await client.cancelTimeOff(ID);
    expect(cancelled.ok && cancelled.value.kind).toBeNull();
    const affected = await client.listAffectedAppointments(ID);
    expect(affected.ok && affected.value.items).toEqual([]);
    const settings = await client.getStaffOpsSettings();
    expect(settings.ok && settings.value.time_off.requires_approval).toBe(false);
    await client.updateStaffOpsSettings({ time_off: { requires_approval: true } });

    expect(calls.map((c) => `${c.method ?? "GET"} ${c.url}`)).toEqual([
      "GET /api/v1/time-off?from=2026-10-01&to=2026-10-31",
      "POST /api/v1/time-off",
      `POST /api/v1/time-off/${ID}/approve`,
      `POST /api/v1/time-off/${ID}/decline`,
      `POST /api/v1/time-off/${ID}/cancel`,
      `GET /api/v1/time-off/${ID}/affected-appointments`,
      "GET /api/v1/settings/staff-ops",
      "PATCH /api/v1/settings/staff-ops",
    ]);
    expect(calls[1]?.body).toEqual({ kind: "sick", first_day: "2026-10-14", last_day: "2026-10-14", reason: "flu" });
    expect(calls[2]?.body).toEqual({ note: "ok" });
    expect(calls[3]?.body).toEqual({});
    expect(calls[7]?.body).toEqual({ time_off: { requires_approval: true } });
  });
});

// 11:00 in Pune.
const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const fixtures = createFixtures({ now: NOW });
  const backend = createFakeBackend(fixtures);
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  const sunrise = fixtures.clinics.find((c) => c.host === SUNRISE);
  const membership = (user: string) => fixtures.memberships.find((m) => m.user_id === user && m.clinic_id === sunrise?.id)?.id ?? "";
  const doctor = (user: string) => fixtures.practitioners.find((p) => p.membership_id === membership(user));
  return { as, membership, doctor };
}

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}

const errorOf = <T>(result: ApiResult<T>) => (result.ok ? undefined : result.error);

/** Wednesday 14 October 2026, a week and a half ahead. */
const DAY = "2026-10-14";
const RANGE = { from: "2026-10-01", to: "2026-10-31" };
const WHOLE_DAY = { kind: "sick", first_day: DAY, last_day: DAY, reason: "migraine" } as const;

describe("fake client: time off", () => {
  it("keeps a member's request pending until the owner decides, and approves the owner's entry at once", async () => {
    const { as, membership } = setup();
    const pending = value(await as(DEV).requestTimeOff(WHOLE_DAY));
    expect(pending.status).toBe("pending");
    expect(pending.membership_id).toBe(membership(DEV));
    expect(pending.kind).toBe("sick");

    const set = value(await as(ASHA).requestTimeOff({ kind: "vacation", first_day: "2026-10-20", last_day: "2026-10-21", membership_id: membership(DEV) }));
    expect(set.status).toBe("approved");
    expect(set.decided_by).toBe(membership(ASHA));

    // Someone else's request needs time_off.manage; an unknown member is a 404.
    expect(errorOf(await as(DEV).requestTimeOff({ ...WHOLE_DAY, membership_id: membership(ASHA) }))?.status).toBe(403);
    expect(errorOf(await as(ASHA).requestTimeOff({ ...WHOLE_DAY, membership_id: "nobody" }))?.status).toBe(404);

    const declined = value(await as(ASHA).declineTimeOff(pending.id, { note: "Busy week" }));
    expect(declined.status).toBe("declined");
    expect(declined.decision_note).toBe("Busy week");
    expect(errorOf(await as(ASHA).approveTimeOff(pending.id))?.status).toBe(409);
  });

  it("turns approval off in the settings, and checks them", async () => {
    const { as } = setup();
    expect(value(await as(ASHA).getStaffOpsSettings())).toEqual({ time_off: { requires_approval: true }, tasks: { remind_every_minutes: 60 } });
    expect(errorOf(await as(DEV).getStaffOpsSettings())?.status).toBe(403);
    expect(errorOf(await as(DEV).updateStaffOpsSettings({ time_off: { requires_approval: false } }))?.status).toBe(403);
    expect(errorOf(await as(ASHA).updateStaffOpsSettings({ tasks: { remind_every_minutes: 14 } }))?.status).toBe(400);
    const changed = value(await as(ASHA).updateStaffOpsSettings({ time_off: { requires_approval: false } }));
    expect(changed).toEqual({ time_off: { requires_approval: false }, tasks: { remind_every_minutes: 60 } });
    expect(value(await as(DEV).requestTimeOff(WHOLE_DAY)).status).toBe("approved");
  });

  it("hides kind, reason and open requests from other staff", async () => {
    const { as } = setup();
    const approved = value(await as(DEV).requestTimeOff(WHOLE_DAY));
    const open = value(await as(DEV).requestTimeOff({ kind: "personal", first_day: "2026-10-15", last_day: "2026-10-15", reason: "family" }));
    value(await as(ASHA).approveTimeOff(approved.id, { note: "Rest well" }));

    const seen = value(await as(FARAH).listTimeOff(RANGE)).items;
    expect(seen.map((r) => r.id)).toEqual([approved.id]);
    expect(seen[0]).toMatchObject({ status: "approved", kind: null, reason: null, decided_by: null, decision_note: null });
    expect(seen[0]?.member_name).toBeTruthy();
    expect(JSON.stringify(seen)).not.toMatch(/migraine|family|Rest well/);

    for (const who of [DEV, ASHA]) {
      const items = value(await as(who).listTimeOff(RANGE)).items;
      expect(items.map((r) => r.id)).toEqual([approved.id, open.id]);
      expect(items[0]).toMatchObject({ kind: "sick", reason: "migraine", decision_note: "Rest well" });
    }
    expect(errorOf(await as(FARAH).listTimeOff({ from: "2026-10-01", to: "2026-12-31" }))?.status).toBe(400);
  });

  it("makes an approval block booking for the doctor until it is cancelled", async () => {
    const { as, doctor } = setup();
    const dev = doctor(DEV);
    if (dev === undefined) throw new Error("fixtures hold no doctor for Dev");
    const patient = value(await as(FARAH).listPatients()).items[0];
    if (patient === undefined) throw new Error("fixtures hold no patient");
    const slot = (hour: string) => ({ patient_id: patient.id, practitioner_id: dev.id, starts_at: `${DAY}T${hour}:00+05:30`, ends_at: `${DAY}T${hour.replace(":00", ":30")}:00+05:30` });
    const before = value(await as(FARAH).bookAppointment({ ...slot("10:00"), source: "front_desk" })).appointment.id;

    const request = value(await as(DEV).requestTimeOff(WHOLE_DAY));
    // Pending blocks nothing.
    value(await as(FARAH).bookAppointment(slot("12:00")));
    value(await as(ASHA).approveTimeOff(request.id));

    const refused = await as(FARAH).bookAppointment(slot("14:00"));
    expect(errorOf(refused)).toMatchObject({ status: 422, code: "practitioner_on_leave" });
    const moved = await as(FARAH).changeAppointment(appointmentId.parse(before), { starts_at: `${DAY}T15:00:00+05:30` });
    expect(errorOf(moved)).toMatchObject({ status: 422, code: "practitioner_on_leave" });
    // A note on a booking already inside the leave is fine, and so is another day.
    value(await as(FARAH).changeAppointment(appointmentId.parse(before), { notes: "Call first" }));
    value(await as(FARAH).bookAppointment({ ...slot("10:00"), starts_at: "2026-10-15T10:00:00+05:30", ends_at: "2026-10-15T10:30:00+05:30" }));

    const cancelled = value(await as(DEV).cancelTimeOff(request.id));
    expect(cancelled.status).toBe("cancelled");
    value(await as(FARAH).bookAppointment(slot("14:00")));
  });

  it("lists the affected appointments with free doctors, for the owner only", async () => {
    const { as, doctor } = setup();
    const dev = doctor(DEV);
    const asha = doctor(ASHA);
    if (dev === undefined || asha === undefined) throw new Error("fixtures hold no doctors");
    const patient = value(await as(FARAH).listPatients()).items[0];
    if (patient === undefined) throw new Error("fixtures hold no patient");
    const booked = value(
      await as(FARAH).bookAppointment({ patient_id: patient.id, practitioner_id: dev.id, starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30` }),
    ).appointment;
    const request = value(await as(DEV).requestTimeOff(WHOLE_DAY));

    expect(errorOf(await as(DEV).listAffectedAppointments(request.id))?.status).toBe(403);
    const { items } = value(await as(ASHA).listAffectedAppointments(request.id));
    expect(items.map((a) => a.id)).toEqual([booked.id]);
    expect(items[0]?.practitioner_id).toBe(dev.id);
    expect(items[0]?.suggestions.map((s) => s.practitioner_id)).toEqual([asha.id]);
    expect(items[0]?.suggestions[0]?.in_hours).toBe(true);

    // Once Asha is busy then, she is no longer suggested.
    value(await as(FARAH).bookAppointment({ patient_id: patient.id, practitioner_id: asha.id, starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T10:30:00+05:30` }));
    expect(value(await as(ASHA).listAffectedAppointments(request.id)).items[0]?.suggestions).toEqual([]);
  });

  it("keeps each clinic's requests to itself, and lets only the requester or the owner cancel", async () => {
    const { as } = setup();
    const request = value(await as(DEV).requestTimeOff(WHOLE_DAY));
    const acts: ((c: ApiClient) => Promise<ApiResult<unknown>>)[] = [
      (c: ApiClient) => c.approveTimeOff(request.id),
      (c: ApiClient) => c.declineTimeOff(request.id),
      (c: ApiClient) => c.cancelTimeOff(request.id),
      (c: ApiClient) => c.listAffectedAppointments(request.id),
    ];
    for (const act of acts) {
      expect(errorOf(await act(as(BINA, LOTUS)))?.status).toBe(404);
    }
    expect(value(await as(BINA, LOTUS).listTimeOff(RANGE)).items).toEqual([]);
    // To another member it does not exist; the owner may cancel; twice is a conflict.
    expect(errorOf(await as(FARAH).cancelTimeOff(request.id))?.status).toBe(404);
    expect(value(await as(ASHA).cancelTimeOff(request.id)).status).toBe("cancelled");
    expect(errorOf(await as(DEV).cancelTimeOff(request.id))?.status).toBe(409);
  });

  it("refuses bad windows, kinds and reasons", async () => {
    const { as } = setup();
    for (const body of [
      { kind: "sick" },
      { kind: "nap", first_day: DAY, last_day: DAY },
      { kind: "sick", first_day: "2026-10-15", last_day: DAY },
      { kind: "sick", starts_at: `${DAY}T10:00:00+05:30` },
      { kind: "sick", starts_at: `${DAY}T10:00:00+05:30`, ends_at: `${DAY}T09:00:00+05:30` },
      { kind: "sick", first_day: DAY, last_day: DAY, reason: "x".repeat(201) },
    ]) {
      expect(errorOf(await as(DEV).requestTimeOff(body))?.status, JSON.stringify(body)).toBe(400);
    }
  });
});
