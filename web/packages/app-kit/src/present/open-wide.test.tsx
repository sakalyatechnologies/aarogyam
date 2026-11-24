// Open wide (present-studio-design §5.3, §6.2, §14.1; slice 1b): both arches from the biting side.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import adultFixture from "../../../../../specialties/dental/fixtures/mouth-adult.json" with { type: "json" };
import aaravFixture from "../../../../../specialties/dental/fixtures/mouth-aarav.json" with { type: "json" };
import type { Snapshot } from "../mouth-view/model.js";
import { dotsOf } from "./blocks.js";
import { dottedTeeth, presentFacts, type PresentModel } from "./model.js";
import { OpenWide, frontHidesAllProblems, loadWideArt, openWideScene, wideDotAt, wideX } from "./open-wide.js";
import { PaintedStyle } from "./painted.js";

afterEach(cleanup);

const aarav = (): Snapshot => structuredClone(aaravFixture.snapshot);
/** The adult fixture with decay recorded on the biting surface of 36 (the founder's example). */
const adult36 = (): Snapshot => {
  const snap: Snapshot = structuredClone(adultFixture.snapshot);
  snap.teeth = snap.teeth.map((t) => (t.tooth !== 36 ? t : {
    tooth: 36, finding: "caries", finding_on: "2026-11-20", surfaces: ["O"], problems: ["caries"], problems_on: ["2026-11-20"],
    details: { caries_depth: "dentin" }, today: "found",
  }));
  return snap;
};
/** Only biting-side decay recorded: the front map would hide every problem. */
const bitingOnly = (): Snapshot => {
  const snap = adult36();
  snap.teeth = snap.teeth.filter((t) => t.tooth === 36);
  return snap;
};

const painted = (m: PresentModel, extra: Partial<Parameters<typeof PaintedStyle>[0]> = {}) => (
  <PaintedStyle model={m} orientation="mirror" onOrientation={() => undefined} shade={33} onShade={() => undefined} theme="light" onOpen={() => undefined} {...extra} />
);

describe("Open wide scene", () => {
  it("every recorded tooth and its dot sit inside the frame, in both orientations", () => {
    for (const snap of [adult36(), aarav()]) {
      const m = presentFacts(snap);
      for (const o of ["mirror", "photo"] as const) {
        const s = openWideScene(m, o);
        const [bx, by, bw, bh] = s.box;
        for (const fdi of dottedTeeth(m)) {
          const t = s.teeth.find((x) => x.fdi === fdi);
          expect(t, `tooth ${String(fdi)} drawn`).toBeDefined();
          if (t === undefined) continue;
          const x = wideX(s, t.slot.x);
          expect(x - t.r >= bx && x + t.r <= bx + bw && t.slot.y - t.r >= by && t.slot.y + t.r <= by + bh, `tooth ${String(fdi)} in frame`).toBe(true);
          const d = wideDotAt(s, fdi);
          expect(d !== undefined && d.x > bx && d.x < bx + bw && d.y > by && d.y < by + bh, `dot ${String(fdi)} in frame`).toBe(true);
        }
      }
    }
  });

  it("mirror puts 16 to the right of 11 and 46 right of 36; photo the reverse", () => {
    const m = presentFacts(adult36());
    const x = (o: "mirror" | "photo", fdi: number) => {
      const s = openWideScene(m, o);
      const t = s.teeth.find((q) => q.fdi === fdi);
      return t === undefined ? NaN : wideX(s, t.slot.x);
    };
    expect(x("mirror", 16)).toBeGreaterThan(x("mirror", 11));
    expect(x("photo", 16)).toBeLessThan(x("photo", 11));
    expect(x("mirror", 46)).toBeGreaterThan(x("mirror", 36));
    expect(x("photo", 46)).toBeLessThan(x("photo", 36));
  });

  it("draws the recorded decay on 36's biting surface, a gap for missing 14, and impacted 38 only as an outline", () => {
    const s = openWideScene(presentFacts(adult36()), "mirror");
    const t = (fdi: number) => s.teeth.find((x) => x.fdi === fdi);
    expect(t(36)?.draw).toEqual([{ kind: "caries", surface: "O", depth: "dentin" }]);
    expect(t(14)?.missing).toBe(true);
    expect(t(14)?.draw).toEqual([]);
    expect(t(38)?.under).toBe(true);
  });

  it("the hidden-problem rule: only biting-side problems → open wide; any problem in view → the front", () => {
    expect(frontHidesAllProblems(presentFacts(bitingOnly()))).toBe(true);
    expect(frontHidesAllProblems(presentFacts(adult36()))).toBe(false);
    expect(frontHidesAllProblems(presentFacts(aarav()))).toBe(false);
    const empty = aarav();
    empty.teeth = [];
    expect(frontHidesAllProblems(presentFacts(empty))).toBe(false);
  });
});

describe("Open wide block", () => {
  it("shows the same numbered dots as the painted map and the list, and opens a tooth", async () => {
    const m = presentFacts(adult36());
    const art = await loadWideArt(m);
    const opened: number[] = [];
    const { container } = render(<OpenWide model={m} orientation="mirror" theme="light" art={art} onOpen={(t) => { opened.push(t); }} />);
    const dots = [...container.querySelectorAll(".ps-dot")];
    expect(dots.map((d) => Number(d.getAttribute("data-tooth")))).toEqual(dottedTeeth(m));
    expect(dots.map((d) => d.textContent)).toEqual(dotsOf(m).map((d) => String(d.n)));
    expect(dots.map((d) => d.getAttribute("aria-label"))).toEqual(dotsOf(m).map((d) => d.label));
    // the decay is painted on the biting surface of 36 and 37
    for (const fdi of [36, 37]) expect(container.querySelector(`g[data-fdi="${String(fdi)}"] [data-n="cariesLesion"]`), `decay on ${String(fdi)}`).not.toBeNull();
    const dot36 = container.querySelector('.ps-dot[data-tooth="36"]');
    if (dot36 === null) throw new Error("no dot on 36");
    fireEvent.click(dot36);
    fireEvent.keyDown(dot36, { key: "Enter" });
    expect(opened).toEqual([36, 36]);
    expect(container.querySelector(".ps-badge-ill")).not.toBeNull();
    expect(container.textContent).toContain("Your right");
  });

  it("labels the patient's right on the screen's right in mirror, left in photo", () => {
    const m = presentFacts(adult36());
    const xOf = (o: "mirror" | "photo") => {
      const { container } = render(<OpenWide model={m} orientation={o} theme="light" onOpen={() => undefined} />);
      const label = [...container.querySelectorAll("text.ps-w-label")].find((t) => t.textContent === "Your right");
      const x = Number(label?.getAttribute("x"));
      cleanup();
      return x;
    };
    expect(xOf("mirror")).toBeGreaterThan(180);
    expect(xOf("photo")).toBeLessThan(180);
  });
});

describe("Open wide in the painted style", () => {
  it("opens on Open wide when the front would hide every recorded problem", () => {
    const { container } = render(painted(presentFacts(bitingOnly())));
    expect(container.querySelector("[data-present-style]")?.getAttribute("data-view")).toBe("wide");
    expect(container.querySelector("[data-present-block='open-wide']")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Open wide" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("otherwise opens on the front, with a prompt and the list's biting-side link to Open wide", () => {
    const views: string[] = [];
    const { container } = render(painted(presentFacts(adult36()), { onView: (v) => { views.push(v); } }));
    expect(container.querySelector("[data-present-style]")?.getAttribute("data-view")).toBe("front");
    expect(screen.getByRole("button", { name: /2 problems are on the biting side/ })).toBeTruthy();
    const links = screen.getAllByRole("button", { name: "On the biting side: open wide" });
    expect(links).toHaveLength(2);
    fireEvent.click(links[0] ?? document.body);
    expect(container.querySelector("[data-present-style]")?.getAttribute("data-view")).toBe("wide");
    expect(views).toEqual(["wide"]);
    // in Open wide the decay is in view: the note is plain words, and Front goes back
    expect(screen.queryByRole("button", { name: "On the biting side: open wide" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Front" }));
    expect(container.querySelector("[data-present-style]")?.getAttribute("data-view")).toBe("front");
  });

  it("a parent-held view wins over the rule (it survives opening a tooth and coming back)", () => {
    const { container } = render(painted(presentFacts(adult36()), { view: "wide" }));
    expect(container.querySelector("[data-present-style]")?.getAttribute("data-view")).toBe("wide");
  });
});
