// Usual options (present-studio-design §8.2, slice 2a).
import { fakePresentStudio, withPrices } from "@aarogyam/api-client/fake";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import optionsFile from "../../../../../specialties/dental/present/options.json" with { type: "json" };
import { ART_KEYS } from "../mouth-art/art-map.js";
import { SituationOptions, StudioProvider, ToothOptions, finishWords, visitsWords } from "./options.js";

afterEach(cleanup);

// Nothing planned, so "Wait and watch" is still offered (a tooth with a plan under way does not get it).
const unplanned = { ...adultFixture.snapshot, teeth: adultFixture.snapshot.teeth.map((tooth) => ({ ...tooth, treatments: [] })) };
const studio = () => fakePresentStudio(unplanned);
const deep = () => {
  const s = studio().situations.find((x) => x.key === "deep_decay");
  if (s === undefined) throw new Error("no deep decay");
  return s;
};

describe("the option data", () => {
  it("every art key resolves to a 2D scene or overlay", () => {
    for (const s of Object.values(optionsFile.situations)) for (const o of s.options) expect(ART_KEYS.has(o.look), o.look).toBe(true);
  });
});

describe("situations from the adult fixture", () => {
  it("14 missing, 37 deep decay, 38 wisdom", () => {
    expect(studio().situations.map((s) => [s.tooth, s.key])).toEqual([[14, "missing"], [37, "deep_decay"], [38, "impacted_wisdom"]]);
  });
});

describe("SituationOptions", () => {
  it("lists each option as a card with the five facts and the badges", () => {
    const { container } = render(<SituationOptions situation={deep()} />);
    expect(container.querySelectorAll("[data-option]").length).toBe(5);
    const rct = container.querySelector('[data-option="rct_crown"]');
    expect(rct?.textContent).toContain("Usually 2–3 visits");
    expect(rct?.textContent).toContain("Usually 2–4 weeks");
    for (const row of ["visits", "finish", "look", "life", "comfort"]) expect(rct?.querySelector(`[data-row="${row}"]`), row).not.toBeNull();
    expect(container.querySelector(".ps-badge-ill")?.textContent).toBe("Illustration · general guidance");
    expect(container.textContent).toContain("Usual options · general guidance");
    // outcome words only where the guidance has them, with their source behind "Why we say this"
    const implant = container.querySelector('[data-option="extract_implant"]');
    expect(implant?.textContent).toContain("Most are still working after 10 years");
    expect(implant?.textContent).toContain("General guidance, not a promise. Your dentist will advise.");
    expect(implant?.textContent).toContain("Howe, Keys, Richards");
    expect(container.querySelector('[data-option="extract_bridge"]')?.textContent).toContain("No usual figure");
    expect(container.textContent).not.toMatch(/₹|Visit \d/);
  });

  it("Compare puts the options side by side in one table", () => {
    render(<SituationOptions situation={deep()} />);
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(deep().options.map((o) => o.label));
    expect(within(table).getAllByRole("rowheader").map((h) => h.textContent)).toContain("Time to finish");
    expect(screen.getAllByText("Illustration · general guidance").length).toBeGreaterThan(0);
  });
});

describe("words", () => {
  it("say nothing is done when there are no visits", () => {
    const wait = deep().options[0];
    if (wait === undefined) throw new Error("no option");
    expect(visitsWords(wait)).toBe("No treatment visits");
    expect(finishWords(wait)).toBe("Nothing to finish");
  });
});

describe("ToothOptions", () => {
  it("shows a block for a tooth with a situation and nothing for another or without a studio", () => {
    const { container, rerender } = render(<StudioProvider studio={studio()}><ToothOptions tooth={37} /></StudioProvider>);
    expect(container.querySelectorAll("[data-situation]").length).toBe(1);
    rerender(<StudioProvider studio={studio()}><ToothOptions tooth={36} /></StudioProvider>);
    expect(container.querySelector("[data-situation]")).toBeNull();
    rerender(<ToothOptions tooth={37} />);
    expect(container.querySelector("[data-situation]")).toBeNull();
  });
});

describe("Prices", () => {
  const priced = () => withPrices(studio(), { show_prices: true, price_map: { root_canal: "RCT", crown: "CRN" } }, [{ code: "RCT", paise: 600_000 }, { code: "CRN", paise: 850_000 }]);

  it("has no Prices tap and no rupee amount without prices from the server", () => {
    const { container } = render(<StudioProvider studio={studio()}><SituationOptions situation={deep()} /></StudioProvider>);
    expect(screen.queryByRole("button", { name: "Prices" })).toBeNull();
    expect(container.textContent).not.toContain("₹");
  });

  it("shows no amount before the Prices tap, then a number only for fully mapped options", () => {
    const withP = priced();
    const situation = withP.situations.find((s) => s.key === "deep_decay");
    if (situation === undefined) throw new Error("no deep decay");
    const { container } = render(<StudioProvider studio={withP}><SituationOptions situation={situation} /></StudioProvider>);
    expect(container.textContent).not.toContain("₹");
    fireEvent.click(screen.getByRole("button", { name: "Prices" }));
    const cost = (key: string) => container.querySelector(`[data-option="${key}"] [data-row="cost"]`)?.textContent;
    expect(cost("rct_crown")).toContain("From ₹14,500");
    expect(cost("rct_crown")).toContain("final cost after examination");
    // Options with an unmapped part (the implant) or no parts at all get no number.
    for (const key of situation.options.map((o) => o.key).filter((k) => k !== "rct_crown")) expect(cost(key), key).toContain("Ask the front desk for the cost");
  });
});
