import { describe, expect, it } from "vitest";

import { invoiceId, type ApiClient, type ApiResult } from "../index.js";
import { createFakeBackend, createFixtures, fakeTokenFor } from "./index.js";

const NOW = new Date("2026-10-03T05:30:00Z");
const ASHA = "a1a1a1a1-0000-4000-8000-000000000001";
const FARAH = "a1a1a1a1-0000-4000-8000-000000000003";
const BINA = "b1b1b1b1-0000-4000-8000-000000000001";

function setup() {
  const backend = createFakeBackend(createFixtures({ now: NOW }));
  return (who: string, host: string): ApiClient => backend.client({ host, getToken: () => fakeTokenFor({ id: who }), now: () => NOW });
}
function value<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(`expected success, got ${String(result.error.status)} ${result.error.message}`);
  return result.value;
}
const status = <T>(result: ApiResult<T>) => (result.ok ? 200 : result.error.status);

describe("fake client: UPI link for a bill", () => {
  it("gives the link for an issued bill with a balance, and refuses a draft", async () => {
    const as = setup();
    const owner = as(ASHA, "sunrise.localtest.me");
    const patient = value(await owner.listPatients()).items[0];
    if (patient === undefined) throw new Error("no patient");
    const draft = value(await owner.createInvoice({ patient_id: patient.id, items: [{ description: "Consultation", quantity: 1, unit_price_paise: 50000 }] }));
    expect(status(await owner.getInvoiceUpiLink(draft.id))).toBe(409);
    const issued = value(await owner.issueInvoice(draft.id));
    const link = value(await owner.getInvoiceUpiLink(issued.id));
    expect(link.upi_id).toBe("sunrisedental@okicici");
    expect(link.amount_paise).toBe(issued.balance_paise);
    expect(link.uri.startsWith("upi://pay?")).toBe(true);
    expect(link.invoice_number).toBe(issued.number);
  });

  it("needs billing.read and answers 404 for another clinic's bill", async () => {
    const as = setup();
    const owner = as(ASHA, "sunrise.localtest.me");
    const bill = value(await owner.listInvoices({})).items.find((i) => i.status === "issued" && i.balance_paise > 0);
    if (bill === undefined) throw new Error("no bill with a balance");
    expect(status(await owner.getInvoiceUpiLink(bill.id))).toBe(200);
    expect(status(await as(BINA, "lotus.localtest.me").getInvoiceUpiLink(bill.id))).toBe(404);
    expect(status(await as(FARAH, "sunrise.localtest.me").getInvoiceUpiLink(invoiceId.parse("0192f1c4-7a10-7c3e-9b2a-000000000000")))).toBe(404);
  });
});
