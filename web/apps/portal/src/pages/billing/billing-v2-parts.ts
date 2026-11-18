import type { Invoice } from "@aarogyam/api-client";

import type { ChipTone } from "../../components/mk/index.js";
import { invoiceStatus, type InvoiceStatusKey } from "../../lib/invoice-status.js";

export const CHIP_TONE: Readonly<Record<InvoiceStatusKey, ChipTone>> = { void: "noshow", draft: "done", paid: "ready", partial: "confirmed", due: "waiting" };

export const METHOD_LABEL: Readonly<Record<string, string>> = { upi: "UPI", cash: "Cash", card: "Card", bank_transfer: "Bank", bank: "Bank", cheque: "Cheque" };

export const modeOf = (invoice: Invoice): string => (invoice.methods.length === 0 ? "—" : invoice.methods.map((m) => METHOD_LABEL[m] ?? m).join(", "));

/** The status chips above the table. */
export type StatusFilter = "all" | "paid" | "due" | "partial";
export const FILTERS: readonly { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "due", label: "Due" },
  { value: "partial", label: "Partial" },
];

export const matchesFilter = (invoice: Invoice, filter: StatusFilter): boolean => filter === "all" || invoiceStatus(invoice).key === filter;

/** Issued bills with something left to pay (due or partly paid), the biggest balance first. */
export const pendingOf = (rows: readonly Invoice[]): Invoice[] =>
  rows.filter((i) => i.status === "issued" && i.balance_paise > 0).toSorted((a, b) => b.balance_paise - a.balance_paise);

/** When a bill dates from: issued, else created. */
const dateOf = (invoice: Invoice): string => invoice.issued_at ?? invoice.created_at;

/** Bills oldest first, so a payment settles the oldest debt first. */
export const oldestFirst = (bills: readonly Invoice[]): Invoice[] =>
  bills.toSorted((a, b) => dateOf(a).localeCompare(dateOf(b)) || (a.number ?? "").localeCompare(b.number ?? ""));

/** One patient's unpaid bills in "To collect": the bills oldest first, what they add up to, and whether any is part paid. */
export interface PendingGroup {
  patient: Invoice["patient"];
  bills: [Invoice, ...Invoice[]];
  owed_paise: number;
  partly_paid: boolean;
}

/** Pending bills grouped into one row per patient, the biggest total owed first. */
export function groupPending(rows: readonly Invoice[]): PendingGroup[] {
  const byPatient = new Map<string, Invoice[]>();
  for (const bill of pendingOf(rows)) {
    const list = byPatient.get(bill.patient.id);
    if (list === undefined) byPatient.set(bill.patient.id, [bill]);
    else list.push(bill);
  }
  const groups: PendingGroup[] = [];
  for (const list of byPatient.values()) {
    const [oldest, ...rest] = oldestFirst(list);
    if (oldest === undefined) continue;
    const bills: [Invoice, ...Invoice[]] = [oldest, ...rest];
    groups.push({
      patient: oldest.patient,
      bills,
      owed_paise: bills.reduce((sum, bill) => sum + bill.balance_paise, 0),
      partly_paid: bills.some((bill) => invoiceStatus(bill).key === "partial"),
    });
  }
  return groups.toSorted((a, b) => b.owed_paise - a.owed_paise);
}

/** One bill's share of a payment. */
export interface Share {
  invoice_id: Invoice["id"];
  number: string;
  amount_paise: number;
}

/** Splits `amount` across the bills in order (oldest first), each up to its balance; bills it doesn't reach are left out. */
export function allocateOldestFirst(bills: readonly Invoice[], amount: number): Share[] {
  const shares: Share[] = [];
  let left = amount;
  for (const bill of bills) {
    if (left <= 0) break;
    const share = Math.min(left, bill.balance_paise);
    if (share > 0) shares.push({ invoice_id: bill.id, number: bill.number ?? "Draft", amount_paise: share });
    left -= share;
  }
  return shares;
}
