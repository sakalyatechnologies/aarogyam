import { screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it } from "vitest";

import { renderPortal } from "../../test/render.js";
import { LEARN_TOPICS } from "./learn-topics.js";

const SUNRISE = "sunrise.localtest.me";

describe("Care tips (public)", () => {
  it("lists every topic and links to booking", async () => {
    renderPortal(`/learn?clinic=${SUNRISE}`);
    expect(await screen.findByRole("heading", { name: "Care tips" })).toBeTruthy();
    for (const topic of LEARN_TOPICS) expect(screen.getByRole("link", { name: topic.title })).toBeTruthy();
    expect(LEARN_TOPICS.length).toBeGreaterThanOrEqual(6);
    expect(screen.getByRole("link", { name: "Book a visit" }).getAttribute("href")).toContain("/book");
    expect(await screen.findByText("Sunrise Dental")).toBeTruthy();
  });

  it("shows one topic", async () => {
    renderPortal(`/learn/after-a-tooth-extraction?clinic=${SUNRISE}`);
    expect(await screen.findByRole("heading", { name: "After a tooth extraction" })).toBeTruthy();
    expect(screen.getByText(/follow your dentist's advice/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Book a visit" })).toBeTruthy();
  });

  it("shows not found for an unknown topic", async () => {
    renderPortal(`/learn/no-such-topic?clinic=${SUNRISE}`);
    expect(await screen.findByText("We couldn't find that page")).toBeTruthy();
    expect(screen.getByRole("link", { name: "All care tips" })).toBeTruthy();
  });

  it("has no axe violations", async () => {
    renderPortal(`/learn/brushing-and-flossing?clinic=${SUNRISE}`);
    await screen.findByRole("heading", { name: "Brushing and flossing" });
    const result = await axe.run(document.body, { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } });
    expect(result.violations).toEqual([]);
  });
});
