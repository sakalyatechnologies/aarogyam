import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderConsole } from "../test/render-console.js";

describe("Console sign-in", () => {
  it("sits beside the console picture and keeps the sign-in heading", async () => {
    renderConsole("/sign-in", { signedIn: false });
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getAllByText("Sakalya Console").length).toBeGreaterThan(0);
    expect(screen.getByText("See how Aarogyam is doing, at a glance")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sakalya Admin" })).toBeTruthy();
  });
});


