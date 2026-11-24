// Story cards (slice 1d): cards come from the facts only; keyboard, swipe, dots and the index navigate; ticks are session-only.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type { Snapshot } from "../mouth-view/model.js";
import { fakePresentStudio } from "@aarogyam/api-client/fake";
import { presentFacts } from "./model.js";
import { StudioProvider } from "./options.js";
import { StoryStyle, storyCards } from "./story.js";
import { DEFAULT_STYLE, isShipped } from "./styles.js";

afterEach(cleanup);
const must = <T,>(v: T | undefined): T => { if (v === undefined) throw new Error("missing"); return v; };
const snaps: Record<string, () => Snapshot> = { aarav: () => structuredClone(aaravFixture.snapshot), adult: () => structuredClone(adultFixture.snapshot) };
const draw = (snap: Snapshot) => render(<StoryStyle model={presentFacts(snap)} orientation="mirror" onOrientation={() => undefined} theme="light" />);
const current = (c: HTMLElement) => c.querySelector("[data-story-card]")?.getAttribute("data-story-card");
/** A snapshot with decay on 36 so there is a problem tooth card and a plan card. */
const withDecay = (): Snapshot => {
  const s: Snapshot = structuredClone(adultFixture.snapshot);
  s.teeth = [{ tooth: 36, finding: "caries", finding_on: "2026-11-20", surfaces: ["O"], problems: ["caries"], problems_on: ["2026-11-20"], today: "found", planned: true, recommended: true, recommended_on: "2026-11-20",
    treatments: [{ model: "filling", state: "planned", recommended: true, typical_visits: 1, recovery: [], steps: [] }] }];
  return s;
};

describe("story cards", () => {
  it("is the default style and is shipped", () => {
    expect(DEFAULT_STYLE).toBe("story");
    expect(isShipped("story")).toBe(true);
    expect(isShipped("painted")).toBe(true);
  });

  it.each(Object.entries(snaps))("%s: cards are built from the facts and nothing else", (_n, snap) => {
    const model = presentFacts(snap());
    const cards = storyCards(model);
    expect(cards[0]?.kind).toBe("mouth");
    expect(cards.some((c) => c.kind === "found")).toBe(model.facts.length > 0);
    const problemTeeth = new Set(model.facts.filter((f) => f.kind === "problem").map((f) => f.tooth));
    expect(cards.filter((c) => c.kind === "tooth").map((c) => c.tooth).sort()).toEqual([...problemTeeth].sort());
    expect(cards.some((c) => c.kind === "plan")).toBe(model.facts.some((f) => ["plan", "recommended", "in_progress"].includes(f.kind)));
    // no placeholder case, option or price cards in 1d
    expect(cards.every((c) => ["mouth", "found", "tooth", "plan"].includes(c.kind))).toBe(true);
  });

  it("an empty mouth is the map card alone", () => {
    const s = structuredClone(aaravFixture.snapshot);
    s.teeth = [];
    expect(storyCards(presentFacts(s)).map((c) => c.kind)).toEqual(["mouth"]);
  });

  it("order: mouth, found, problem tooth, plan; the recommended item carries its date", () => {
    const model = presentFacts(withDecay());
    expect(storyCards(model).map((c) => c.id)).toEqual(["mouth", "found", "tooth:36", "plan"]);
    const { container } = draw(withDecay());
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(current(container)).toBe("plan");
    expect(container.querySelector("h2")?.textContent).toBe("Your plan");
    expect(container.querySelector("[data-plan]")?.textContent).toMatch(/Your dentist recommends.*Recorded 20 Nov/);
    expect(container.textContent).not.toMatch(/₹/);
  });

  it("arrow keys move between cards, stop at the ends and leave the slider alone", () => {
    const { container } = draw(withDecay());
    expect(current(container)).toBe("mouth");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(current(container)).toBe("mouth");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(current(container)).toBe("found");
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    container.appendChild(slider);
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(current(container)).toBe("found");
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(current(container)).toBe("mouth");
  });

  it("a swipe moves a card; a short or mostly vertical one does not", () => {
    const { container } = draw(withDecay());
    const deck = container.querySelector(".ps-deck");
    if (deck === null) throw new Error("no deck");
    const swipe = (x0: number, y0: number, x1: number, y1: number) => {
      fireEvent.pointerDown(deck, { clientX: x0, clientY: y0 });
      fireEvent.pointerUp(deck, { clientX: x1, clientY: y1 });
    };
    swipe(200, 100, 190, 100);
    swipe(200, 100, 100, 260);
    expect(current(container)).toBe("mouth");
    swipe(300, 100, 120, 110);
    expect(current(container)).toBe("found");
    swipe(100, 100, 260, 100);
    expect(current(container)).toBe("mouth");
  });

  it("dots show progress and jump; All cards lists every card; Esc closes the index", () => {
    const { container } = draw(withDecay());
    const dots = within(container).getAllByRole("button", { name: /^Card \d of 4/ });
    expect(dots).toHaveLength(4);
    expect(dots[0]?.getAttribute("aria-current")).toBe("step");
    fireEvent.click(must(dots[3]));
    expect(current(container)).toBe("plan");
    fireEvent.click(screen.getByRole("button", { name: "All cards" }));
    const index = screen.getByRole("dialog", { name: "All cards" });
    expect(within(index).getAllByRole("button")).toHaveLength(4);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "All cards" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All cards" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "All cards" })).getByRole("button", { name: /What we found/ }));
    expect(current(container)).toBe("found");
  });

  it("each problem tooth is followed by its choices; a tooth in treatment folds them under Other ways", () => {
    const snap = withDecay();
    const tooth = must(snap.teeth[0]);
    tooth.treatments = [{ model: "root_canal", state: "in_progress", typical_visits: 4, recovery: [], steps: [] }];
    tooth.sitting = 4;
    const base = fakePresentStudio(adultFixture.snapshot);
    const sit = must(base.situations[0]);
    const studio = { ...base, situations: [{ ...sit, tooth: 36, key: "deep_decay" }, { ...sit, tooth: 26, key: "missing" }] };
    const cards = storyCards(presentFacts(snap), false, studio);
    expect(cards.map((c) => c.id)).toEqual(["mouth", "found", "tooth:36", "options:36:deep_decay", "options:26:missing", "plan"]);
    expect(cards.find((c) => c.id === "options:36:deep_decay")?.midTreatment).toBe(true);
    expect(cards.find((c) => c.id === "options:26:missing")?.midTreatment).toBeUndefined();
  });

  it("the plan card lists the steps in order and keeps the total behind Prices", () => {
    const plans = [
      { id: "b", name: "Crown", phase: 2, status: "proposed", estimate_paise: 800000, tooth: 36 },
      { id: "a", name: "Root canal", phase: 1, status: "accepted", estimate_paise: 500000, tooth: 36 },
      { id: "c", name: "Old step", phase: 1, status: "cancelled", estimate_paise: 100 },
    ];
    const empty = structuredClone(adultFixture.snapshot); empty.teeth = []; Reflect.deleteProperty(empty, "next_visit");
    const model = presentFacts(empty, undefined);
    expect(storyCards(model, false, undefined, plans).map((c) => c.id)).toEqual(["mouth", "plan"]);
    const priced = { ...fakePresentStudio(adultFixture.snapshot), prices: [] };
    const { container } = render(<StudioProvider studio={priced}><StoryStyle model={model} orientation="mirror" onOrientation={() => undefined} theme="light" plans={plans} stacked /></StudioProvider>);
    const names = [...container.querySelectorAll("[data-plan-line]")].map((e) => e.textContent);
    expect(names).toEqual(["Root canal · tooth 36", "Crown · tooth 36"]);
    expect(container.textContent).toMatch(/2 steps still to do, over 2 visits/);
    expect(container.textContent).toMatch(/Ask the front desk to book your next visit/);
    expect(container.textContent).not.toMatch(/₹/);
    fireEvent.click(within(must(container.querySelector<HTMLElement>("[aria-label='Plan cost']") ?? undefined)).getByRole("button", { name: "Prices" }));
    expect(container.querySelector("[data-plan-total]")?.textContent).toMatch(/₹13,000.*Final cost after examination/);
  });

  it("without prices from the server there is no Prices tap and no total", () => {
    const empty = structuredClone(adultFixture.snapshot); empty.teeth = []; Reflect.deleteProperty(empty, "next_visit");
    const model = presentFacts(empty, undefined);
    const { container } = render(<StoryStyle model={model} orientation="mirror" onOrientation={() => undefined} theme="light" stacked plans={[{ id: "a", name: "Filling", phase: 1, status: "proposed", estimate_paise: 100000 }]} />);
    expect(screen.queryByRole("button", { name: "Prices" })).toBeNull();
    expect(container.querySelector("[data-plan-total]")).toBeNull();
  });

  it("old work waits behind Show past work", () => {
    const model = presentFacts(structuredClone(adultFixture.snapshot));
    const hasWork = model.facts.some((f) => f.kind === "work");
    expect(hasWork).toBe(true);
    const { container } = draw(structuredClone(adultFixture.snapshot));
    fireEvent.click(screen.getByRole("button", { name: "Next card" }));
    expect(container.querySelector("[data-fact*=':work:']")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show past work" }));
    expect(container.querySelector("[data-fact*=':work:']")).not.toBeNull();
  });
});
