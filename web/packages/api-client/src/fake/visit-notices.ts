// Staff notices along a visit: a patient waiting, sent in, and money to collect. The API writes them from
// database triggers in the same transaction as the change; the fake writes them from the same places and
// decides who sees them when the bell is read, as the API does.
import { hasPermission } from "../permissions.js";
import type { FakeInvoice, FakeMembership, FakeNotification, FakeQueueToken, Fixtures } from "./fixtures.js";
import { onLeave } from "./time-off.js";

/** The kinds a person acts on: once handled they still show, muted, but stop counting as unread. */
const ACTIONABLE = new Set(["patient_waiting", "send_in", "collect_payment", "arrival"]);

export const isActionable = (kind: string): boolean => ACTIONABLE.has(kind);

/** A bill's total and what is left on it now. */
export type InvoiceMoney = (invoice: FakeInvoice) => { total_paise: number; balance_paise: number };

export interface NoticeContext {
  state: Fixtures;
  money: InvoiceMoney;
  newId: () => string;
  now: Date;
  /** Who did what made the notice handled; left out when the system did. */
  actor?: { membership_id: string; name: string | null } | undefined;
}

const rows = (state: Fixtures): FakeNotification[] => (state.notifications ??= []);

/** Writes a notice unless one of that kind already exists for the same token or bill (the unique indexes). */
function emit(ctx: NoticeContext, clinicId: string, row: Pick<FakeNotification, "kind" | "audience" | "href"> & { token_id?: string; invoice_id?: string }): FakeNotification | null {
  const all = rows(ctx.state);
  const same = all.some((n) => n.clinic_id === clinicId && n.kind === row.kind && (row.invoice_id !== undefined ? n.invoice_id === row.invoice_id : n.token_id === row.token_id));
  if (same) {
    return null;
  }
  const created: FakeNotification = {
    id: ctx.newId(),
    clinic_id: clinicId,
    created_at: ctx.now.toISOString(),
    reminded_at: null,
    escalated_at: null,
    ...row,
  };
  all.push(created);
  return created;
}

function markHandled(ctx: NoticeContext, matches: (n: FakeNotification) => boolean): void {
  for (const n of rows(ctx.state)) {
    if (n.handled == null && matches(n)) {
      n.handled = { at: ctx.now.toISOString(), membership_id: ctx.actor?.membership_id ?? null, name: ctx.actor?.name ?? null };
    }
  }
}

/** A walk-in, a check-in or a waiting token tells the doctor at once. An old `arrival` is not written any more. */
export function patientWaiting(ctx: NoticeContext, token: FakeQueueToken): void {
  if (token.status === "waiting") {
    emit(ctx, token.clinic_id, { kind: "patient_waiting", audience: "doctor", href: "/queue", token_id: token.id });
  }
}

/** The bills of the visits a token led to, which the bill reaches through `encounter_id`. */
function invoicesOfToken(state: Fixtures, token: FakeQueueToken): FakeInvoice[] {
  const visitIds = new Set(
    state.visits.filter((v) => v.clinic_id === token.clinic_id && (v.queue_token_id === token.id || (token.appointment_id != null && v.appointment_id === token.appointment_id))).map((v) => v.id),
  );
  return state.invoices.filter((i) => i.clinic_id === token.clinic_id && i.encounter_id != null && visitIds.has(i.encounter_id));
}

/** Money to collect: once per bill, for a bill that is not void and has a balance. It settles the bill's `payment_due`. */
export function collectPayment(ctx: NoticeContext, invoice: FakeInvoice, token: FakeQueueToken | null): void {
  if (invoice.status === "void" || ctx.money(invoice).balance_paise <= 0) {
    return;
  }
  emit(ctx, invoice.clinic_id, {
    kind: "collect_payment",
    audience: "front_desk",
    href: `/billing/invoices/${invoice.id}`,
    invoice_id: invoice.id,
    ...(token === null ? {} : { token_id: token.id }),
  });
  markHandled(ctx, (n) => n.kind === "payment_due" && n.invoice_id === invoice.id);
}

/**
 * Runs after a token's status changes. Leaving `waiting` settles the waiting notice; `called` sends in; `ready_to_bill`
 * asks the desk to collect on an unpaid bill; `done` or `left` settles what was open for its bills.
 */
export function tokenMoved(ctx: NoticeContext, token: FakeQueueToken): void {
  if (token.status !== "waiting") {
    markHandled(ctx, (n) => n.kind === "patient_waiting" && n.token_id === token.id);
  }
  if (token.status === "called") {
    emit(ctx, token.clinic_id, { kind: "send_in", audience: "doctor", href: "/queue", token_id: token.id });
  } else {
    markHandled(ctx, (n) => n.kind === "send_in" && n.token_id === token.id);
  }
  if (token.status === "ready_to_bill") {
    for (const invoice of invoicesOfToken(ctx.state, token)) {
      collectPayment(ctx, invoice, token);
    }
  }
  if (token.status === "done" || token.status === "left") {
    const bills = new Set(invoicesOfToken(ctx.state, token).map((i) => i.id));
    markHandled(ctx, (n) => n.kind === "collect_payment" && n.invoice_id !== undefined && bills.has(n.invoice_id));
  }
}

/** Runs after a bill is paid or voided: nothing is left to collect on it. */
export function invoiceSettled(ctx: NoticeContext, invoice: FakeInvoice): void {
  if (invoice.status === "void" || ctx.money(invoice).balance_paise <= 0) {
    markHandled(ctx, (n) => n.kind === "collect_payment" && n.invoice_id === invoice.id);
  }
}

/** Runs after a bill is made for a visit whose token already waits to be billed. */
export function invoiceMade(ctx: NoticeContext, invoice: FakeInvoice): void {
  if (invoice.encounter_id == null) {
    return;
  }
  const visit = ctx.state.visits.find((v) => v.id === invoice.encounter_id && v.clinic_id === invoice.clinic_id);
  const token = visit === undefined ? undefined : ctx.state.queueTokens.find((t) => t.id === visit.queue_token_id);
  if (token !== undefined && token.status === "ready_to_bill") {
    collectPayment(ctx, invoice, token);
  }
}

const isoWeekday = (date: string): number => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

/** Memberships of the doctors on duty for a token: hours that weekday at its branch, and no leave now. */
function onDuty(state: Fixtures, token: FakeQueueToken, now: Date): Set<string> {
  const weekday = isoWeekday(token.day);
  const from = now.toISOString();
  const to = new Date(now.getTime() + 60_000).toISOString();
  const duty = new Set<string>();
  for (const p of state.practitioners) {
    if (p.clinic_id !== token.clinic_id || !p.active || p.membership_id == null) continue;
    const hasHours = state.workingShifts.some((s) => s.practitioner_id === p.id && s.branch_id === token.branch_id && s.weekday === weekday);
    if (hasHours && !onLeave(state, token.clinic_id, p.id, from, to)) {
      duty.add(p.membership_id);
    }
  }
  return duty;
}

/**
 * Whether a member is in a notice's audience. The assigned doctor sees a token's notices; with nobody assigned, the doctors on
 * duty do, and with nobody on duty, everyone who can write clinical records. Collecting is for those who may take a payment.
 */
export function visitNoticeVisible(state: Fixtures, n: FakeNotification, membership: FakeMembership, now: Date): boolean {
  const permissions = membership.role.permissions;
  if (n.kind === "collect_payment") {
    return hasPermission(permissions, "billing.write") || hasPermission(permissions, "payments.collect");
  }
  const token = n.token_id === undefined ? undefined : state.queueTokens.find((t) => t.id === n.token_id && t.clinic_id === n.clinic_id);
  if (token === undefined) {
    return hasPermission(permissions, "appointments.read");
  }
  const assigned = token.practitioner_id == null ? undefined : state.practitioners.find((p) => p.id === token.practitioner_id && p.membership_id != null);
  if (assigned !== undefined) {
    return assigned.membership_id === membership.id;
  }
  if (!hasPermission(permissions, "clinical.write")) {
    return false;
  }
  const duty = onDuty(state, token, now);
  return duty.size === 0 || duty.has(membership.id);
}
