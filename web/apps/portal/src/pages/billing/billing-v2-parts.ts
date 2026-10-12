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
