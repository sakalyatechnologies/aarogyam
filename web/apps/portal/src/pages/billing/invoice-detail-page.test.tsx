import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PEOPLE, fakeApi, renderPortal } from "../../test/render.js";

describe("Bill page", () => {
  it("shows one status chip for an issued bill, not Issued beside its payment state", async () => {
    let id = "";
    const backend = fakeApi((fixtures) => {
      const sunrise = fixtures.clinics.find((c) => c.slug === "sunrise");
      id = fixtures.invoices.find((i) => i.clinic_id === sunrise?.id && i.status === "issued")?.id ?? "";
    });
    renderPortal(`/billing/invoices/${id}`, { as: PEOPLE.asha, backend });
    await screen.findByRole("heading", { level: 1 });
    // The Void button and the "Paid" amount label aren't chips.
    const chips = (await screen.findAllByText(/^(Paid|Partial|Due|Draft|Void|issued|paid|partial|unpaid)$/)).filter((el) => el.closest("button, dt") === null);
    expect(chips.map((chip) => chip.textContent)).toHaveLength(1);
    expect(["Paid", "Partial", "Due"]).toContain(chips[0]?.textContent);
  });
});
