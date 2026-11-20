import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import fixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import { MouthView } from "./mouth-view.js";
import { archStates, brushingBand, brushHighlight, summaryCounts, type Snapshot } from "./model.js";

afterEach(cleanup);

const aarav = (): Snapshot => structuredClone(fixture.snapshot);

const tooth = (fdi: number) => {
  const el = document.querySelector<SVGGElement>(`.mv-tooth[data-fdi="${String(fdi)}"]`);
  if (el === null) throw new Error(`no tooth ${String(fdi)}`);
  return el;
};

describe("overview (§1.12)", () => {
  it("lays out the mixed dentition from positions: 21 permanent, 55 and 65 milk, and the 6s (Aarav)", () => {
    render(<MouthView snapshot={aarav()} name="Aarav" />);
    for (const fdi of [11, 21, 55, 65, 75, 16, 26, 36, 46]) expect(tooth(fdi)).toBeTruthy();
    expect(document.querySelector('.mv-tooth[data-fdi="15"]')).toBeNull();
    expect(document.querySelector('.mv-tooth[data-fdi="51"]')).toBeNull();
    expect(tooth(52).getAttribute("aria-label")).toBe("Upper right side front milk tooth, 52: not recorded");
    expect(tooth(16).dataset["state"]).toBe("not_recorded");
  });

  it("shows the summary, the next visit and a legend with glyphs", () => {
    render(<MouthView snapshot={aarav()} name="Aarav" />);
    expect(screen.getByRole("heading", { name: "Aarav's teeth" })).toBeTruthy();
    expect(screen.getByText("2 teeth need attention")).toBeTruthy();
    expect(screen.getByText(/· 1 treated today/)).toBeTruthy();
    expect(screen.getByText("Next visit: Thu 26 Nov")).toBeTruthy();
    const legend = within(screen.getByRole("list", { name: "Key" }));
    for (const l of ["Treated today", "Planned", "Found today", "Done here", "Done elsewhere", "Done before", "Not recorded"]) expect(legend.getByText(l)).toBeTruthy();
    expect(screen.getByRole("list", { name: "Key" }).querySelectorAll("svg")).toHaveLength(7);
  });

  it("marks each state: today ring, planned ring, found and origin badges, spoken labels", () => {
    render(<MouthView snapshot={aarav()} name="Aarav" />);
    expect(tooth(21).querySelector(".mv-ring-today")).toBeTruthy();
    expect(tooth(21).querySelector(".mv-ring-plan")).toBeTruthy();
    expect(tooth(21).getAttribute("aria-label")).toBe("Upper left front tooth, 21: root canal treatment in progress, sitting 4; crown planned");
    expect(tooth(55).querySelector(".mv-ring-plan")).toBeTruthy();
    expect(tooth(55).getAttribute("aria-label")).toContain("decay into the tooth found today");
    expect(tooth(65).getAttribute("aria-label")).toContain("filling, done here · 20 oct");
    expect(tooth(75).getAttribute("aria-label")).toContain("filling, done elsewhere");
    const states = archStates(aarav());
    const all = [...states.upper, ...states.lower];
    expect(all.find((s) => s.fdi === 55)?.badge).toBe("found");
    expect(all.find((s) => s.fdi === 65)?.badge).toBe("here");
    expect(all.find((s) => s.fdi === 75)?.badge).toBe("elsewhere");
    expect(all.find((s) => s.fdi === 11)?.badge).toBeUndefined();
    expect(summaryCounts(aarav())).toEqual({ need: 2, today: 1 });
  });

  it("DF1: both teeth at one position show the one with the problem; detail names the other", () => {
    const snap = aarav();
    const p = snap.positions.find((x) => x.tooth === 55);
    if (p === undefined) throw new Error("55");
    p.other = { tooth: 15, finding: "missing" };
    render(<MouthView snapshot={snap} name="Aarav" />);
    expect(document.querySelector('.mv-tooth[data-fdi="15"]')).toBeNull();
    fireEvent.click(tooth(55));
    expect(screen.getByText("Permanent 15: missing")).toBeTruthy();
  });

  it("DF2: an uncharted position reads 'Not recorded', never sound", () => {
    render(<MouthView snapshot={aarav()} name="Aarav" />);
    fireEvent.click(tooth(64));
    expect(screen.getByRole("heading", { name: "Not recorded" })).toBeTruthy();
    expect(screen.getByText(/doesn't mean it is healthy or unhealthy/)).toBeTruthy();
  });
});

describe("tooth detail and stepper", () => {
  it("walks record-backed steps, You are here, then the usual steps, with Usually and What to expect labels (m6)", () => {
    render(<MouthView snapshot={aarav()} name="Aarav" reducedMotion />);
    fireEvent.click(tooth(21));
    expect(screen.getByRole("heading", { name: "Root canal treatment" })).toBeTruthy();
    expect(screen.getByText("In progress · sitting 4")).toBeTruthy();
    expect(screen.getByText("Crown planned")).toBeTruthy();
    expect(screen.getByText("Abscess at the root · recorded 20 Oct")).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Visit 1", "You are hereToday", "Next", "Usually"]);
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
    const panel = screen.getByRole("tabpanel");
    expect(panel.textContent).toContain("Visit 4 (today)");
    expect(panel.textContent).toContain("Usually, after this step: The medicine stays for one to two weeks");
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    expect(screen.getByRole("tabpanel").textContent).toContain("Next visit: Thu 26 Nov");
    fireEvent.keyDown(screen.getAllByRole("tab")[2] ?? document.body, { key: "End" });
    expect(screen.getByRole("tabpanel").textContent).toMatch(/^Usual step.*Usually: A crown keeps/);
    expect(screen.getByRole("heading", { name: "What to expect" })).toBeTruthy();
    expect(screen.getByText("General notes for this treatment, not specific to Aarav.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Usual steps for a crown" })).toBeTruthy();
  });

  it("labels origins: done elsewhere has no date or stepper", () => {
    render(<MouthView snapshot={aarav()} name="Aarav" />);
    fireEvent.click(tooth(75));
    expect(document.querySelector(".mv-originbox")?.textContent).toBe("Done elsewhereFilling, done before Aarav came here.");
    expect(screen.getByText("Filling, done before Aarav came here.")).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("Present labels today's work done here 'Done here · today' (DF4)", () => {
    const snap = aarav();
    const t65 = snap.teeth.find((t) => t.tooth === 65);
    if (t65?.work?.[0] === undefined) throw new Error("65");
    t65.work[0].today = true;
    delete t65.treatments;
    render(<MouthView snapshot={snap} name="Aarav" mode="present" />);
    fireEvent.click(tooth(65));
    expect(screen.getByText("Done here · today")).toBeTruthy();
  });

  it("draws the stage art for the step and notes an unrecorded depth", async () => {
    const snap = aarav();
    const t55 = snap.teeth.find((t) => t.tooth === 55);
    if (t55 === undefined) throw new Error("55");
    delete t55.details;
    render(<MouthView snapshot={snap} name="Aarav" reducedMotion />);
    fireEvent.click(tooth(55));
    expect(await screen.findByText("Illustration: depth not recorded", {}, { timeout: 3000 })).toBeTruthy();
    expect(document.querySelectorAll(".mv-layer svg path").length).toBeGreaterThan(5);
  });
});

describe("keyboard and motion (m4)", () => {
  it("has one tab stop; arrows move along and between arches; Enter opens; Esc returns focus to the tooth", () => {
    render(<MouthView snapshot={aarav()} name="Aarav" />);
    const stops = [...document.querySelectorAll(".mv-tooth")].filter((el) => el.getAttribute("tabindex") === "0");
    expect(stops.map((el) => el.getAttribute("data-fdi"))).toEqual(["21"]);
    tooth(21).focus();
    fireEvent.keyDown(tooth(21), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tooth(62));
    fireEvent.keyDown(tooth(62), { key: "ArrowLeft" });
    fireEvent.keyDown(tooth(21), { key: "ArrowDown" });
    expect(["71", "81"]).toContain(document.activeElement?.getAttribute("data-fdi"));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowUp" });
    expect(["11", "21"]).toContain(document.activeElement?.getAttribute("data-fdi"));
    fireEvent.keyDown(tooth(21), { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back to all teeth" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.querySelector(".mv")?.getAttribute("data-screen")).toBe("overview");
    expect(document.activeElement).toBe(tooth(21));
  });

  it("opens a tooth when the page asks (a row), once per nonce", () => {
    const { rerender } = render(<MouthView snapshot={aarav()} name="Aarav" open={{ tooth: 55, nonce: 1 }} />);
    expect(screen.getByRole("heading", { name: /found today|Filling/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to all teeth" }));
    rerender(<MouthView snapshot={aarav()} name="Aarav" open={{ tooth: 55, nonce: 1 }} />);
    expect(document.querySelector(".mv")?.getAttribute("data-screen")).toBe("overview");
  });

  it("uses stills under reduced motion: no wipe between steps", async () => {
    render(<MouthView snapshot={aarav()} name="Aarav" reducedMotion />);
    expect(document.querySelector(".mv")?.hasAttribute("data-reduced")).toBe(true);
    fireEvent.click(tooth(21));
    await screen.findByRole("img", { name: /Upper left front tooth, A medicine/ }, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    await screen.findByRole("img", { name: /roots are filled/ }, { timeout: 3000 });
    expect(document.querySelectorAll(".mv-layer.mv-in, .mv-layer.mv-out")).toHaveLength(0);
  });

  it("wipes between steps with motion on", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<MouthView snapshot={aarav()} name="Aarav" reducedMotion={false} />);
    fireEvent.click(tooth(21));
    await screen.findByRole("img", { name: /A medicine/ }, { timeout: 3000 });
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    await screen.findByRole("img", { name: /roots are filled/ }, { timeout: 3000 });
    expect(document.querySelector(".mv-layer.mv-in")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(800); });
    expect(document.querySelectorAll(".mv-layer.mv-out")).toHaveLength(0);
    vi.useRealTimers();
  });
});

describe("care band (§1.4)", () => {
  it("picks the band from the care key, else age, else dentition; highlights a tooth treated today", () => {
    expect(brushingBand(aarav(), ["general_teen"])).toBe("general_teen");
    expect(brushingBand(aarav())).toBe("general_6_12");
    expect(brushingBand({ ...aarav(), dentition: "child" })).toBe("general_under_6");
    expect(brushingBand(aarav(), [], 30)).toBe("general_adult");
    expect(brushHighlight(aarav(), ["Brush gently around the tooth"])).toBe(21);
    expect(brushHighlight(aarav(), ["Avoid hard food"])).toBeUndefined();
  });
});
