import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GuidesPage } from "./guides-page.js";
import type { GuideIndex } from "./types.js";
import { markWatched } from "./watched.js";

const INDEX: GuideIndex = {
  guides: [
    { id: "billing-one", title: "Collect a payment", role: "billing", summary: "Take money.", order: 1, seconds: 100, steps: 8, still: "billing-one/01.webp" },
    { id: "start", title: "Start here: a tour", role: "getting-started", summary: "The tour.", order: 1, seconds: 130, steps: 10, still: "start/01.webp" },
    { id: "desk-b", title: "Second desk guide", role: "front-desk", summary: "B.", order: 2, seconds: 60, steps: 6, still: "desk-b/01.webp" },
    { id: "desk-a", title: "First desk guide", role: "front-desk", summary: "A.", order: 1, seconds: 90, steps: 7, still: "desk-a/01.webp" },
  ],
};

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(INDEX), { status: 200 }))));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const open = () =>
  render(
    <MemoryRouter>
      <GuidesPage />
    </MemoryRouter>,
  );

describe("GuidesPage", () => {
  it("groups guides by role, Start here first, in their order", async () => {
    open();
    await screen.findByText("Start here: a tour");
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(["Getting started", "Front desk", "Billing"]);
    const desk = screen.getByRole("region", { name: "Front desk" });
    expect(within(desk).getAllByRole("link").map((a) => a.textContent)).toEqual([expect.stringContaining("First desk guide"), expect.stringContaining("Second desk guide")]);
    expect(screen.getByText("Start here")).toBeTruthy();
    expect(screen.getByText(/1.5 min · 8 steps/)).toBeTruthy();
  });

  it("ticks a guide as Watched, and survives blocked storage", async () => {
    markWatched("desk-a");
    open();
    await screen.findByText("First desk guide");
    expect(screen.getAllByText("Watched")).toHaveLength(1);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => {
      markWatched("start");
    }).not.toThrow();
    vi.restoreAllMocks();
  });

  it("says so when the guides cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("nope", { status: 404 }))));
    open();
    expect(await screen.findByText("The guides are not available right now.")).toBeTruthy();
  });
});
