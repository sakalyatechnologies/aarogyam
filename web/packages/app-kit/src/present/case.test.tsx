// The usual implant case (slice 2d-1).
import { fakePresentStudio } from "@aarogyam/api-client/fake";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import { ART_KEYS } from "../mouth-art/art-map.js";
import { BRIDGE_CASE, IMPLANT_CASE, SCALING_CASE, UsualCase, VENEER_CASE, WISDOM_CASE } from "./case.js";
import { SituationOptions } from "./options.js";

afterEach(cleanup);

describe("the implant case", () => {
  it("has the five steps and every art key resolves to a 2D scene", () => {
    expect(IMPLANT_CASE.steps.map((s) => s.key)).toEqual(["gap", "place", "heal", "abutment", "crown"]);
    for (const s of IMPLANT_CASE.steps) expect(ART_KEYS.has(s.art), s.art).toBe(true);
  });

  it("reads as general guidance with no visit numbers, dates or prices", () => {
    const { container } = render(<UsualCase data={IMPLANT_CASE} />);
    expect(container.textContent).toContain("Usually 3–6 months");
    expect(container.textContent).toContain("Usual plan · general guidance");
    expect(container.textContent).not.toMatch(/₹|Visit \d/);
  });

  it("shows on the implant options and not on the others", async () => {
    const missing = fakePresentStudio(adultFixture.snapshot).situations.find((s) => s.key === "missing");
    if (missing === undefined) throw new Error("no missing situation");
    const { container } = render(<SituationOptions situation={missing} />);
    // the steps load lazily (route size budget)
    await waitFor(() => { expect(container.querySelector('[data-option="implant"] [data-case="implant"]')).not.toBeNull(); });
    await waitFor(() => { expect(container.querySelector('[data-option="bridge"] [data-case="bridge"]')).not.toBeNull(); });
    expect(container.querySelector('[data-option="leave_gap"] [data-case]')).toBeNull();
  });
});

describe("the wisdom tooth case", () => {
  it("has the five steps and every art key resolves to a 2D scene", () => {
    expect(WISDOM_CASE.steps.map((s) => s.key)).toEqual(["before", "remove", "day1", "week1", "healed"]);
    for (const s of WISDOM_CASE.steps) expect(ART_KEYS.has(s.art), s.art).toBe(true);
  });

  it("reads as general guidance with no visit numbers, dates or prices", () => {
    const { container } = render(<UsualCase data={WISDOM_CASE} />);
    expect(container.textContent).toContain("Usually 1–2 weeks");
    expect(container.textContent).toContain("Usual plan · general guidance");
    expect(container.textContent).not.toMatch(/₹|Visit \d/);
  });
});

describe.each([
  ["bridge", BRIDGE_CASE, ["bridge_prep", "bridge_fit"]],
  ["scaling", SCALING_CASE, ["scale", "polish", "recheck"]],
  ["veneer", VENEER_CASE, ["prep", "veneer"]],
])("the %s case", (_name, data, keys) => {
  it("has its steps and every art key resolves to 2D art", () => {
    expect(data.steps.map((s) => s.key)).toEqual(keys);
    for (const s of data.steps) expect(ART_KEYS.has(s.art), s.art).toBe(true);
  });

  it("reads as general guidance with no visit numbers, dates or prices", () => {
    const { container } = render(<UsualCase data={data} />);
    expect(container.textContent).toContain("Usual plan · general guidance");
    expect(container.textContent).not.toMatch(/₹|Visit \d/);
  });
});
