import { describe, expect, it } from "vitest";

import { invoiceStatus } from "./invoice-status.js";

describe("invoiceStatus", () => {
  it("gives a bill one status, with the payment state winning once it is issued", () => {
    expect(invoiceStatus({ status: "draft", payment_state: null, paid_paise: 0 }).label).toBe("Draft");
    expect(invoiceStatus({ status: "void", payment_state: "paid", paid_paise: 100 }).label).toBe("Void");
    expect(invoiceStatus({ status: "issued", payment_state: "paid", paid_paise: 100 }).label).toBe("Paid");
    expect(invoiceStatus({ status: "issued", payment_state: "partial", paid_paise: 50 }).label).toBe("Partial");
    expect(invoiceStatus({ status: "issued", payment_state: "unpaid", paid_paise: 0 }).label).toBe("Due");
  });
});
