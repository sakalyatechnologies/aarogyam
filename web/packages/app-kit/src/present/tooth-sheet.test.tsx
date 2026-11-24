// ToothSheet and CompareSlider (present-studio-design §5.3, §14.1; slice 1c).
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type { Snapshot } from "../mouth-view/model.js";
import { sharedBox } from "./compare-slider.js";
import { presentFacts } from "./model.js";
import { PaintedStyle } from "./painted.js";
import { ToothSheet, sheetContent } from "./tooth-sheet.js";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const adult = (): Snapshot => structuredClone(adultFixture.snapshot);
const adultModel = () => presentFacts(adult());
/** The adult with a next visit booked on 46's second step. */
const withNext = (): Snapshot => {
  const snap = adult();
  snap.teeth = snap.teeth.map((t) => (t.tooth !== 46 ? t : {
    ...t, treatments: (t.treatments ?? []).map((tr) => ({ ...tr, steps: tr.steps.map((s) => (s.key === "fit" ? { ...s, state: "next" as const, on: "2026-11-26" } : s)) })),
  }));
  return snap;
};

describe("sheet content from the facts", () => {
  it("a planned implant: usual steps in words only, one after-state, nothing recorded as a step", () => {
    const c = sheetContent(adultModel(), 14);
    expect(c.treatment).toBe("Implant");
    expect(c.recorded).toEqual([]);
    expect(c.usual.length).toBe(3);
    expect(c.usual.map((s) => s.words).join(" ")).not.toMatch(/\d/);
    expect(c.after).toEqual({ kind: "stage", model: "implant", step: "crown" });
    expect(c.afterWords).toBe("After the planned implant");
    expect(c.facts.some((f) => f.kind === "recommended")).toBe(true);
  });

  it("an in-progress root canal: 'Visit 2' only on the recorded current step; the after-state is illustration", () => {
    const c = sheetContent(adultModel(), 36);
    expect(c.recorded.map((r) => [r.state, r.heading])).toEqual([["current", expect.stringMatching(/^Visit 2/)]]);
    expect(c.now).toEqual({ kind: "stage", model: "root_canal", step: "dressing" });
    expect(c.afterWords).toBe("Usually, the step after this");
    for (const u of c.usual) expect(u.words).not.toMatch(/Visit|\d/);
  });

  it("a booked next step shows its date alone, never a visit number", () => {
    const c = sheetContent(presentFacts(withNext()), 46);
    const next = c.recorded.find((r) => r.state === "next");
    expect(next?.heading).toMatch(/^Next visit: /);
    expect(next?.heading).not.toMatch(/Visit \d/);
    expect(c.afterWords).toBe("After the next recorded step");
  });

  it("a wisdom tooth is drawn from its recorded eruption, and a tooth with no record from nothing", () => {
    const m = presentFacts(aaravFixture.snapshot);
    const none = m.teeth.find((t) => t.shown === "not_recorded");
    expect(none).toBeDefined();
    const c = sheetContent(m, none?.tooth ?? 0);
    expect(c.recorded_tooth).toBe(false);
    expect(c.facts).toEqual([]);
    expect(c.now).toEqual({ kind: "record" });
    expect(c.after).toBeUndefined();
    const snap = adult();
    snap.teeth = snap.teeth.map((t) => (t.tooth === 38 ? { ...t, treatments: [], details: { eruption: "impacted", angulation: "mesioangular" } } : t));
    expect(sheetContent(presentFacts(snap), 38).wisdom).toBe(true);
  });
});

describe("ToothSheet", () => {
  const sheet = (tooth: number, snap = adult(), onBack = () => undefined, extra: Partial<Parameters<typeof ToothSheet>[0]> = {}) => (
    <ToothSheet model={presentFacts(snap)} tooth={tooth} onBack={onBack} {...extra} />
  );

  it("draws the biting side and the cut-away pair, the slider, the usual plan and the badges", async () => {
    const { container } = render(sheet(14));
    await waitFor(() => { expect(container.querySelector("[data-pair] svg")).not.toBeNull(); });
    expect([...container.querySelectorAll("[data-pair] figure")].map((f) => f.getAttribute("data-view"))).toEqual(["top", "section"]);
    expect(container.querySelector("[data-compare]")).not.toBeNull();
    expect(screen.getByText("Usual plan · general guidance")).toBeTruthy();
    expect(container.querySelector("[data-fact] .ps-badge-rec")).not.toBeNull();
    expect([...container.querySelectorAll(".ps-badge-ill")].map((b) => b.textContent)).toContain("Painting based on your record");
    expect(container.querySelector(".ps-prov")).not.toBeNull();
  });

  it("the usual plan has no numbers or dates and no visit words", async () => {
    const { container } = render(sheet(14));
    await waitFor(() => { expect(container.querySelector("[data-compare]")).not.toBeNull(); });
    const usual = container.querySelector(".ps-sheet-usual")?.textContent ?? "";
    expect(usual).not.toMatch(/\d|Visit|₹/);
  });

  it("the slider draws both states in the same viewBox and the keys move the divider", async () => {
    expect(sharedBox([0, 0, 10, 10], [5, -2, 10, 20])).toEqual([0, -2, 15, 20]);
    const { container } = render(sheet(46, withNext()));
    await waitFor(() => { expect(container.querySelector("[data-compare]")).not.toBeNull(); });
    const boxes = [...container.querySelectorAll("[data-compare] svg[role=img]")].map((s) => s.getAttribute("viewBox"));
    expect(boxes.length).toBe(2);
    expect(boxes[0]).toBe(boxes[1]);
    const handle = screen.getByRole("slider");
    expect(handle.getAttribute("aria-valuenow")).toBe("50");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe("55");
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe("0");
  });

  it("no slider when no step follows (a recorded filling)", async () => {
    const { container } = render(sheet(16));
    await waitFor(() => { expect(container.querySelector("[data-pair] svg")).not.toBeNull(); });
    expect(container.querySelector("[data-compare]")).toBeNull();
  });

  it("Back and Esc return to the map", () => {
    const onBack = vi.fn();
    render(sheet(36, adult(), onBack));
    fireEvent.click(screen.getByRole("button", { name: "Back to the map" }));
    expect(onBack).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("See in 3D appears only with the lazy module and WebGL, and loads it on the tap", async () => {
    const none = render(sheet(36));
    expect(none.container.querySelector(".ps-3d-btn")).toBeNull();
    none.unmount();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => Object.create(null)); // eslint-disable-line @typescript-eslint/no-unsafe-return
    const mount = vi.fn().mockReturnValue({ ok: true, update: () => undefined, dispose: () => undefined });
    const load3d = vi.fn(() => Promise.resolve({ mountTooth3d: mount }));
    render(sheet(36, adult(), () => undefined, { load3d }));
    expect(load3d).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "See in 3D" }));
    await waitFor(() => { expect(mount).toHaveBeenCalledTimes(1); });
  });
});

describe("tapping a tooth in the painted style", () => {
  const painted = () => <PaintedStyle model={adultModel()} orientation="mirror" onOrientation={() => undefined} shade={33} onShade={() => undefined} theme="light" onOpen={() => undefined} toothSheet />;

  it("opens the tooth sheet from a dot and Back shows the map again, on the same view", async () => {
    const { container } = render(painted());
    fireEvent.click(container.querySelector(".ps-dot[data-tooth='36']") ?? document.body);
    await waitFor(() => { expect(container.querySelector("[data-tooth-sheet='36']")).not.toBeNull(); });
    expect(container.querySelector(".ps-map")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the map" }));
    expect(container.querySelector("[data-tooth-sheet]")).toBeNull();
    expect(container.querySelector(".ps-dot[data-tooth='36']")).not.toBeNull();
  });

  it("opens the sheet from the 'What we found' card", () => {
    const { container } = render(painted());
    fireEvent.click(container.querySelector(".ps-found-open") ?? document.body);
    expect(container.querySelector("[data-tooth-sheet]")).not.toBeNull();
  });
});
