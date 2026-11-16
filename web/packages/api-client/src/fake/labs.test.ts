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

  it("adds, changes and removes order items until the order is final", async () => {
    const { me, client } = setup();
    const lab12 = value(await me.listLabOrders()).items.find((o) => o.number === "LAB-12");
    if (lab12 === undefined) throw new Error("no LAB-12");
    const first = lab12.items[0];
    if (first === undefined) throw new Error("no item");

    const added = value(await me.addLabOrderItem(lab12.id, { work_type: " Bridge ", teeth: [13, 11, 12], qty: 2, unit_cost_paise: 100_000 }));
    expect(added.items.map((i) => [i.line_no, i.work_type, i.teeth, i.qty])).toEqual([[1, "PFM crown", [46], 1], [2, "Bridge", [11, 12, 13], 2]]);
    expect(added.events.at(-1)).toMatchObject({ kind: "item_added", line_no: 2 });
    const second = added.items[1];
    if (second === undefined) throw new Error("no second");

    const changed = value(await me.updateLabOrderItem(second.id, { shade: "A3", qty: 3, unit_cost_paise: null }));
    expect(changed.items[1]).toMatchObject({ shade: "A3", qty: 3, work_type: "Bridge", unit_cost_paise: null });
    expect(changed.events.at(-1)).toMatchObject({ kind: "item_changed", line_no: 2 });
    expect(status(await me.updateLabOrderItem(second.id, { qty: 101 }))).toBe(400);
    expect(status(await me.updateLabOrderItem(second.id, { work_type: " " }))).toBe(400);
    expect(status(await me.addLabOrderItem(lab12.id, { work_type: "Crown", teeth: [19] }))).toBe(400);
    expect(status(await me.updateLabOrderItem("no-such-item", { qty: 1 }))).toBe(404);

    const removed = value(await me.removeLabOrderItem(second.id));
    expect(removed.items).toHaveLength(1);
    expect(removed.events.at(-1)).toMatchObject({ kind: "item_removed", line_no: 2 });
    const last = await me.removeLabOrderItem(first.id);
    expect(status(last)).toBe(409);
    expect(status(await me.removeLabOrderItem(second.id))).toBe(404);

    // A role without finance.view can't set a cost.
    const doctor = client(DEV);
    if (status(await doctor.addLabOrderItem(lab12.id, { work_type: "Crown" })) === undefined) {
      expect(status(await doctor.addLabOrderItem(lab12.id, { work_type: "Crown", unit_cost_paise: 1 }))).toBe(403);
    }

    // Fitted and cancelled orders are locked.
    const fitted = value(await me.listLabOrders()).items.find((o) => o.status === "fitted");
    const fittedItem = fitted?.items[0];
    if (fitted === undefined || fittedItem === undefined) throw new Error("no fitted order");
    expect(status(await me.addLabOrderItem(fitted.id, { work_type: "Crown" }))).toBe(409);
    expect(status(await me.updateLabOrderItem(fittedItem.id, { qty: 1 }))).toBe(409);
    expect(status(await me.removeLabOrderItem(fittedItem.id))).toBe(409);
    const refusal = await me.addLabOrderItem(fitted.id, { work_type: "Crown" });
    if (refusal.ok) throw new Error("expected a refusal");
    expect(refusal.error.message).toContain("can't change");
  });

  it("keeps order items to their own clinic", async () => {
    const { me, client } = setup();
    const lab12 = value(await me.listLabOrders()).items.find((o) => o.number === "LAB-12");
    const item = lab12?.items[0];
    if (lab12 === undefined || item === undefined) throw new Error("no LAB-12");
    const other = client(BINA, "lotus.localtest.me");
    expect(status(await other.addLabOrderItem(lab12.id, { work_type: "Crown" }))).toBeDefined();
    expect(status(await other.updateLabOrderItem(item.id, { qty: 2 }))).toBe(404);
    expect(status(await other.removeLabOrderItem(item.id))).toBe(404);
  });

  it("records a payment's method, leaves it absent when none, and refuses an unknown one", async () => {
    const { me } = setup();
    const vendor = value(await me.listLabVendors()).items[0];
    if (vendor === undefined) throw new Error("no lab");
    const paid = value(await me.recordLabPayment({ vendor_id: vendor.id, paid_on: "2026-10-03", amount_paise: 500, method: "upi" }));
    expect(paid.method).toBe("upi");
    const plain = value(await me.recordLabPayment({ vendor_id: vendor.id, paid_on: "2026-10-03", amount_paise: 600 }));
    expect("method" in plain).toBe(false);
    const listed = value(await me.listLabPayments(vendor.id)).items;
    expect(listed.find((p) => p.id === paid.id)?.method).toBe("upi");
    expect("method" in (listed.find((p) => p.id === plain.id) ?? {})).toBe(false);
    for (const bad of ["cheque", "", "UPI"]) {
      expect(status(await me.recordLabPayment({ vendor_id: vendor.id, paid_on: "2026-10-03", amount_paise: 100, method: bad }))).toBe(400);
    }
  });

  it("attaches, replaces and removes a payment's proof, keeping it readable once void", async () => {
    const { me, client } = setup();
    const vendor = value(await me.listLabVendors()).items[0];
    if (vendor === undefined) throw new Error("no lab");
    const paid = value(await me.recordLabPayment({ vendor_id: vendor.id, paid_on: "2026-10-03", amount_paise: 700 }));
    expect("proof" in paid).toBe(false);
    expect(status(await me.getLabPaymentProofDownloadLink(paid.id))).toBe(404);
    const form = (bytes: BlobPart, type: string, name: string): FormData => {
      const body = new FormData();
      body.set("file", new File([bytes], name, { type }));
      return body;
    };
    const shown = value(await me.uploadLabPaymentProof(paid.id, form("png", "image/png", "upi.png")));
    expect(shown.proof).toEqual({ mime_type: "image/png", size_bytes: 3, file_name: "upi.png" });
    expect(value(await me.listLabPayments(vendor.id)).items.find((p) => p.id === paid.id)?.proof?.mime_type).toBe("image/png");
    const link = value(await me.getLabPaymentProofDownloadLink(paid.id));
    expect(link.url).toContain("/api/v1/lab-payment-files/");
    const replaced = value(await me.uploadLabPaymentProof(paid.id, form("%PDF", "application/pdf", "receipt.pdf")));
    expect(replaced.proof?.mime_type).toBe("application/pdf");
    // A wrong type is 400, an oversized file 413; neither replaces the proof.
    expect(status(await me.uploadLabPaymentProof(paid.id, form("x", "text/plain", "x.txt")))).toBe(400);
    expect(status(await me.uploadLabPaymentProof(paid.id, form(new Uint8Array(10 * 1024 * 1024 + 1), "application/pdf", "big.pdf")))).toBe(413);
    expect(status(await me.uploadLabPaymentProof(paid.id, new FormData()))).toBe(400);
    expect(value(await me.listLabPayments(vendor.id)).items.find((p) => p.id === paid.id)?.proof?.mime_type).toBe("application/pdf");
    // Another clinic sees nothing.
    const stranger = client(BINA, "lotus.localtest.me");
    expect(status(await stranger.uploadLabPaymentProof(paid.id, form("png", "image/png", "x.png")))).toBe(404);
    expect(status(await stranger.getLabPaymentProofDownloadLink(paid.id))).toBe(404);
    // Removing it leaves none; a second removal is 404.
    expect("proof" in value(await me.removeLabPaymentProof(paid.id))).toBe(false);
    expect(status(await me.removeLabPaymentProof(paid.id))).toBe(404);
    // Void: the proof stays readable, but no new one is taken and it can't be removed.
    value(await me.uploadLabPaymentProof(paid.id, form("png", "image/png", "again.png")));
    value(await me.voidLabPayment(paid.id, { reason: "Entered twice" }));
    expect(status(await me.uploadLabPaymentProof(paid.id, form("png", "image/png", "late.png")))).toBe(409);
    expect(status(await me.removeLabPaymentProof(paid.id))).toBe(409);
    expect(value(await me.getLabPaymentProofDownloadLink(paid.id)).url).toContain("/content?token=");
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

describe("fake client: batch reminders and the tracker", () => {
  it("reminds each lab once for its orders at the lab, never naming a patient, and stops on an unknown order", async () => {
    const { me, client } = setup();
    const atLab = value(await me.listLabOrders({ open: true })).items.filter((o) => o.status === "sent" || o.status === "in_progress");
    expect(atLab.length).toBeGreaterThan(0);
    const emailed = value(await me.remindLabs({ order_ids: atLab.map((o) => o.id), channel: "email" }));
    expect(emailed.vendors.every((v) => v.message_id !== null && v.wa_link === null)).toBe(true);
    expect(emailed.vendors.flatMap((v) => v.order_ids).length + emailed.skipped.length).toBe(atLab.length);
    const walink = value(await me.remindLabs({ order_ids: atLab.map((o) => o.id), channel: "whatsapp" }));
    for (const lab of walink.vendors) {
      expect(lab.wa_link).toMatch(/^https:\/\/wa\.me\//);
      for (const order of atLab) expect(lab.wa_link ?? "").not.toContain(encodeURIComponent(order.patient_name));
    }
    expect(status(await me.remindLabs({ order_ids: [], channel: "email" }))).toBe(400);
    expect(status(await me.remindLabs({ order_ids: [atLab[0]?.id ?? "", "00000000-0000-4000-8000-000000000000"], channel: "email" }))).toBe(404);
    // Another clinic's owner can't reach them.
    expect(status(await client(BINA, "lotus.localtest.me").remindLabs({ order_ids: [atLab[0]?.id ?? ""], channel: "email" }))).toBe(404);
  });

  it("shows the tracker stage and a lab's directory fields", async () => {
    const { me } = setup();
    const order = value(await me.listLabOrders()).items.find((o) => o.status === "sent");
    expect(order?.tracker_stage).toBe("production");
    const trial = value(await me.updateLabOrder(order?.id ?? "", { stage: "Wax try-in" }));
    expect(trial.tracker_stage).toBe("trial");
    const lab = value(await me.createLabVendor({ name: "Pune Ceramics", city: "Pune", work_types: ["Crown"], turnaround_days: 5 }));
    expect(lab).toMatchObject({ city: "Pune", work_types: ["Crown"], turnaround_days: 5 });
    expect(status(await me.createLabVendor({ name: "Bad", turnaround_days: 0 }))).toBe(400);
  });
});
