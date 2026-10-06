/**
 * The fake API's smart import: a small model of the server's (CSV only), enough for the
 * portal's wizard and its tests. The server is the reference: header synonyms in English,
 * Hindi and Marathi, values sniffed, lenient rows, duplicates by phone and name.
 */

import type * as C from "../contract.js";

/** A CSV file read into a header and data rows, each with its line in the file. */
export interface CsvTable {
  headers: string[];
  rows: { line: number; cells: string[] }[];
}

function sniffDelimiter(text: string): string {
  const first = text.split(/\r?\n/).find((line) => line.trim() !== "") ?? "";
  let best = ",";
  let most = 0;
  for (const delimiter of [",", ";", "\t", "|"]) {
    const n = first.split(delimiter).length - 1;
    if (n > most) {
      best = delimiter;
      most = n;
    }
  }
  return best;
}

/** Splits CSV text with quoted fields; blank lines are skipped, line numbers kept. */
export function readCsv(text: string): CsvTable | undefined {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = sniffDelimiter(source);
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRecord = () => {
    cells.push(field);
    field = "";
    if (cells.some((cell) => cell.trim() !== "")) {
      records.push({ line: start, cells: cells.map((cell) => cell.trim()) });
    }
    cells = [];
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === delimiter) {
      cells.push(field);
      field = "";
    } else if (ch === "\n") {
      endRecord();
      line += 1;
      start = line;
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  endRecord();
  const [header, ...rows] = records;
  if (header === undefined) return undefined;
  return { headers: header.cells.map((h, i) => (h === "" ? `Column ${String(i + 1)}` : h)), rows };
}

const SYNONYMS: Record<string, readonly string[]> = {
  full_name: ["name", "patient name", "full name", "naav", "naam", "नाव", "नाम"],
  phone: ["mobile", "mobile no", "phone", "phone no", "contact", "contact no", "mob", "फोन", "मोबाईल"],
  date_of_birth: ["dob", "d o b", "date of birth", "birth date", "janm tarikh", "जन्म तारीख"],
  age_years: ["age", "age yrs", "vay", "umar", "वय", "उम्र"],
  sex: ["sex", "gender", "ling", "लिंग"],
  email: ["email", "e mail", "email id"],
  address: ["address", "pata", "patta", "पत्ता"],
  last_visit: ["last visit", "last visit date", "visit date"],
  balance: ["balance", "due", "baki", "बाकी"],
  file_number: ["file no", "file number", "case no", "opd no"],
  legacy_id: ["patient id", "id", "old id", "uhid"],
};

const headerKey = (header: string) =>
  header
    .toLowerCase()
    .replace(/[\p{P}\s]+/gu, " ")
    .trim();

/** A field for each column from its header; each field goes to the first column naming it. */
export function suggestColumns(headers: readonly string[]): C.ColumnSuggestion[] {
  const taken = new Set<string>();
  return headers.map((header, column) => {
    const key = headerKey(header);
    const field = Object.entries(SYNONYMS).find(([, names]) => names.includes(key))?.[0];
    if (field === undefined || taken.has(field)) {
      return { column, header, field: null, confidence: 0, basis: "none" };
    }
    taken.add(field);
    return { column, header, field, confidence: 95, basis: "header" };
  });
}

const SEX: Record<string, C.Sex> = { f: "female", female: "female", m: "male", male: "male", o: "other", other: "other" };

function looseDate(text: string): string | undefined {
  const parts = text.split(/[-/.]/);
  if (parts.length !== 3) return undefined;
  const [a = "", b = "", c = ""] = parts;
  const [year, month, day] = a.length === 4 ? [a, b, c] : c.length === 4 ? [c, b, a] : [];
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

/** One row read leniently, as the server does. */
export interface ReadRow {
  line: number;
  name: string | undefined;
  phone: string | null;
  sex: C.Sex;
  dateOfBirth: string | null;
  estimated: boolean;
  email: string | null;
  missing: ("phone" | "sex" | "date_of_birth")[];
  errors: string[];
  warnings: string[];
}

/** Reads a row through a mapping of field to column; unreadable values are left empty. */
export function readRow(line: number, cells: readonly string[], mapping: Readonly<Record<string, number>>, today: Date): ReadRow {
  const get = (field: string) => {
    const column = mapping[field];
    const value = column === undefined ? undefined : cells[column]?.trim();
    return value === undefined || value === "" ? undefined : value;
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  const name = get("full_name")?.replace(/\s+/g, " ");
  if (name === undefined) errors.push("full_name: missing; a patient needs a name");
  let phone: string | null = null;
  const phoneRaw = get("phone");
  if (phoneRaw !== undefined) {
    const digits = phoneRaw.replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");
    if (/^[6-9]\d{9}$/.test(digits)) phone = `+91${digits}`;
    else warnings.push("phone: not a phone number we can read, left empty");
  }
  let sex: C.Sex = "unknown";
  const sexRaw = get("sex");
  if (sexRaw !== undefined) {
    const found = SEX[sexRaw.toLowerCase()];
    if (found === undefined) warnings.push("sex: not readable, left empty");
    else sex = found;
  }
  let dateOfBirth: string | null = null;
  let estimated = false;
  const dobRaw = get("date_of_birth");
  if (dobRaw !== undefined) {
    dateOfBirth = looseDate(dobRaw) ?? null;
    if (dateOfBirth === null) warnings.push("date_of_birth: not a date we can read, left empty");
  }
  const ageRaw = get("age_years");
  if (dateOfBirth === null && ageRaw !== undefined) {
    const age = Number.parseInt(ageRaw, 10);
    if (Number.isNaN(age) || age > 130) {
      warnings.push("age_years: not an age we can read, left empty");
    } else {
      dateOfBirth = `${String(today.getUTCFullYear() - age)}-01-01`;
      estimated = true;
    }
  }
  const emailRaw = get("email");
  const email = emailRaw !== undefined && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw.toLowerCase() : null;
  if (emailRaw !== undefined && email === null) warnings.push("email: not a valid address, left empty");
  const missing: ReadRow["missing"] = [];
  if (phone === null) missing.push("phone");
  if (sex === "unknown") missing.push("sex");
  if (dateOfBirth === null) missing.push("date_of_birth");
  return { line, name, phone, sex, dateOfBirth, estimated, email, missing, errors, warnings };
}
