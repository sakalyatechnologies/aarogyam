import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PEOPLE, renderPortal } from "../../test/render.js";

describe("Messages", () => {
  it("labels the recall campaign a preview and switches off every control in it", async () => {
    renderPortal("/messages", { as: PEOPLE.asha });
    const card = (await screen.findByRole("heading", { name: "Recall campaign" })).closest("section");
    if (card === null) throw new Error("no campaign card");
    expect(within(card).getByText("Preview")).toBeTruthy();
    expect(within(card).getByText("Preview, sending isn't switched on yet.")).toBeTruthy();
    const buttons = within(card).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["WhatsApp", "SMS", "▶ Send to 0 patients"]);
    for (const button of buttons) expect(button).toHaveProperty("disabled", true);
  });
});
