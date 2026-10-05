import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderConsole } from "../../test/render-console.js";

describe("Quality page", () => {
  it("shows a tile per suite with counts, duration, last run and commit", async () => {
    renderConsole("/quality");
    const tile = (await screen.findAllByText(/aarogyam workspace \(unit\) · unit/))[0];
    expect(tile).toBeTruthy();
    expect(screen.getAllByText(/passed ·/).length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText(/Last run /).length).toBeGreaterThanOrEqual(4);
  });

  it("draws the pass-rate trend, lists failing and flaky tests, and the run history", async () => {
    renderConsole("/quality");
    await screen.findByRole("heading", { name: "Pass rate over time" });
    expect(screen.getByRole("table", { name: /Pass rate of each suite across the last 14 recorded runs/ })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Failing now" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Flaky tests" })).toBeTruthy();
    const history = screen.getByRole("table", { name: "Recorded quality runs, newest first" });
    expect(within(history).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["Result", "Started", "Commit", "Passed", "Failed", "Skipped", "Duration"]),
    );
  });

  it("explains how to record the first run when there are none", async () => {
    renderConsole("/quality", {
      override: (client) => ({ ...client, getQuality: () => Promise.resolve({ ok: true as const, value: { runs: [], trend: [], failing: [] } }) }),
    });
    expect(await screen.findByText("No runs recorded yet")).toBeTruthy();
    expect(screen.getAllByText("scripts/quality-run.sh [environment]").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.getByText(/var\/quality\//)).toBeTruthy();
  });
});
