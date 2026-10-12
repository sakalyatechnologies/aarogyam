import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { fakeTokenFor } from "@aarogyam/api-client/fake";
import { chartEntry, patientId as toPatientId, priceItem, type InvoiceEdit, type NewInvoice, type NewPayment } from "@aarogyam/api-client";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { NOW, PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";
import { invoiceItems, priceFor, seedLines, totalOf, treatmentsOf, type BillLine } from "./bill-lines.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function axeViolations(): Promise<string[]> {
  const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

/** A closed-visit patient; today's treatments are charted against the visit once it is started. */
function setup() {
  let patientId = "";
  const backend = fakeApi((fixtures) => {
    const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
    patientId = fixtures.visits.find((v) => v.clinic_id === sunrise?.id)?.patient_id ?? "";
  });
  const api = backend.client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: PEOPLE.asha }), now: () => NOW });
  /** Starts today's visit (as the doctor would) and charts the work done in it, before the screen opens. */
  const chartToday = async (entries: { tooth: number; finding: string; procedure?: string; sitting?: number; canals?: { name: string }[] }[]) => {
    const started = await api.startVisit(toPatientId.parse(patientId), {});
    if (!started.ok) throw new Error("no visit");
    const done = await api.recordChartEntries(toPatientId.parse(patientId), { visit_id: started.value.id, entries });
    if (!done.ok) throw new Error("chart");
  };
  return { backend, patientId, chartToday };
}

const uuid = (n: number) => `01a1003d-9bc0-70fb-8867-${String(n).padStart(12, "0")}`;
const VISIT = uuid(1);

describe("bill lines", () => {
  const price = (n: number, name: string, code: string, price_paise: number, category: string | null = null) =>
    priceItem.parse({ id: uuid(100 + n), name, code, category, price_paise, taxable: false, gst_rate: 0, active: true });
  const priceList = [
    price(1, "Consultation", "CONS", 50_000, "consultation"),
    price(2, "Composite filling", "FILL", 180_000),
    price(3, "Root canal treatment", "RCT", 600_000),
    price(4, "Root canal, per sitting", "RCT1", 200_000),
  ];
  const entry = (tooth: number, finding: string, procedure: string | null, extra: Record<string, unknown> = {}) =>
    chartEntry.parse({
      id: uuid(200 + tooth),
      tooth,
      finding,
      procedure: procedure === null ? null : { id: procedure, kind: "procedure", label: procedure, own: false, retired: false },
      status: "current",
      visit_id: VISIT,
      effective_at: NOW.toISOString(),
      canals: [],
      in_progress: false,
      ...extra,
    });

  it("matches a treatment to the price list, and a root canal to the per-sitting price when there is one", () => {
    const [filling, canal] = treatmentsOf([entry(36, "filled", "Filling"), entry(46, "root_canal", "Root canal treatment", { sitting: 2 })], VISIT);
    expect(filling && priceFor(filling, priceList)?.name).toBe("Composite filling");
    expect(canal && priceFor(canal, priceList)?.name).toBe("Root canal, per sitting");
    expect(canal && priceFor(canal, priceList.slice(0, 3))?.name).toBe("Root canal treatment");
  });

  it("leaves out findings that are not work, and other visits", () => {
    expect(treatmentsOf([entry(11, "caries", null), entry(12, "sound", null), entry(13, "filled", "Filling", { visit_id: uuid(2) })], VISIT)).toEqual([]);
  });

  it("seeds Consultation and a line per treatment with tooth and price", () => {
    const { lines } = seedLines({ entries: [entry(36, "filled", "Filling")], visitId: VISIT, priceList: priceList, draft: undefined });
    expect(lines.map((l) => [l.description, l.tooth, l.price])).toEqual([
      ["Consultation", undefined, "500"],
      ["Composite filling", 36, "1800"],
    ]);
  });

  it("shares the discount over the lines and keeps the tooth in the description", () => {
    const lines: BillLine[] = [
      { key: "a", description: "Consultation", qty: 1, price: "500", gstRate: 0 },
      { key: "b", description: "Filling", tooth: 36, qty: 2, price: "1000", gstRate: 0 },
    ];
    expect(totalOf(lines, "250")).toBe(225_000);
    const items = invoiceItems(lines, "250");
    expect(items.map((i) => i.description)).toEqual(["Consultation", "Filling (tooth 36)"]);
    expect(items.reduce((sum, i) => sum + (i.discount_paise ?? 0), 0)).toBe(25_000);
  });
});

describe("The Collect payment step", () => {
  it("pre-fills lines from today's treatments, edits change the total, and Record payment saves the lines then pays with a key", async () => {
    const user = userEvent.setup();
    const { patientId, backend, chartToday } = setup();
    const path = `/patients/${patientId}`;
    await chartToday([{ tooth: 36, finding: "filled", procedure: "filling" }]);
    const calls: string[] = [];
    let created: NewInvoice | undefined;
    let edited: InvoiceEdit | undefined;
    const payments: { input: NewPayment; key: string }[] = [];
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        createInvoice: (input, options) => {
          calls.push("create");
          created = input;
          return client.createInvoice(input, options);
        },
        editInvoice: (id, changes, options) => {
          calls.push("edit");
          edited = changes;
          return client.editInvoice(id, changes, options);
        },
        recordPayment: (input, key, options) => {
          calls.push("pay");
          payments.push({ input, key });
          return client.recordPayment(input, key, options);
        },
      }),
    });
    await user.click(await screen.findByRole("button", { name: "End visit" }));
    await user.click(await screen.findByRole("button", { name: "Collect payment" }));
    const drawer = await screen.findByRole("dialog", { name: "Collect payment" });

    // Consultation and the filling, priced from the list.
    const lines = await within(drawer).findByRole("list", { name: "Bill lines" });
    expect(within(lines).getByLabelText("Price of Consultation (₹)")).toHaveProperty("value", "500");
    expect(within(lines).getByLabelText("Price of Composite filling (₹)")).toHaveProperty("value", "1800");
    expect(within(lines).getByText("Tooth 36")).toBeTruthy();
    expect(within(lines).getAllByText(/from price list/).length).toBe(2);
    expect(within(drawer).getByTestId("bill-total").textContent).toBe("₹2,300");

    // Edit a price and the quantity, add a line from the list, remove one, take a discount.
    await user.clear(within(lines).getByLabelText("Price of Composite filling (₹)"));
    await user.type(within(lines).getByLabelText("Price of Composite filling (₹)"), "1500");
    expect(within(drawer).getByTestId("bill-total").textContent).toBe("₹2,000");
    await user.tripleClick(within(lines).getByLabelText("Quantity of Composite filling"));
    await user.keyboard("2");
    expect(within(drawer).getByTestId("bill-total").textContent).toBe("₹3,500");
    await user.click(within(drawer).getByRole("button", { name: "Add line" }));
    await user.selectOptions(within(drawer).getByLabelText("Add from the price list"), screen.getByRole("option", { name: /Tooth extraction/ }));
    expect(within(drawer).getByTestId("bill-total").textContent).toBe("₹4,700");
    await user.click(within(drawer).getByRole("button", { name: "Remove Consultation" }));
    expect(within(drawer).getByTestId("bill-total").textContent).toBe("₹4,200");
    await user.click(within(drawer).getByRole("button", { name: "Add line" }));
    await user.click(within(drawer).getByRole("button", { name: "Type your own" }));
    await user.type(within(drawer).getByLabelText("Description of new line"), "Mouthwash");
    await user.type(within(drawer).getByLabelText("Price of Mouthwash (₹)"), "200");
    await user.type(within(drawer).getByLabelText("Discount (₹)"), "100");
    expect(within(drawer).getByTestId("bill-total").textContent).toBe("₹4,300");
    expect(await axeViolations()).toEqual([]);

    // A part payment: the lines are saved first, then the payment with its idempotency key.
    await user.type(within(drawer).getByLabelText(/^Amount/), "1000");
    await user.click(within(drawer).getByRole("button", { name: "Record payment" }));
    expect(await within(drawer).findByText(/Recorded ₹1,000/)).toBeTruthy();
    expect(calls[0]).toBe("create");
    expect(calls.at(-1)).toBe("pay");
    expect(created?.encounter_id).toBeTruthy();
    expect(created?.items?.map((i) => [i.description, i.quantity, i.unit_price_paise])).toEqual([
      ["Composite filling (tooth 36)", 2, 150_000],
      ["Tooth extraction", 1, 120_000],
      ["Mouthwash", 1, 20_000],
    ]);
    expect(edited).toBeUndefined();
    expect(payments).toHaveLength(1);
    expect(payments[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
    expect(payments[0]?.input).toMatchObject({ amount_paise: 100_000 });
    expect(within(drawer).getByText("₹3,300")).toBeTruthy();
  });
});

describe("Send for payment and the End visit step", () => {
  it("suggests a total at End visit, saves the lines to a draft bill on Send for payment, and the celebration opens that bill", async () => {
    const user = userEvent.setup();
    const { patientId, backend, chartToday } = setup();
    const path = `/patients/${patientId}`;
    await chartToday([{ tooth: 46, finding: "root_canal", procedure: "root_canal", sitting: 1, canals: [{ name: "MB" }] }]);
    let saved: NewInvoice | undefined;
    renderPortal(path, {
      as: PEOPLE.asha,
      backend,
      wrap: (client) => ({
        ...client,
        createInvoice: (input, options) => {
          saved = input;
          return client.createInvoice(input, options);
        },
      }),
    });
    expect(await screen.findByText(/Suggested total ₹6,500/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "End visit" }));
    await user.click(await screen.findByRole("button", { name: "Send for payment" }));
    const done = await screen.findByRole("dialog", { name: "Visit completed" });
    await waitFor(() => {
      expect(saved?.items?.map((i) => i.description)).toEqual(["Consultation", "Root canal treatment (sitting 1) (tooth 46)"]);
    });
    expect(await within(done).findByRole("button", { name: "Open bill" })).toBeTruthy();
    expect(within(done).queryByRole("button", { name: /Create the bill/ })).toBeNull();
  });
});
