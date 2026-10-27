/** The fake's purchase orders and stock import, with the same rules as the API (`aarogyam-app::purchase_orders`, `aarogyam-domain::stock_import`). */

import type * as C from "../contract.js";
import { MAX_MOVEMENT, isStockUnit } from "./stock.js";

export interface FakePoLine {
  id: string;
  item_id: string;
  quantity: number;
  unit_cost_paise: number | null;
  received_quantity: number;
}

export interface FakePurchaseOrder {
  id: string;
  clinic_id: string;
  number: string;
  supplier_id: string;
  status: C.PurchaseOrder["status"];
  expected_on: string | null;
  notes: string | null;
  ordered_at: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  lines: FakePoLine[];
  receipts: { line_id: string; batch_id: string; quantity: number; at: string }[];
}

/** One checked row of an import. */
export interface FakeImportRow {
  row: number;
  name: string;
  category: string | null;
  unit: string | null;
  reorder_level: number | null;
  max_level: number | null;
  quantity: number;
  unit_cost_paise: number | null;
  batch_no: string | null;
  expiry: string | null;
  supplier: string | null;
}

export interface FakeStockImport {
  clinic_id: string;
  token: string;
  file_name: string;
  file_sha: string;
  rows: FakeImportRow[];
  status: "open" | "committed" | "expired";
  result: C.StockImportResult | null;
  expires_at: string;
}

/** Most data rows in a stock list. */
export const MAX_IMPORT_ROWS = 1000;
/** Most lines on an order. */
export const MAX_PO_LINES = 100;

/** Splits one CSV line, honouring double quotes. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line.charAt(i);
    if (quoted) {
      if (c === '"' && line.charAt(i + 1) === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      cells.push(cell);
      cell = "";
    } else cell += c;
  }
  cells.push(cell);
  return cells;
}

const key = (header: string): string => header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const HEADERS: Readonly<Record<string, readonly string[]>> = {
  name: ["name", "item", "item name", "product", "material", "description"],
  category: ["category", "type", "group"],
  unit: ["unit", "uom", "unit of measure"],
  reorder_level: ["reorder level", "reorder", "reorder at", "min", "min level", "minimum"],
  max_level: ["max level", "max", "maximum", "par", "par level", "order up to"],
  quantity: ["quantity", "qty", "on hand", "stock", "opening stock", "received"],
  unit_cost: ["unit cost", "cost", "price", "cost per unit", "rate"],
  unit_cost_paise: ["unit cost paise", "cost paise"],
  batch_no: ["batch", "batch no", "batch number", "lot"],
  expiry: ["expiry", "expiry date", "exp", "expires"],
  supplier: ["supplier", "vendor", "supplier name"],
};

function whole(text: string): number | null {
  const digits = text.replace(/[, ]/g, "").replace(/\.0$/, "");
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  return value <= MAX_MOVEMENT ? value : null;
}

function rupees(text: string): number | null {
  const cleaned = text.replace(/^[₹ ]+/, "").replace(/[, ]/g, "");
  const match = /^(\d*)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (match === null || cleaned === "") return null;
  const paise = Number(match[1] || "0") * 100 + Number((match[2] ?? "").padEnd(2, "0") || "0");
  return paise <= 100_000_000 ? paise : null;
}

function day(text: string): string | null {
  const parts = text.split(/[-/.]/).map((p) => p.trim());
  if (parts.length !== 3) return null;
  const [a = "", b = "", c = ""] = parts;
  const [y, m, d] = a.length === 4 ? [a, b, c] : c.length === 4 ? [c, b, a] : ["", "", ""];
  if (y === "") return null;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

/** Reads a CSV list: `null` with a message when the file itself is unusable, else the rows that passed and the errors by row. */
export function parseStockCsv(text: string): { rowCount: number; rows: FakeImportRow[]; errors: C.StockImportError[] } | string {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => line.trim() !== "");
  const first = lines[0];
  if (first === undefined) return "the file is empty";
  const delimiter = [",", ";", "\t", "|"].reduce((best, d) => (first.line.split(d).length > first.line.split(best).length ? d : best), ",");
  const index: Record<string, number> = {};
  splitLine(first.line, delimiter).forEach((header, i) => {
    for (const [field, names] of Object.entries(HEADERS)) {
      if (names.includes(key(header)) && !(field in index)) index[field] = i;
    }
  });
  if (!("name" in index)) return "the file needs a column named name (or item)";
  const data = lines.slice(1);
  if (data.length === 0) return "the file has no rows under its header";
  if (data.length > MAX_IMPORT_ROWS) return `the file has more than ${String(MAX_IMPORT_ROWS)} rows`;
  const rows: FakeImportRow[] = [];
  const errors: C.StockImportError[] = [];
  for (const { line, number } of data) {
    const cells = splitLine(line, delimiter);
    const cell = (field: string): string | null => {
      const i = index[field];
      const value = i === undefined ? undefined : cells[i]?.trim();
      return value === undefined || value === "" ? null : value;
    };
    const before = errors.length;
    const bad = (field: string, message: string): void => void errors.push({ row: number, field, message });
    const name = cell("name");
    if (name === null) bad("name", "is required");
    else if (name.length > 200) bad("name", "must be at most 200 characters");
    const unitText = cell("unit");
    const unit = unitText === null ? null : unitText.toLowerCase();
    if (unit !== null && !isStockUnit(unit)) bad("unit", "must be piece, ml, g, box or pack");
    const number_ = (field: string, parse: (t: string) => number | null, message: string): number | null => {
      const text = cell(field);
      if (text === null) return null;
      const value = parse(text);
      if (value === null) bad(field, message);
      return value;
    };
    const reorder = number_("reorder_level", whole, "must be a whole number");
    const max = number_("max_level", whole, "must be a whole number");
    if (reorder !== null && max !== null && max < reorder) bad("max_level", "must not be below the reorder level");
    const quantityText = cell("quantity");
    let quantity = 0;
    if (quantityText !== null) {
      const value = whole(quantityText);
      if (value === null) bad("quantity", "must be a whole number of units");
      else quantity = value;
    }
    const cost = cell("unit_cost_paise") !== null ? number_("unit_cost_paise", whole, "must be a whole number of paise") : number_("unit_cost", rupees, "must be an amount in rupees");
    const expiryText = cell("expiry");
    const expiry = expiryText === null ? null : day(expiryText);
    if (expiryText !== null && expiry === null) bad("expiry", "must be a date such as 2027-03-31 or 31/03/2027");
    const batch = cell("batch_no");
    const supplier = cell("supplier");
    if (quantity === 0 && (batch !== null || expiry !== null || supplier !== null)) bad("quantity", "is needed with a batch number, expiry or supplier");
    if (errors.length === before && name !== null) {
      rows.push({
        row: number,
        name,
        category: cell("category")?.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") ?? null,
        unit,
        reorder_level: reorder,
        max_level: max,
        quantity,
        unit_cost_paise: cost,
        batch_no: batch,
        expiry,
        supplier,
      });
    }
  }
  return { rowCount: data.length, rows, errors };
}
