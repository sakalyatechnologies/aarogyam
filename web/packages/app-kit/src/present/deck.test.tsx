// Pinned options, the deck, side-by-side compare, the pen and "What we discussed" (present-studio-design §10, slice 2e).
import { fakePresentStudio } from "@aarogyam/api-client/fake";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import { PinnedDeck, draftsOf, type DiscussionDraft } from "./deck.js";
import { SituationOptions, StudioProvider } from "./options.js";
import { PinsProvider, scenarioOf, usePins } from "./pins.js";

afterEach(cleanup);

// Nothing planned, so "Wait and watch" is still offered (a tooth with a plan under way does not get it).
const unplanned = { ...adultFixture.snapshot, teeth: adultFixture.snapshot.teeth.map((tooth) => ({ ...tooth, treatments: [] })) };
const studio = () => fakePresentStudio(unplanned);
const deep = () => {
  const s = studio().situations.find((x) => x.key === "deep_decay");
  if (s === undefined) throw new Error("no deep decay");
  return s;
};

function Harness({ onSave }: { onSave: (drafts: DiscussionDraft[]) => void }) {
  return (
    <StudioProvider studio={studio()}>
      <PinsProvider>
        <SituationOptions situation={deep()} />
        <Deck onSave={onSave} />
      </PinsProvider>
    </StudioProvider>
  );
}
function Deck({ onSave }: { onSave: (drafts: DiscussionDraft[]) => void }) {
  const pins = usePins();
  return pins === undefined || pins.pins.length === 0 ? null : <PinnedDeck onClose={() => undefined} onSave={onSave} labelOf={(k) => k} />;
}

const pin = (label: string) => { fireEvent.click(screen.getAllByRole("button", { name: `Pin ${label}` })[0] ?? document.body); };

describe("pins", () => {
  it("show no Pin button without a provider", () => {
    render(<SituationOptions situation={deep()} />);
    expect(screen.queryByRole("button", { name: /^Pin / })).toBeNull();
  });

  it("toggle, and an unpinned option is no longer preferred", () => {
    render(<Harness onSave={() => undefined} />);
    pin("Root canal and cap");
    expect(screen.getAllByRole("button", { name: "Unpin Root canal and cap" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("dialog", { name: "Pinned options" })).toBeTruthy();
  });
});

describe("the deck", () => {
  it("steps with the arrow keys and the buttons, wrapping round", () => {
    render(<Harness onSave={() => undefined} />);
    pin("Root canal and cap");
    pin("Remove the tooth only");
    const dialog = screen.getByRole("dialog", { name: "Pinned options" });
    const shown = () => dialog.querySelector("article")?.getAttribute("data-option");
    const first = shown();
    expect(within(dialog).getByRole("status").textContent).toBe("1 of 2");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(within(dialog).getByRole("status").textContent).toBe("2 of 2");
    expect(shown()).not.toBe(first);
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(shown()).toBe(first);
    fireEvent.click(within(dialog).getByRole("button", { name: "Previous option" }));
    expect(within(dialog).getByRole("status").textContent).toBe("2 of 2");
  });

  it("swipes sideways, but not while the pen is on", () => {
    render(<Harness onSave={() => undefined} />);
    pin("Root canal and cap");
    pin("Remove the tooth only");
    const dialog = screen.getByRole("dialog", { name: "Pinned options" });
    const deck = within(dialog).getByRole("region", { name: "Pinned deck" });
    fireEvent.pointerDown(deck, { clientX: 300 });
    fireEvent.pointerUp(deck, { clientX: 100 });
    expect(within(dialog).getByRole("status").textContent).toBe("2 of 2");
    fireEvent.click(within(dialog).getByRole("button", { name: "Pen" }));
    fireEvent.pointerDown(deck, { clientX: 100 });
    fireEvent.pointerUp(deck, { clientX: 300 });
    expect(within(dialog).getByRole("status").textContent).toBe("2 of 2");
  });
});

describe("compare", () => {
  it("puts two pinned options side by side", () => {
    render(<Harness onSave={() => undefined} />);
    pin("Root canal and cap");
    pin("Remove the tooth only");
    pin("Wait and watch");
    const dialog = screen.getByRole("dialog", { name: "Pinned options" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Compare" }));
    const sides = dialog.querySelectorAll(".pd-sides article");
    expect(sides.length).toBe(2);
    const picks = within(dialog).getByRole("group", { name: "Choose two" });
    const buttons = within(picks).getAllByRole("button");
    expect(buttons.length).toBe(3);
    fireEvent.click(buttons[2] ?? picks);
    expect(dialog.querySelectorAll(".pd-sides article").length).toBe(2);
    expect(buttons[2]?.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the pen", () => {
  it("is off the page until switched on, and keeps nothing", () => {
    render(<Harness onSave={() => undefined} />);
    pin("Root canal and cap");
    const dialog = screen.getByRole("dialog", { name: "Pinned options" });
    const canvas = dialog.querySelector("canvas");
    expect(canvas?.getAttribute("data-on")).toBe("false");
    fireEvent.click(within(dialog).getByRole("button", { name: "Pen" }));
    expect(canvas?.getAttribute("data-on")).toBe("true");
    // drawing needs no network and writes no storage
    const storage = vi.spyOn(Storage.prototype, "setItem");
    if (canvas === null) throw new Error("no pen layer");
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(storage).not.toHaveBeenCalled();
    storage.mockRestore();
  });
});

describe("What we discussed", () => {
  it("groups pins by scenario, marks who the patient prefers and saves", () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    pin("Root canal and cap");
    pin("Remove the tooth only");
    const dialog = screen.getByRole("dialog", { name: "Pinned options" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "What we discussed" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /Patient prefers rct_crown/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith([
      { tooth: 37, situation: "deep_decay", options: [{ key: "rct_crown", preferred: true }, { key: "extract", preferred: false }] },
    ]);
  });

  it("draftsOf keeps scenarios apart", () => {
    const o = deep().options[0];
    if (o === undefined) throw new Error("no option");
    const a = { id: "a", situation: "deep_decay", tooth: 36, title: "t", option: o };
    const b = { ...a, id: "b", tooth: 37 };
    expect(draftsOf([a, b], { [scenarioOf(b)]: o.key }).map((d) => [d.tooth, d.options[0]?.preferred])).toEqual([[36, false], [37, true]]);
  });
});
