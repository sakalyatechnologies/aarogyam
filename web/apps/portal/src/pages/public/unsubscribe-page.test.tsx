import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";

import { renderPortal } from "../../test/render.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const TOKEN = "u".repeat(43);

afterEach(cleanup);

describe("Unsubscribe (public)", () => {
  it("asks before unsubscribing, then confirms", async () => {
    const user = userEvent.setup();
    renderPortal(`/unsubscribe#${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Stop these emails?" })).toBeTruthy();
    expect(await axe.run(document.body, AXE).then((r) => r.violations.map((v) => v.id))).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByText("You're unsubscribed")).toBeTruthy();
    expect(screen.getByText(/messages about your care still arrive/)).toBeTruthy();
  });

  it("says a link without a token, or one the server doesn't know, isn't valid", async () => {
    renderPortal("/unsubscribe");
    expect(await screen.findByText("This link isn't valid")).toBeTruthy();
    cleanup();

    const user = userEvent.setup();
    renderPortal(`/unsubscribe#${"x".repeat(101)}`);
    await user.click(await screen.findByRole("button", { name: "Unsubscribe" }));
    expect(await screen.findByText("This link isn't valid")).toBeTruthy();
  });
});
