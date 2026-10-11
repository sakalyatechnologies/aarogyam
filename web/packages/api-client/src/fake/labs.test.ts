import { describe, expect, it } from "vitest";

import type { ApiClient, ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const SUNRISE = "sunrise.localtest.me";
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const DEV = "a1a1a1a1-0000-4000-8000-000000000002";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup(who = ASHA, host = SUNRISE) {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  const client = (id: string, h = host): ApiClient => backend.client({ host: h, getToken: () => fakeTokenFor({ id }), now: () => NOW });
  return { client, me: client(who) };
}
function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${result.error.code}: ${result.error.message}`);
  return result.value;
}
const status = <T>(result: ApiResult<T>): number | undefined => (result.ok ? undefined : result.error.status);

describe("fake client: lab work", () => {
  it("derives the pipeline stage and late flag, and filters open, overdue and by lab", async () => {
    const { me } = setup();
    const all = value(await me.listLabOrders()).items;
    const open = value(await me.listLabOrders({ open: true })).items;
    expect(open.length).toBeLessThan(all.length);
    expect(open.map((o) => o.due_on ?? "9999")).toEqual([...open.map((o) => o.due_on ?? "9999")].sort());
    const overdue = value(await me.listLabOrders({ overdue: true })).items;
    expect(overdue.map((o) => o.number)).toEqual(["LAB-12"]);
    expect(overdue[0]).toMatchObject({ late: true, days_late: 2, pipeline_stage: "sent" });
    const vendor = overdue[0]?.vendor_id ?? "";
    expect(value(await me.listLabOrders({ vendorId: vendor })).items.every((o) => o.vendor_id === vendor)).toBe(true);
  });

  it("creates an order with two items, numbers it and keeps it a draft unless sent", async () => {
    const { me } = setup();
    const vendor = value(await me.listLabVendors()).items[0];
    const patient = value(await me.listPatients()).items[0];
    if (vendor === undefined || patient === undefined) throw new Error("no seed");
    const made = value(
      await me.createLabOrder({
        vendor_id: vendor.id,
        patient_id: patient.id,
        due_on: "2026-10-12",
        send: true,
        items: [{ work_type: "Zirconia crown", teeth: [36], shade: "A2", qty: 1, unit_cost_paise: 400_000 }, { work_type: "Night guard" }],
      }),
    );
    expect(made).toMatchObject({ number: "LAB-16", status: "sent", pipeline_stage: "sent", patient_name: patient.full_name });
    expect(made.items.map((i) => [i.line_no, i.work_type, i.qty])).toEqual([[1, "Zirconia crown", 1], [2, "Night guard", 1]]);
    const draft = value(await me.createLabOrder({ vendor_id: vendor.id, patient_id: patient.id, items: [{ work_type: "Retainer" }] }));
    expect(draft).toMatchObject({ status: "draft", pipeline_stage: "to_send" });
  });

  it("validates new orders", async () => {
    const { me } = setup();
    const vendor = value(await me.listLabVendors()).items[0];
    const patient = value(await me.listPatients()).items[0];
    if (vendor === undefined || patient === undefined) throw new Error("no seed");
    const base = { vendor_id: vendor.id, patient_id: patient.id };
    expect(status(await me.createLabOrder({ ...base, items: [] }))).toBe(400);
    expect(status(await me.createLabOrder({ ...base, items: [{ work_type: "Crown", teeth: [3] }] }))).toBe(400);
    expect(status(await me.createLabOrder({ ...base, due_on: "soon", items: [{ work_type: "Crown" }] }))).toBe(400);
    expect(status(await me.createLabOrder({ ...base, contact_id: "nobody", items: [{ work_type: "Crown" }] }))).toBe(400);
    expect(status(await me.createLabOrder({ ...base, vendor_id: "missing", items: [{ work_type: "Crown" }] }))).toBe(404);
  });

  it("moves along the allowed statuses only, and records stage changes", async () => {
    const { me } = setup();
    const lab12 = value(await me.listLabOrders({ overdue: true })).items[0];
    if (lab12 === undefined) throw new Error("no LAB-12");
    expect(status(await me.setLabOrderStatus(lab12.id, { status: "fitted" }))).toBe(409);
    const staged = value(await me.updateLabOrder(lab12.id, { stage: "Trial" }));
    expect(staged.stage).toBe("Trial");
    expect(staged.events.at(-1)).toMatchObject({ kind: "stage_changed", stage: "Trial" });
    const received = value(await me.setLabOrderStatus(lab12.id, { status: "received" }));
    expect(received).toMatchObject({ pipeline_stage: "ready_to_fit", late: false });
    expect(value(await me.setLabOrderStatus(lab12.id, { status: "fitted" })).pipeline_stage).toBe("fitted");
    expect(status(await me.setLabOrderStatus(lab12.id, { status: "cancelled" }))).toBe(409);
  });

  it("reminds by email only for work at a lab whose contact or lab has an email", async () => {
    const { me } = setup();
    const open = value(await me.listLabOrders({ open: true })).items;
    const lab12 = open.find((o) => o.number === "LAB-12");
    const lab11 = open.find((o) => o.number === "LAB-11");
    const lab10 = open.find((o) => o.number === "LAB-10");
    if (lab12 === undefined || lab11 === undefined || lab10 === undefined) throw new Error("seed changed");
    expect(value(await me.remindLab(lab12.id)).message_id).not.toBe("");
    expect(status(await me.remindLab(lab11.id))).toBe(409);
    expect(status(await me.remindLab(lab10.id))).toBe(409);
    expect(value(await me.getLabOrder(lab12.id)).events.map((e) => e.kind)).toContain("reminded");
  });

  it("logs a call, and a promised date becomes the due date", async () => {
    const { me } = setup();
    const lab12 = value(await me.listLabOrders({ overdue: true })).items[0];
    if (lab12 === undefined) throw new Error("no LAB-12");
    const logged = value(await me.logLabContact(lab12.id, { channel: "call", outcome: "promised_date", promised_on: "2026-10-09", note: "Friday" }));
    expect(logged).toMatchObject({ due_on: "2026-10-09", late: false });
    expect(logged.last_contacted_at).not.toBeNull();
    expect(status(await me.logLabContact(lab12.id, { channel: "call", note: "x".repeat(501) }))).toBe(400);
  });

  it("hides costs without finance.view, and payments need expenses.write and finance.view", async () => {
    const { client } = setup();
    const owner = client(ASHA);
    const doctor = client(DEV);
    const orderId = value(await owner.listLabOrders({ overdue: true })).items[0]?.id ?? "";
    expect(value(await owner.getLabOrder(orderId))).toMatchObject({ costs_visible: true });
    expect(value(await owner.getLabOrder(orderId)).items[0]?.unit_cost_paise).toBe(280_000);
    expect(value(await doctor.getLabOrder(orderId))).toMatchObject({ costs_visible: false });
    expect(value(await doctor.getLabOrder(orderId)).items[0]?.unit_cost_paise ?? null).toBeNull();
    const vendor = value(await owner.listLabVendors()).items[0];
    if (vendor === undefined) throw new Error("no lab");
    expect(status(await doctor.listLabPayments(vendor.id))).toBe(403);
    expect(status(await doctor.getLabBalance(vendor.id))).toBe(403);
    expect(status(await doctor.recordLabPayment({ vendor_id: vendor.id, paid_on: "2026-10-03", amount_paise: 100 }))).toBe(403);
  });

  it("records a payment against the balance and voids it with a reason", async () => {
    const { me } = setup();
    const vendor = value(await me.listLabVendors()).items.find((v) => v.name === "Precision Dental Lab");
    if (vendor === undefined) throw new Error("no lab");
    const before = value(await me.getLabBalance(vendor.id));
    expect(before.due_paise).toBe(before.billed_paise - before.paid_paise);
    expect(status(await me.recordLabPayment({ vendor_id: vendor.id, paid_on: "2026-10-03", amount_paise: 0 }))).toBe(400);
    expect(status(await me.recordLabPayment({ vendor_id: vendor.id, paid_on: "2030-01-01", amount_paise: 100 }))).toBe(400);
    const paid = value(await me.recordLabPayment({ vendor_id: vendor.id, paid_on: "2026-10-03", amount_paise: 100_000, lab_invoice_ref: "PDL-9" }));
    expect(value(await me.getLabBalance(vendor.id)).due_paise).toBe(before.due_paise - 100_000);
    const expenses = value(await me.listExpenses({ from: "2026-10-01", to: "2026-10-03" })).items;
    expect(expenses.some((e) => e.category === "lab" && e.amount_paise === 100_000)).toBe(true);
    expect(status(await me.voidLabPayment(paid.id, { reason: "x" }))).toBe(400);
    expect(value(await me.voidLabPayment(paid.id, { reason: "Entered twice" })).status).toBe("void");
    expect(value(await me.getLabBalance(vendor.id)).due_paise).toBe(before.due_paise);
    expect(status(await me.voidLabPayment(paid.id, { reason: "Entered twice" }))).toBe(409);
  });

  it("keeps labs, their contacts and orders to one clinic", async () => {
    const { client } = setup();
    const owner = client(ASHA);
    const bina = client(BINA, "lotus.localtest.me");
    const vendor = value(await owner.listLabVendors()).items[0];
    const order = value(await owner.listLabOrders()).items[0];
    if (vendor === undefined || order === undefined) throw new Error("no seed");
    expect(value(await bina.listLabVendors()).items).toEqual([]);
    expect(value(await bina.listLabOrders()).items).toEqual([]);
    expect(status(await bina.getLabOrder(order.id))).toBe(404);
    expect(status(await bina.updateLabVendor(vendor.id, { name: "Mine now" }))).toBe(404);
    expect(status(await bina.createLabContact(vendor.id, { name: "Intruder" }))).toBe(404);
    expect(status(await bina.getLabBalance(vendor.id))).toBe(404);
  });

  it("adds and edits labs and several contacts, with validation", async () => {
    const { me } = setup();
    expect(status(await me.createLabVendor({ name: "  " }))).toBe(400);
    const lab = value(await me.createLabVendor({ name: "Smile Ceramics", kind: "dental_lab", email: "orders@smile.example.com" }));
    expect(status(await me.createLabContact(lab.id, { name: "Priya", email: "nope" }))).toBe(400);
    const a = value(await me.createLabContact(lab.id, { name: "Priya Nair", phone: "+919876500200", whatsapp: true, preferred_channel: "whatsapp" }));
    value(await me.createLabContact(lab.id, { name: "Arun Rao", preferred_channel: "email", email: "arun@smile.example.com" }));
    expect(value(await me.updateLabContact(a.id, { role: "Owner" })).role).toBe("Owner");
    expect(value(await me.updateLabVendor(lab.id, { note: "Zirconia" })).note).toBe("Zirconia");
    const listed = value(await me.listLabVendors()).items.find((v) => v.id === lab.id);
    expect(listed?.contacts.map((c) => c.name)).toEqual(["Priya Nair", "Arun Rao"]);
  });

  it("needs labs.read to look and labs.write to change", async () => {
    const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
    const fixtures = createFixtures({ now: NOW });
    const membership = fixtures.memberships.find((m) => m.user_id === FARAH);
    if (membership === undefined) throw new Error("no Farah");
    membership.role = { key: "lab_reader", name: "Lab reader", permissions: ["patients.read", "labs.read"] };
    const reader = createFakeBackend(fixtures).client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: FARAH }), now: () => NOW });
    const order = value(await reader.listLabOrders()).items[0];
    if (order === undefined) throw new Error("no order");
    expect(value(await reader.listLabVendors()).items.length).toBeGreaterThan(0);
    expect(status(await reader.createLabVendor({ name: "Nope" }))).toBe(403);
    expect(status(await reader.updateLabOrder(order.id, { stage: "Trial" }))).toBe(403);
    expect(status(await reader.setLabOrderStatus(order.id, { status: "cancelled" }))).toBe(403);
    expect(status(await reader.remindLab(order.id))).toBe(403);
    expect(status(await reader.logLabContact(order.id, { channel: "call" }))).toBe(403);

    const none = createFixtures({ now: NOW });
    const other = none.memberships.find((m) => m.user_id === FARAH);
    if (other !== undefined) other.role = { key: "reader", name: "Reader", permissions: ["patients.read"] };
    const blind = createFakeBackend(none).client({ host: SUNRISE, getToken: () => fakeTokenFor({ id: FARAH }), now: () => NOW });
    expect(status(await blind.listLabVendors())).toBe(403);
    expect(status(await blind.listLabOrders())).toBe(403);
  });
});
