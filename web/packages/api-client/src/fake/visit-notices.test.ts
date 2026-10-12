import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { appointmentId, invoiceId, unwrap } from "../index.js";
import { ROLES, createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";
import type { Fixtures } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z"); // a Saturday, 11:00 in India
const SUNRISE = "sunrise.localtest.me";
const LOTUS = "lotus.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001"; // owner, and a doctor at Sunrise
const DEV = "a1a1a1a1-0000-4000-8000-000000000002"; // doctor
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003"; // front desk
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";
const ARUN = "a1a1a1a1-0000-4000-8000-0000000000a5"; // assistant, added by the test

function setup(adjust?: (fixtures: Fixtures) => void) {
  const fixtures = createFixtures({ now: NOW });
  const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
  if (sunrise === undefined) throw new Error("expected the sunrise clinic");
  fixtures.users.push({ id: ARUN, display_name: "Arun Nair", description: "Assistant at Sunrise Dental." });
  fixtures.memberships.push({ id: "0192f1c4-7a10-7c3e-9b2a-0000000a5a5a", user_id: ARUN, clinic_id: sunrise.id, role: ROLES.assistant });
  adjust?.(fixtures);
  const backend = createFakeBackend(fixtures);
  const as = (who: string, host = SUNRISE): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
  return { fixtures, as, sunrise };
}

const status = <T>(result: ApiResult<T>): number => (result.ok ? 200 : result.error.status);

/** The kinds of the visit notices a member's bell lists. */
async function bell(api: ApiClient, kinds = ["patient_waiting", "send_in", "collect_payment", "arrival"]) {
  const list = await unwrap(api.listNotifications());
  return list.items.filter((n) => kinds.includes(n.kind));
}

/** The badge must be the list's own unread rows: not read, and not handled when actionable. */
async function expectBadgeMatchesList(api: ApiClient) {
  const items = (await unwrap(api.listNotifications())).items;
  const counted = items.filter((n) => !n.read && !(["patient_waiting", "send_in", "collect_payment", "arrival"].includes(n.kind) && n.handled != null));
  expect((await unwrap(api.countUnreadNotifications())).unread).toBe(counted.length);
  expect((await unwrap(api.listNotifications({ unreadOnly: true }))).items.map((n) => n.id).sort()).toEqual(counted.map((n) => n.id).sort());
}

async function walkIn(api: ApiClient, name: string, practitionerId?: string) {
  const made = await unwrap(api.registerWalkIn({ patient: { full_name: name }, ...(practitionerId === undefined ? {} : { practitioner_id: practitionerId }) }));
  return made.token;
}

function practitionerOf(fixtures: Fixtures, userId: string): string {
  const membership = fixtures.memberships.find((m) => m.user_id === userId && m.clinic_id === fixtures.clinics.find((c) => c.slug === "sunrise")?.id);
  const practitioner = fixtures.practitioners.find((p) => p.membership_id === membership?.id);
  if (practitioner === undefined) throw new Error("expected a practitioner");
  return practitioner.id;
}

describe("a patient waiting (fake)", () => {
  it("a walk-in tells the assigned doctor only, with the token and no patient field, and writes no arrival", async () => {
    const { fixtures, as } = setup();
    const token = await walkIn(as(FARAH), "Meera Iyer", practitionerOf(fixtures, DEV));
    const dev = await bell(as(DEV));
    expect(dev).toHaveLength(1);
    expect(dev[0]).toMatchObject({ kind: "patient_waiting", audience: "doctor", href: "/queue", queue_token: { id: token.id, number: token.token_number } });
    expect(dev[0] && "patient" in dev[0]).toBe(false);
    // The owner is a doctor too, but the token is Dev's; the desk and the assistant have no clinical reach.
    expect(await bell(as(ASHA))).toHaveLength(0);
    expect(await bell(as(FARAH))).toHaveLength(0);
    expect(await bell(as(ARUN))).toHaveLength(0);
    expect((await bell(as(DEV), ["arrival"])).length).toBe(0);
  });

  it("with no doctor assigned the doctors on duty see it, and a doctor on leave does not", async () => {
    const { as } = setup((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      if (sunrise === undefined) throw new Error("expected the sunrise clinic");
      fixtures.leave.push({ id: "0192f1c4-7a10-7c3e-9b2a-0000000000e1", clinic_id: sunrise.id, practitioner_id: practitionerOf(fixtures, DEV), starts_at: "2026-10-03T00:00:00Z", ends_at: "2026-10-04T00:00:00Z" });
    });
    await walkIn(as(FARAH), "Ravi Kumar");
    expect(await bell(as(ASHA))).toHaveLength(1);
    expect(await bell(as(DEV))).toHaveLength(0);
    expect(await bell(as(FARAH))).toHaveLength(0);
  });

  it("with nobody on duty everyone who can write clinical records sees it", async () => {
    const { as } = setup((fixtures) => {
      fixtures.workingShifts = [];
    });
    await walkIn(as(FARAH), "Ravi Kumar");
    expect(await bell(as(ASHA))).toHaveLength(1);
    expect(await bell(as(DEV))).toHaveLength(1);
    expect(await bell(as(FARAH))).toHaveLength(0);
  });

  it("follows a doctor who is on duty only at another branch's hours", async () => {
    const { as } = setup((fixtures) => {
      const dev = practitionerOf(fixtures, DEV);
      for (const shift of fixtures.workingShifts.filter((s) => s.practitioner_id === dev)) shift.branch_id = "0192f1c4-7a10-7c3e-9b2a-0000000000b2";
    });
    await walkIn(as(FARAH), "Ravi Kumar");
    expect(await bell(as(ASHA))).toHaveLength(1);
    expect(await bell(as(DEV))).toHaveLength(0);
  });

  it("a check-in writes one patient_waiting and no arrival", async () => {
    const { fixtures, as } = setup();
    const booked = fixtures.appointments.find((a) => a.clinic_id === fixtures.clinics.find((c) => c.slug === "sunrise")?.id && (a.status === "booked" || a.status === "confirmed"));
    if (booked === undefined) throw new Error("expected a booked appointment");
    const before = (await bell(as(FARAH), ["arrival"])).length;
    const changed = await unwrap(as(FARAH).setAppointmentStatus(appointmentId.parse(booked.id), { status: "arrived" }));
    // The appointment's own doctor is told, once; the desk is not told of an arrival.
    const told = [...(await bell(as(ASHA), ["patient_waiting"])), ...(await bell(as(DEV), ["patient_waiting"]))].filter((n) => n.queue_token?.id === changed.queue_token_id);
    expect(told).toHaveLength(1);
    expect((await bell(as(FARAH), ["arrival"])).length).toBe(before);
  });

  it("calling the patient sends in and settles the waiting notice, which then stops counting as unread", async () => {
    const { fixtures, as } = setup();
    const token = await walkIn(as(FARAH), "Meera Iyer", practitionerOf(fixtures, DEV));
    const dev = as(DEV);
    const seeded = (await unwrap(dev.countUnreadNotifications())).unread - 1;
    await unwrap(dev.callQueueToken(token.id));
    const rows = await bell(dev);
    expect(rows.map((n) => n.kind).sort()).toEqual(["patient_waiting", "send_in"]);
    const waiting = rows.find((n) => n.kind === "patient_waiting");
    expect(waiting?.handled).toMatchObject({ name: "Dr Dev Rao" });
    expect(rows.find((n) => n.kind === "send_in")).toMatchObject({ audience: "doctor", queue_token: { id: token.id } });
    await expectBadgeMatchesList(dev);
    expect((await unwrap(dev.countUnreadNotifications())).unread).toBe(seeded + 1);
    // A handled row is listed but is not unread; the send-in row still is.
    expect((await unwrap(dev.listNotifications({ unreadOnly: true }))).items.map((n) => n.kind)).not.toContain("patient_waiting");
    expect((await unwrap(dev.markAllNotificationsRead())).marked).toBeGreaterThanOrEqual(1);
    await expectBadgeMatchesList(dev);
  });

  it("answers the same rows to another clinic: none", async () => {
    const { as } = setup();
    await walkIn(as(FARAH), "Meera Iyer");
    expect(await bell(as(BINA, LOTUS))).toHaveLength(0);
  });
});

describe("money to collect (fake)", () => {
  async function toBill(as: ReturnType<typeof setup>["as"], fixtures: Fixtures) {
    // The fee needs billing.write, as on the API, so the owner (also a doctor) closes the visit.
    const doctor = as(ASHA);
    const token = await walkIn(as(FARAH), "Neha Rao", practitionerOf(fixtures, DEV));
    const started = await unwrap(doctor.startVisitFromQueue(token.id));
    return { token, visit: started.visit, doctor };
  }

  it("a ready_to_bill close with a fee tells the desk, the assistant and the owner, not the doctor", async () => {
    const { fixtures, as } = setup();
    const { token, visit, doctor } = await toBill(as, fixtures);
    expect(await bell(as(FARAH), ["collect_payment"])).toHaveLength(0);
    const closed = await unwrap(doctor.closeVisitWith(visit.id, { fee_paise: 50000, queue_status: "ready_to_bill" }));
    const bill = closed.invoice;
    if (bill == null) throw new Error("expected a bill");
    for (const who of [FARAH, ARUN, ASHA]) {
      const rows = await bell(as(who), ["collect_payment"]);
      expect(rows, who).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        audience: "front_desk",
        href: `/billing/invoices/${bill.id}`,
        queue_token: { id: token.id, number: token.token_number },
        invoice: { id: bill.id, total_paise: 50000, balance_paise: 50000 },
      });
    }
    expect(await bell(as(DEV), ["collect_payment"])).toHaveLength(0);
    expect(status(await as(BINA, LOTUS).listNotifications())).toBe(200);
    expect(await bell(as(BINA, LOTUS), ["collect_payment"])).toHaveLength(0);
  });

  it("a doctor holding only billing.read does not see it", async () => {
    const { fixtures, as } = setup((f) => {
      const dev = f.memberships.find((m) => m.user_id === DEV);
      if (dev === undefined) throw new Error("expected Dev's membership");
      dev.role = { ...dev.role, permissions: [...dev.role.permissions, "billing.read"] };
    });
    const { visit, doctor } = await toBill(as, fixtures);
    await unwrap(doctor.closeVisitWith(visit.id, { fee_paise: 50000, queue_status: "ready_to_bill" }));
    expect(await bell(as(DEV), ["collect_payment"])).toHaveLength(0);
  });

  it("Done writes nothing, and a bare close with no bill writes nothing", async () => {
    const { fixtures, as } = setup();
    const one = await toBill(as, fixtures);
    await unwrap(one.doctor.closeVisitWith(one.visit.id, { fee_paise: 50000, queue_status: "done" }));
    const two = await toBill(as, fixtures);
    await unwrap(two.doctor.closeVisitWith(two.visit.id, { queue_status: "ready_to_bill" }));
    expect(await bell(as(FARAH), ["collect_payment"])).toHaveLength(0);
  });

  it("works with no token, writes once, and settles the bill's payment_due", async () => {
    const { fixtures, as, sunrise } = setup();
    const patient = (await unwrap(as(ASHA).listPatients())).items[0];
    if (patient === undefined) throw new Error("expected a patient");
    const visit = await unwrap(as(ASHA).startVisit(patient.id, {}));
    const closed = await unwrap(as(ASHA).closeVisitWith(visit.id, { fee_paise: 30000, queue_status: "ready_to_bill" }));
    const bill = closed.invoice;
    if (bill == null) throw new Error("expected a bill");
    fixtures.notifications = [
      ...(fixtures.notifications ?? []),
      { id: "0192f1c4-7a10-7c3e-9b2a-000000000b01", clinic_id: sunrise.id, kind: "payment_due", created_at: NOW.toISOString(), invoice_id: bill.id, href: null },
    ];
    const rows = await bell(as(FARAH), ["collect_payment"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.queue_token ?? null).toBeNull();
    expect(rows[0]).toMatchObject({ audience: "front_desk", invoice: { id: bill.id, balance_paise: 30000 } });
  });

  it("settles on a full payment but not a part payment, and a collector without billing access can take it", async () => {
    const { fixtures, as } = setup();
    const { visit, doctor } = await toBill(as, fixtures);
    const closed = await unwrap(doctor.closeVisitWith(visit.id, { fee_paise: 50000, queue_status: "ready_to_bill" }));
    const bill = closed.invoice;
    if (bill == null) throw new Error("expected a bill");
    const assistant = as(ARUN);
    expect(status(await assistant.getInvoice(bill.id))).toBe(403);
    const pay = (amount: number, key: string) =>
      assistant.recordPayment({ patient_id: bill.patient.id, method: "cash", amount_paise: amount, allocations: [{ invoice_id: bill.id, amount_paise: amount }] }, key);
    expect(status(await pay(20000, "key-part-000001"))).toBe(200);
    let row = (await bell(assistant, ["collect_payment"]))[0];
    expect(row?.handled ?? null).toBeNull();
    expect(row?.invoice?.balance_paise).toBe(30000);
    await expectBadgeMatchesList(assistant);
    expect(status(await pay(30000, "key-full-000002"))).toBe(200);
    row = (await bell(assistant, ["collect_payment"]))[0];
    expect(row?.handled).toMatchObject({ name: "Arun Nair" });
    expect(row?.invoice?.balance_paise).toBe(0);
    await expectBadgeMatchesList(assistant);
    await expectBadgeMatchesList(as(FARAH));
  });

  it("a token finishing as done or left, or a voided bill, settles it", async () => {
    const { fixtures, as } = setup();
    const a = await toBill(as, fixtures);
    await unwrap(a.doctor.closeVisitWith(a.visit.id, { fee_paise: 50000, queue_status: "ready_to_bill" }));
    expect((await bell(as(FARAH), ["collect_payment"]))[0]?.handled ?? null).toBeNull();
    await unwrap(as(FARAH).setQueueStatus(a.token.id, { status: "done" }));
    expect((await bell(as(FARAH), ["collect_payment"]))[0]?.handled).toBeTruthy();

    const b = await toBill(as, fixtures);
    const closed = await unwrap(b.doctor.closeVisitWith(b.visit.id, { fee_paise: 40000, queue_status: "ready_to_bill" }));
    const second = (await bell(as(FARAH), ["collect_payment"])).find((n) => n.invoice?.id === closed.invoice?.id);
    expect(second?.handled ?? null).toBeNull();
    await unwrap(as(ASHA).issueInvoice(invoiceId.parse(closed.invoice?.id)));
    await unwrap(as(ASHA).voidInvoice(invoiceId.parse(closed.invoice?.id), { reason: "entered twice" }));
    expect((await bell(as(FARAH), ["collect_payment"])).find((n) => n.invoice?.id === closed.invoice?.id)?.handled).toBeTruthy();
    await expectBadgeMatchesList(as(FARAH));
  });
});

describe("collect summary (fake)", () => {
  it("answers the number, total, balance and UPI link to a collector, and 403, 404 and 409 otherwise", async () => {
    const { fixtures, as } = setup();
    const token = await walkIn(as(FARAH), "Neha Rao", practitionerOf(fixtures, DEV));
    const started = await unwrap(as(ASHA).startVisitFromQueue(token.id));
    const closed = await unwrap(as(ASHA).closeVisitWith(started.visit.id, { fee_paise: 50000, queue_status: "ready_to_bill" }));
    const bill = closed.invoice;
    if (bill == null) throw new Error("expected a bill");
    const summary = await unwrap(as(ARUN).getInvoiceCollectSummary(invoiceId.parse(bill.id)));
    expect(summary).toMatchObject({ invoice_id: bill.id, total_paise: 50000, balance_paise: 50000 });
    expect(summary.upi_link?.amount_paise).toBe(50000);
    expect(status(await as(DEV).getInvoiceCollectSummary(invoiceId.parse(bill.id)))).toBe(403);
    expect(status(await as(BINA, LOTUS).getInvoiceCollectSummary(invoiceId.parse(bill.id)))).toBe(404);
    await unwrap(as(ASHA).issueInvoice(invoiceId.parse(bill.id)));
    await unwrap(as(ASHA).voidInvoice(invoiceId.parse(bill.id), { reason: "entered twice" }));
    expect(status(await as(ARUN).getInvoiceCollectSummary(invoiceId.parse(bill.id)))).toBe(409);
  });
});

describe("roles (fake)", () => {
  it("gives the assistant, the front desk and the owner payments.collect, and the doctor not", () => {
    expect(ROLES.assistant.permissions).toContain("payments.collect");
    expect(ROLES.frontDesk.permissions).toContain("payments.collect");
    expect(ROLES.owner.permissions).toContain("payments.collect");
    const granted = (role: { permissions: readonly string[] }, key: string): boolean => role.permissions.includes(key);
    expect(granted(ROLES.doctor, "payments.collect")).toBe(false);
    expect(granted(ROLES.assistant, "billing.read")).toBe(false);
  });
});
