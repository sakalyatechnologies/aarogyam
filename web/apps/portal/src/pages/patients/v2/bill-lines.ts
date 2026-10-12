/**
 * The bill for a visit, as editable lines: Consultation, then a line for each treatment done today with its price from the
 * clinic's price list. The screen edits these; `invoiceItems` turns them into what `POST /invoices` and `PATCH /invoices/{id}` take.
 */
import type { ChartEntry, Invoice, InvoiceLineInput, PriceItem } from "@aarogyam/api-client";

export interface BillLine {
  /** Stable while editing. */
  key: string;
  description: string;
  /** FDI tooth, for a treatment from the chart. */
  tooth?: number | undefined;
  qty: number;
  /** One unit, in rupees, as typed. */
  price: string;
  /** The price list's price for it, as typed; shown as the hint while the price still equals it. */
  listPrice?: string | undefined;
  priceItemId?: string | undefined;
  gstRate: number;
}

/** A rupee amount typed on screen, in paise; zero is allowed, blank or negative is not. */
export function paiseOrZero(text: string): number | undefined {
  const rupees = Number.parseFloat(text.replace(/,/g, "").trim());
  if (!Number.isFinite(rupees) || rupees < 0) return undefined;
  return Math.round(rupees * 100);
}

export const rupeeText = (paise: number): string => String(paise / 100);

let counter = 0;
export const newKey = (): string => `line-${String(++counter)}`;

/** Findings that are not work done: nothing to charge for. */
const NOT_BILLABLE = new Set(["sound", "caries", "watch", "fractured"]);

/** Words that find a price list entry for a chart finding. */
const FINDING_WORDS: Record<string, readonly string[]> = {
  filled: ["filling", "restoration"],
  crown: ["crown", "cap"],
  root_canal: ["root canal", "rct", "endodont"],
  implant: ["implant"],
  bridge: ["bridge"],
};

export interface Treatment {
  tooth: number;
  finding: string;
  procedure: string | undefined;
  surfaces: string;
  sitting: number | undefined;
}

/** What was done to teeth in this visit: its current chart entries that are work, one per tooth and treatment. */
export function treatmentsOf(entries: readonly ChartEntry[], visitId: string): Treatment[] {
  const found = new Map<string, Treatment>();
  for (const entry of entries) {
    if (entry.visit_id !== visitId || entry.status !== "current" || NOT_BILLABLE.has(entry.finding)) continue;
    const procedure = entry.procedure?.label;
    if (entry.finding === "missing" && procedure === undefined) continue;
    const key = `${String(entry.tooth)}|${entry.finding}|${procedure ?? ""}`;
    const existing = found.get(key);
    if (existing === undefined) {
      found.set(key, { tooth: entry.tooth, finding: entry.finding, procedure, surfaces: entry.surface ?? "", sitting: entry.sitting ?? undefined });
    } else if (entry.surface != null && !existing.surfaces.includes(entry.surface)) {
      existing.surfaces += entry.surface;
    }
  }
  return [...found.values()].sort((a, b) => a.tooth - b.tooth);
}

const nameHas = (item: PriceItem, words: readonly string[]) => {
  const text = `${item.name} ${item.code ?? ""}`.toLowerCase();
  return words.some((word) => text.includes(word));
};

/** The price list entry for a treatment: by the procedure's name first, then by the finding. A root canal prefers a per-sitting price. */
export function priceFor(treatment: Treatment, priceList: readonly PriceItem[]): PriceItem | undefined {
  const active = priceList.filter((p) => p.active);
  if (treatment.finding === "root_canal") {
    const canals = active.filter((p) => nameHas(p, FINDING_WORDS["root_canal"] ?? []));
    return canals.find((p) => /sitting|visit/i.test(p.name)) ?? canals[0];
  }
  const label = treatment.procedure?.toLowerCase();
  if (label !== undefined && label !== "") {
    const byName = active.find((p) => p.name.toLowerCase().includes(label) || label.includes(p.name.toLowerCase()));
    if (byName !== undefined) return byName;
  }
  return active.find((p) => nameHas(p, FINDING_WORDS[treatment.finding] ?? []));
}

const isConsultation = (item: PriceItem) => item.category === "consultation" || item.name.toLowerCase().includes("consultation");

export function lineFromPrice(item: PriceItem, extra: Partial<BillLine> = {}): BillLine {
  const price = rupeeText(item.price_paise);
  return { key: newKey(), description: item.name, qty: 1, price, listPrice: price, priceItemId: item.id, gstRate: item.taxable ? item.gst_rate : 0, ...extra };
}

/**
 * The lines to start from. A draft that already has more than the fee's one Consultation line (saved by Send for payment) is
 * taken as it is; otherwise Consultation plus a line for each treatment done today, priced from the list.
 */
export function seedLines(input: { entries: readonly ChartEntry[]; visitId: string; priceList: readonly PriceItem[]; draft: Invoice | undefined }): { lines: BillLine[]; discount: string } {
  const { draft, priceList } = input;
  const drafted = draft?.status === "draft" ? draft.items : [];
  const discount = drafted.reduce((sum, line) => sum + line.discount_paise, 0);
  const discountText = discount > 0 ? rupeeText(discount) : "";
  if (drafted.length > 1 || (drafted.length === 1 && drafted[0]?.description !== "Consultation")) {
    return {
      lines: drafted.map((l) => ({ key: newKey(), description: l.description, qty: l.quantity, price: rupeeText(l.unit_price_paise), priceItemId: l.price_item_id ?? undefined, gstRate: l.gst_rate })),
      discount: discountText,
    };
  }
  const consultation = priceList.find((p) => p.active && isConsultation(p));
  const fee = drafted[0];
  const lines: BillLine[] = [
    fee === undefined
      ? consultation === undefined
        ? { key: newKey(), description: "Consultation", qty: 1, price: "", gstRate: 0 }
        : lineFromPrice(consultation, { description: "Consultation" })
      : { key: newKey(), description: "Consultation", qty: 1, price: rupeeText(fee.unit_price_paise), listPrice: consultation === undefined ? undefined : rupeeText(consultation.price_paise), gstRate: fee.gst_rate },
  ];
  for (const treatment of treatmentsOf(input.entries, input.visitId)) {
    const item = priceFor(treatment, priceList);
    const name = item?.name ?? treatment.procedure ?? treatment.finding.replace(/_/g, " ");
    const suffix = treatment.finding === "root_canal" && treatment.sitting != null ? ` (sitting ${String(treatment.sitting)})` : "";
    const base = { description: `${name.charAt(0).toUpperCase()}${name.slice(1)}${suffix}`, tooth: treatment.tooth };
    lines.push(item === undefined ? { key: newKey(), ...base, qty: 1, price: "", gstRate: 0 } : lineFromPrice(item, base));
  }
  return { lines, discount: discountText };
}

export const lineTotal = (line: BillLine): number => (paiseOrZero(line.price) ?? 0) * line.qty;
export const subtotalOf = (lines: readonly BillLine[]): number => lines.reduce((sum, line) => sum + lineTotal(line), 0);

/** The bill total: lines less the discount, never below zero. */
export function totalOf(lines: readonly BillLine[], discountText: string): number {
  return Math.max(0, subtotalOf(lines) - (paiseOrZero(discountText) ?? 0));
}

/** What is wrong with the lines, in words, or undefined when they can be billed. */
export function problemWith(lines: readonly BillLine[], discountText: string): string | undefined {
  if (lines.length === 0) return "Add at least one line.";
  if (lines.some((l) => l.description.trim() === "")) return "Every line needs a description.";
  if (lines.some((l) => paiseOrZero(l.price) === undefined)) return "Every line needs a price.";
  if (lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1)) return "Quantity must be 1 or more.";
  if (discountText.trim() !== "" && paiseOrZero(discountText) === undefined) return "The discount is not an amount.";
  if ((paiseOrZero(discountText) ?? 0) > subtotalOf(lines)) return "The discount is more than the bill.";
  if (totalOf(lines, discountText) <= 0) return "The bill total is zero.";
  return undefined;
}

/** The lines as the API takes them, the discount shared out over the lines in proportion to their price. */
export function invoiceItems(lines: readonly BillLine[], discountText: string): InvoiceLineInput[] {
  const subtotal = subtotalOf(lines);
  let left = Math.min(paiseOrZero(discountText) ?? 0, subtotal);
  const shares = lines.map((line) => (subtotal === 0 ? 0 : Math.floor(((paiseOrZero(discountText) ?? 0) * lineTotal(line)) / subtotal)));
  left -= shares.reduce((a, b) => a + b, 0);
  return lines.map((line, index) => {
    const extra = left > 0 && lineTotal(line) - (shares[index] ?? 0) > 0 ? 1 : 0;
    left -= extra;
    const discount = Math.min(lineTotal(line), (shares[index] ?? 0) + extra);
    return {
      description: line.tooth === undefined ? line.description.trim() : `${line.description.trim()} (tooth ${String(line.tooth)})`,
      quantity: line.qty,
      unit_price_paise: paiseOrZero(line.price) ?? 0,
      gst_rate: line.gstRate,
      ...(discount > 0 ? { discount_paise: discount } : {}),
      ...(line.priceItemId === undefined ? {} : { price_item_id: line.priceItemId }),
    };
  });
}
