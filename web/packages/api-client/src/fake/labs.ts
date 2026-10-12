/**
 * The fake's lab work, following the API's rules (`aarogyam-domain::lab`): which moves an order may make, when it is
 * late, what a reminder may say, and what a lab still has to be paid. The seed uses fixed ids and no random draws, so
 * adding it leaves every other seeded value as it was.
 */

import type * as C from "../contract.js";
import type { FakePatient, FakePractitioner } from "./fixtures.js";

const DAY = 86_400_000;

export interface FakeLabVendor {
  id: string;
  clinic_id: string;
  name: string;
  kind: C.LabVendorKind;
  phone: string | null;
  email: string | null;
  address: string | null;
  note: string | null;
  contacts: C.LabContact[];
  created_at: string;
}

export interface FakeLabOrder {
  id: string;
  clinic_id: string;
  number: string;
  vendor_id: string;
  contact_id: string | null;
  patient_id: string;
  doctor_id: string;
  status: C.LabOrderState;
  stage: string | null;
  instructions: string | null;
  sent_at: string | null;
  due_on: string | null;
  received_at: string | null;
  rework_of_id: string | null;
  last_contacted_at: string | null;
  last_contacted_by: string | null;
  created_at: string;
  items: C.LabOrderItem[];
  events: C.LabOrderEvent[];
}

export interface FakeLabPayment extends C.LabPayment {
  clinic_id: string;
}

export interface FakeLabs {
  vendors: FakeLabVendor[];
  orders: FakeLabOrder[];
  payments: FakeLabPayment[];
}

export const emptyLabs = (): FakeLabs => ({ vendors: [], orders: [], payments: [] });

const day = (date: Date): string => date.toISOString().slice(0, 10);

export function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);
}

/** Whether an order may move from `from` to `to`. */
export function canMove(from: C.LabOrderState, to: C.LabOrderState): boolean {
  switch (from) {
    case "draft":
      return to === "sent" || to === "cancelled";
    case "sent":
      return to === "in_progress" || to === "received" || to === "cancelled";
    case "in_progress":
      return to === "received" || to === "cancelled";
    case "received":
      return to === "fitted" || to === "returned_for_rework";
    default:
      return false;
  }
}

export const atLab = (status: C.LabOrderState): boolean => status === "sent" || status === "in_progress";

const PIPELINE: Readonly<Record<C.LabOrderState, C.LabPipelineStage>> = {
  draft: "to_send",
  sent: "sent",
  in_progress: "in_progress",
  received: "ready_to_fit",
  fitted: "fitted",
  returned_for_rework: "rework",
  cancelled: "cancelled",
};

const OPEN: readonly C.LabOrderState[] = ["draft", "sent", "in_progress", "received"];
export const isOpen = (status: C.LabOrderState): boolean => OPEN.includes(status);

/** What the front desk sees of an order: names filled in, late worked out, costs only when allowed. */
export function wireLabOrder(
  order: FakeLabOrder,
  context: { today: string; costs: boolean; vendors: readonly FakeLabVendor[]; patients: readonly FakePatient[]; doctors: readonly FakePractitioner[] },
): C.LabOrder {
  const vendor = context.vendors.find((v) => v.id === order.vendor_id);
  const contact = vendor?.contacts.find((c) => c.id === order.contact_id);
  const patient = context.patients.find((p) => p.id === order.patient_id);
  const doctor = context.doctors.find((d) => d.id === order.doctor_id);
  const late = atLab(order.status) && order.due_on !== null && order.due_on < context.today;
  const wire: C.LabOrder = {
    id: order.id,
    number: order.number,
    vendor_id: order.vendor_id,
    vendor_name: vendor?.name ?? null,
    vendor_phone: vendor?.phone ?? null,
    contact_id: order.contact_id,
    contact_name: contact?.name ?? null,
    contact_phone: contact?.phone ?? null,
    contact_email: contact?.email ?? null,
    contact_whatsapp: contact?.whatsapp ?? false,
    last_contacted_at: order.last_contacted_at,
    last_contacted_by: order.last_contacted_by,
    last_contacted_by_name: order.last_contacted_by === null ? null : "Front desk",
    patient_id: order.patient_id,
    patient_number: patient?.number ?? "",
    patient_name: patient?.full_name ?? "",
    doctor_id: order.doctor_id,
    doctor_name: doctor?.display_name ?? null,
    procedure_id: null,
    encounter_id: null,
    status: order.status,
    pipeline_stage: PIPELINE[order.status],
    late,
    days_late: late && order.due_on !== null ? daysFrom(order.due_on, context.today) : null,
    stage: order.stage,
    instructions: order.instructions,
    sent_at: order.sent_at,
    due_on: order.due_on,
    received_at: order.received_at,
    rework_of_id: order.rework_of_id,
    created_at: order.created_at,
    costs_visible: context.costs,
    items: order.items.map((item) => (context.costs ? item : { ...item, unit_cost_paise: null })),
    events: order.events,
  };
  return wire;
}

/** What a lab billed, was paid and is owed: the cost of every order that wasn't cancelled, less payments not voided. */
export function labBalance(vendor: FakeLabVendor, labs: FakeLabs): C.LabBalance {
  const orders = labs.orders.filter((o) => o.vendor_id === vendor.id && o.status !== "cancelled");
  const billed = orders.reduce((sum, o) => sum + o.items.reduce((s, i) => s + (i.unit_cost_paise ?? 0) * i.qty, 0), 0);
  const paid = labs.payments.filter((p) => p.vendor_id === vendor.id && p.status === "recorded").reduce((sum, p) => sum + p.amount_paise, 0);
  return { vendor_id: vendor.id, name: vendor.name, orders: orders.length, billed_paise: billed, paid_paise: paid, due_paise: billed - paid };
}

export const wireLabPayment = (p: FakeLabPayment): C.LabPayment => ({
  id: p.id,
  vendor_id: p.vendor_id,
  lab_order_id: p.lab_order_id ?? null,
  paid_on: p.paid_on,
  amount_paise: p.amount_paise,
  lab_invoice_ref: p.lab_invoice_ref ?? null,
  note: p.note ?? null,
  expense_id: p.expense_id,
  status: p.status,
  void_reason: p.void_reason ?? null,
  voided_at: p.voided_at ?? null,
  recorded_by: p.recorded_by,
  created_at: p.created_at,
});

export const nextOrderNumber = (labs: FakeLabs): string =>
  `LAB-${String(labs.orders.reduce((max, o) => Math.max(max, Number(o.number.replace(/\D/g, "")) || 0), 0) + 1)}`;

/** Checks a new order's items; the first problem as field and message. */
export function checkItems(items: readonly C.NewLabOrderItem[]): { field: string; problem: string } | null {
  if (items.length === 0 || items.length > 50) {
    return { field: "items", problem: "add 1 to 50 items" };
  }
  for (const item of items) {
    const work = item.work_type.trim();
    if (work === "" || work.length > 80) {
      return { field: "work_type", problem: "write the kind of work in 1 to 80 characters" };
    }
    if ((item.teeth ?? []).some((t) => !Number.isInteger(t) || t < 11 || t > 85)) {
      return { field: "teeth", problem: "use tooth numbers such as 36" };
    }
    if (item.qty != null && (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99)) {
      return { field: "qty", problem: "must be 1 to 99" };
    }
    if (item.unit_cost_paise != null && (!Number.isInteger(item.unit_cost_paise) || item.unit_cost_paise < 0)) {
      return { field: "unit_cost_paise", problem: "can't be negative" };
    }
  }
  return null;
}

/** Trimmed text, or null when nothing is left. */
export const trimmedOrNull = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
};

// The seed -----------------------------------------------------------------------------------------------------------

const lid = (kind: number, n: number): string => `0192f1c4-7a10-7c3e-9b2a-1d2e3f4${String(kind).padStart(2, "0")}${String(n).padStart(3, "0")}`.slice(0, 36);

/**
 * Three labs, a few orders in every stage (one late, the one the Sunrise bell mentions) and some payments. Costs are
 * kept so a role with `finance.view` sees them and everyone else doesn't.
 */
export function seedLabs(clinicId: string, patients: readonly FakePatient[], doctor: FakePractitioner, membershipId: string, now: Date): FakeLabs {
  const at = (days: number): string => new Date(now.getTime() + days * DAY).toISOString();
  const on = (days: number): string => day(new Date(now.getTime() + days * DAY));
  const contact = (vendorId: string, n: number, c: Omit<C.LabContact, "id" | "vendor_id">): C.LabContact => ({ id: lid(61, n), vendor_id: vendorId, ...c });
  const v1 = lid(60, 1);
  const v2 = lid(60, 2);
  const v3 = lid(60, 3);
  const vendors: FakeLabVendor[] = [
    {
      id: v1,
      clinic_id: clinicId,
      name: "Precision Dental Lab",
      kind: "dental_lab",
      phone: "+912026051100",
      email: "orders@precision-lab.example.com",
      address: "Shivajinagar, Pune",
      note: "Crowns, bridges and implant work. Usually 5 to 7 days.",
      contacts: [
        contact(v1, 1, { name: "Rahul Deshmukh", role: "Ceramist", phone: "+919876500101", email: "rahul@precision-lab.example.com", whatsapp: true, preferred_channel: "email" }),
        contact(v1, 2, { name: "Meena Joshi", role: "Front office", phone: "+919876500102", email: null, whatsapp: false, preferred_channel: "phone" }),
      ],
      created_at: at(-300),
    },
    {
      id: v2,
      clinic_id: clinicId,
      name: "Crown & Bridge Studio",
      kind: "dental_lab",
      phone: "+912025531200",
      email: null,
      address: "Kothrud, Pune",
      note: "Dentures, retainers and night guards.",
      contacts: [contact(v2, 3, { name: "Sanjay Patil", role: "Owner", phone: "+919876500103", email: null, whatsapp: true, preferred_channel: "whatsapp" })],
      created_at: at(-240),
    },
    {
      id: v3,
      clinic_id: clinicId,
      name: "Pune Imaging Centre",
      kind: "radiology",
      phone: "+912024471300",
      email: "reports@pune-imaging.example.com",
      address: "Deccan Gymkhana, Pune",
      note: "CBCT and 3D scans.",
      contacts: [contact(v3, 4, { name: "Neha Kulkarni", role: "Reception", phone: "+919876500104", email: "neha@pune-imaging.example.com", whatsapp: false, preferred_channel: "email" })],
      created_at: at(-200),
    },
  ];

  const patient = (i: number): string => patients[i % Math.max(patients.length, 1)]?.id ?? "";
  const item = (n: number, work_type: string, teeth: number[], shade: string | null, material: string | null, qty: number, cost: number | null): C.LabOrderItem => ({
    id: lid(62, n),
    line_no: 1,
    work_type,
    teeth,
    shade,
    material,
    qty,
    unit_cost_paise: cost,
  });
  const base = (n: number, number: string, vendor: string, contactId: string | null, p: number, status: C.LabOrderState, due: number | null, items: C.LabOrderItem[], extra: Partial<FakeLabOrder> = {}): FakeLabOrder => ({
    id: lid(63, n),
    clinic_id: clinicId,
    number,
    vendor_id: vendor,
    contact_id: contactId,
    patient_id: patient(p),
    doctor_id: doctor.id,
    status,
    stage: null,
    instructions: null,
    sent_at: status === "draft" ? null : at(-6 + n),
    due_on: due === null ? null : on(due),
    received_at: status === "received" || status === "fitted" ? at(-1) : null,
    rework_of_id: null,
    last_contacted_at: null,
    last_contacted_by: null,
    created_at: at(-8 + n),
    items: items.map((it, i) => ({ ...it, line_no: i + 1 })),
    events: [{ kind: "created", to_status: status === "draft" ? "draft" : "sent", at: at(-8 + n), actor_id: membershipId }],
    ...extra,
  });

  const orders: FakeLabOrder[] = [
    base(1, "LAB-9", v1, lid(61, 1), 0, "fitted", -3, [item(1, "Zirconia crown", [36], "A2", "Zirconia", 1, 450_000)], { stage: "Delivered" }),
    base(2, "LAB-10", v1, lid(61, 1), 1, "received", 1, [item(2, "E-max crown", [11, 21], "A1", "Lithium disilicate", 2, 520_000)], { stage: "Final" }),
    base(3, "LAB-11", v2, lid(61, 3), 2, "in_progress", 4, [item(3, "Complete denture", [], "A3", "Acrylic", 1, 900_000), item(4, "Night guard", [], null, "Hard acrylic", 1, 180_000)], {
      stage: "Trial",
      instructions: "Wax trial before processing.",
    }),
    {
      ...base(4, "LAB-12", v1, lid(61, 1), 3, "sent", -2, [item(5, "PFM crown", [46], "B2", "Porcelain on metal", 1, 280_000)]),
      id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405290",
      stage: "Production",
      last_contacted_at: at(-1),
      last_contacted_by: membershipId,
      events: [
        { kind: "created", to_status: "sent", at: at(-8), actor_id: membershipId },
        { kind: "reminded", reminder: "email", at: at(-2), actor_id: membershipId },
        { kind: "contacted", channel: "call", outcome: "no_answer", at: at(-1), actor_id: membershipId, contact_id: lid(61, 1) },
      ],
    },
    base(5, "LAB-13", v3, lid(61, 4), 4, "sent", 2, [item(6, "CBCT scan", [], null, null, 1, 250_000)]),
    base(6, "LAB-14", v1, null, 5, "draft", null, [item(7, "Implant crown", [26], "A2", "Zirconia", 1, 650_000)]),
    base(7, "LAB-15", v2, lid(61, 3), 6, "cancelled", null, [item(8, "Retainer", [], null, "Clear", 1, 120_000)], { stage: null }),
  ];

  const payment = (n: number, vendor: string, paidOn: number, amount: number, ref: string | null, extra: Partial<FakeLabPayment> = {}): FakeLabPayment => ({
    id: lid(64, n),
    clinic_id: clinicId,
    vendor_id: vendor,
    lab_order_id: null,
    paid_on: on(paidOn),
    amount_paise: amount,
    lab_invoice_ref: ref,
    note: null,
    expense_id: lid(65, n),
    status: "recorded",
    void_reason: null,
    voided_at: null,
    recorded_by: membershipId,
    created_at: at(paidOn),
    ...extra,
  });
  const payments: FakeLabPayment[] = [
    payment(1, v1, -10, 400_000, "PDL-2210"),
    payment(2, v1, -4, 450_000, "PDL-2236", { lab_order_id: lid(63, 1) }),
    payment(3, v2, -5, 100_000, null, { status: "void", void_reason: "Entered twice", voided_at: at(-5) }),
  ];
  return { vendors, orders, payments };
}

/** Soonest due first; no due date last, then oldest first. */
export const byDue = (a: { due_on?: string | null; created_at: string }, b: { due_on?: string | null; created_at: string }): number => {
  if (a.due_on != null && b.due_on != null && a.due_on !== b.due_on) return a.due_on.localeCompare(b.due_on);
  if (a.due_on != null && b.due_on == null) return -1;
  if (a.due_on == null && b.due_on != null) return 1;
  return a.created_at.localeCompare(b.created_at);
};

export const wireVendor = (v: FakeLabVendor): C.LabVendor => ({
  id: v.id,
  name: v.name,
  kind: v.kind,
  phone: v.phone,
  email: v.email,
  address: v.address,
  note: v.note,
  contacts: v.contacts,
  created_at: v.created_at,
});

type Problem = { field: string; problem: string } | null;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Checks a lab's fields as the API does; `all` means a new lab, which needs a name. */
export function checkVendor(input: C.LabVendorValues, all: boolean): Problem {
  const name = input.name?.trim() ?? "";
  if ((all || input.name != null) && (name === "" || name.length > 120)) return { field: "name", problem: "write a name of 1 to 120 characters" };
  const email = input.email?.trim() ?? "";
  if (email !== "" && !EMAIL.test(email)) return { field: "email", problem: "not an email address" };
  if ((input.phone?.trim().length ?? 0) > 20) return { field: "phone", problem: "at most 20 characters" };
  if ((input.address?.length ?? 0) > 300) return { field: "address", problem: "at most 300 characters" };
  if ((input.note?.length ?? 0) > 500) return { field: "note", problem: "at most 500 characters" };
  return null;
}

export function checkContact(input: C.LabContactValues, all: boolean): Problem {
  const name = input.name?.trim() ?? "";
  if ((all || input.name != null) && (name === "" || name.length > 120)) return { field: "name", problem: "write a name of 1 to 120 characters" };
  const email = input.email?.trim() ?? "";
  if (email !== "" && !EMAIL.test(email)) return { field: "email", problem: "not an email address" };
  if ((input.phone?.trim().length ?? 0) > 20) return { field: "phone", problem: "at most 20 characters" };
  return null;
}
