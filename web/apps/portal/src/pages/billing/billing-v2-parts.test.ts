import { describe, expect, it } from "vitest";

import { invoice as invoiceSchema, type Invoice } from "@aarogyam/api-client";

import { allocateOldestFirst, groupPending, oldestFirst } from "./billing-v2-parts.js";

let serial = 0;

/** An issued bill for a patient: what it came to, what was paid, and when it was issued. */
function bill(patient: "arjun" | "meera", total: number, paid: number, issued: string, status: "issued" | "draft" | "void" = "issued"): Invoice {
  serial += 1;
  return invoiceSchema.parse({
    id: `inv-${String(serial)}`,
    status,
    number: `SD/26-27/${String(serial).padStart(6, "0")}`,
    patient:
      patient === "arjun"
        ? { id: "11111111-1111-4111-8111-111111111111", name: "Arjun", number: "SD-1001" }
        : { id: "22222222-2222-4222-8222-222222222222", name: "Meera", number: "SD-1002" },
    items: [],
    subtotal_paise: total,
    discount_paise: 0,
    taxable_paise: 0,
    cgst_paise: 0,
    sgst_paise: 0,
    igst_paise: 0,
    tax_paise: 0,
    round_off_paise: 0,
    total_paise: total,
    paid_paise: paid,
    balance_paise: total - paid,
    methods: [],
    created_at: issued,
    issued_at: status === "draft" ? null : issued,
  });
}

describe("groupPending", () => {
  it("puts one patient's due and part-paid bills in one row, oldest bill first", () => {
    const partial = bill("arjun", 100_000, 40_000, "2026-11-10T10:00:00Z");
    const due = bill("arjun", 50_000, 0, "2026-11-02T10:00:00Z");
    const other = bill("meera", 20_000, 0, "2026-11-12T10:00:00Z");
    const paid = bill("meera", 30_000, 30_000, "2026-11-01T10:00:00Z");
    const draft = bill("meera", 9_000, 0, "2026-11-01T10:00:00Z", "draft");

    const groups = groupPending([partial, other, due, paid, draft]);

    expect(groups).toHaveLength(2);
    const [arjun, meera] = groups;
    expect(arjun?.patient.name).toBe("Arjun");
    expect(arjun?.bills.map((b) => b.id)).toEqual([due.id, partial.id]);
    expect(arjun?.owed_paise).toBe(110_000);
    expect(arjun?.partly_paid).toBe(true);
    expect(meera?.bills.map((b) => b.id)).toEqual([other.id]);
    expect(meera?.owed_paise).toBe(20_000);
    expect(meera?.partly_paid).toBe(false);
  });

  it("lists nothing when every issued bill is paid", () => {
    expect(groupPending([bill("arjun", 10_000, 10_000, "2026-11-01T10:00:00Z")])).toEqual([]);
  });
});

describe("allocateOldestFirst", () => {
  const older = bill("arjun", 50_000, 0, "2026-11-02T10:00:00Z");
  const newer = bill("arjun", 100_000, 40_000, "2026-11-10T10:00:00Z");
  const bills = oldestFirst([newer, older]);

  it("settles the oldest bill in full before the next", () => {
    expect(allocateOldestFirst(bills, 80_000).map((s) => [s.invoice_id, s.amount_paise])).toEqual([
      [older.id, 50_000],
      [newer.id, 30_000],
    ]);
  });

  it("leaves out a bill the amount doesn't reach", () => {
    expect(allocateOldestFirst(bills, 20_000).map((s) => [s.invoice_id, s.amount_paise])).toEqual([[older.id, 20_000]]);
  });

  it("never puts more on a bill than its balance", () => {
    const shares = allocateOldestFirst(bills, 500_000);
    expect(shares.map((s) => s.amount_paise)).toEqual([50_000, 60_000]);
  });
});
