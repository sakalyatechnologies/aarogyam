import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ALIGNERS_CASE, BRACES_CASE } from "./case.js";
import { bracketsOf, exampleScene, frontFace, wireOf } from "./example-arch.js";
import { StraighterTeeth, applianceOf } from "./straighter-teeth.js";

afterEach(cleanup);

describe("the example arch", () => {
  it("is crowded at progress 0 and straight at 1", () => {
    const a = exampleScene(0), b = exampleScene(1);
    expect(a.teeth).toHaveLength(28);
    expect(a.teeth.map((t) => [t.xl, t.top])).not.toEqual(b.teeth.map((t) => [t.xl, t.top]));
    expect(a.teeth.every((t) => !t.faded && !t.missing && !t.hidden)).toBe(true);
    // the back teeth never move
    expect(a.teeth.every((t, i) => t.n <= 3 || t.xl === b.teeth[i]?.xl)).toBe(true);
  });
  it("crowds the front teeth into contact: no gap wider than .35 mm, a vertical shift of at most .5 mm", () => {
    const flat = exampleScene(1), s = exampleScene(0);
    for (const arch of ["u", "l"] as const) {
      const row = s.teeth.filter((t) => t.arch === arch).sort((a, b) => a.xl - b.xl);
      for (let i = 1; i < row.length; i++) expect((row[i]?.xl ?? 0) - (row[i - 1]?.xr ?? 0)).toBeLessThan(.35);
    }
    s.teeth.forEach((t, i) => { expect(Math.abs(t.top - (flat.teeth[i]?.top ?? 0))).toBeLessThanOrEqual(.5); });
    expect(s.teeth.some((t) => t.tilt !== undefined)).toBe(true);
  });
  it("is deterministic", () => { expect(exampleScene(.35)).toEqual(exampleScene(.35)); });
  it("puts one bracket on each front-face tooth, with a wire per arch", () => {
    const s = exampleScene(.5);
    const brackets = bracketsOf(s);
    expect(brackets).toHaveLength(frontFace(s).length);
    expect(brackets).toHaveLength(24);
    expect(wireOf(brackets, "u")).toHaveLength(12);
  });
});

describe("straighter teeth", () => {
  it("shows the steps and switches between them", () => {
    const { container, getByText } = render(<StraighterTeeth data={BRACES_CASE} />);
    expect(container.querySelectorAll("[data-step-chip]")).toHaveLength(BRACES_CASE.steps.length);
    expect(container.textContent).toContain("Example teeth, not yours");
    expect(container.textContent).toContain("general guidance");
    const second = BRACES_CASE.steps[1];
    if (second === undefined) throw new Error("no step");
    fireEvent.click(getByText(second.label));
    expect(container.querySelector("section")?.getAttribute("data-step")).toBe(second.key);
    expect(container.textContent).toContain(second.words);
  });
  it("draws the right appliance", () => {
    expect(applianceOf("braces", "month3")).toBe("braces");
    expect(applianceOf(ALIGNERS_CASE.key, "month9")).toBe("aligners");
    expect(applianceOf("braces", "finish")).toBe("none");
    expect(applianceOf("aligners", "retainer")).toBe("retainer");
  });
});
