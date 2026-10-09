import type { Invoice } from "@aarogyam/api-client";

export type InvoiceStatusKey = "draft" | "void" | "paid" | "partial" | "due";

/**
 * A bill's one status, folding the issue state and the payment state together: an issued bill
 * shows how much is paid ("Paid", "Partly paid", "Due"), never "Issued" beside "paid".
 */
export function invoiceStatus(invoice: Pick<Invoice, "status" | "payment_state"> & { paid_paise: number }): { key: InvoiceStatusKey; label: string } {
  if (invoice.status === "void") return { key: "void", label: "Void" };
  if (invoice.status !== "issued") return { key: "draft", label: "Draft" };
  if (invoice.payment_state === "paid") return { key: "paid", label: "Paid" };
  if (invoice.payment_state === "partial" || invoice.paid_paise > 0) return { key: "partial", label: "Partial" };
  return { key: "due", label: "Due" };
}

/** The tone each status takes on a pill or tag. */
export const INVOICE_STATUS_TONE: Readonly<Record<InvoiceStatusKey, "neutral" | "success" | "warning" | "danger">> = {
  draft: "neutral",
  void: "danger",
  paid: "success",
  partial: "warning",
  due: "warning",
};
