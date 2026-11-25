// The doctor's additions are optional: nothing shows without them, and "Go with this" skips the suggested option.
import { fakePresentStudio } from "@aarogyam/api-client/fake";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import { SituationOptions, setPresentActions } from "./options.js";

afterEach(() => { cleanup(); setPresentActions(undefined); });

const situation = () => {
  const unplanned = { ...adultFixture.snapshot, teeth: adultFixture.snapshot.teeth.map((t) => ({ ...t, treatments: [] })) };
  const s = fakePresentStudio(unplanned).situations.find((x) => x.key === "deep_decay");
  if (s === undefined) throw new Error("no deep decay");
  return s;
};

describe("Go with this", () => {
  it("is absent without the doctor's actions", () => {
    render(<SituationOptions situation={situation()} />);
    expect(screen.queryByRole("button", { name: "Go with this" })).toBeNull();
  });

  it("shows on options that are not the suggestion, and passes the option on a tap", async () => {
    const onChoose = vi.fn();
    const s = situation();
    setPresentActions({ onChoose, canChoose: (t) => t.option !== "extract" });
    render(<SituationOptions situation={s} />);
    const suggested = s.options.filter((o) => o.suggested === true).length;
    const buttons = await screen.findAllByRole("button", { name: "Go with this" });
    expect(buttons.length).toBe(s.options.length - suggested - 1);
    const first = buttons[0];
    if (first === undefined) throw new Error("no button");
    fireEvent.click(first);
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ tooth: s.tooth, situation: "deep_decay" }));
  });
});
