import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NEW_LOOK_KEY } from "../../lib/new-look.js";
import { PEOPLE, renderPortal } from "../../test/render.js";
import { TimeGrid, type GridEvent } from "./time-grid.js";

const AXE = { rules: { "color-contrast": { enabled: false }, region: { enabled: false } } };
const problems = (result: axe.AxeResults) => result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

function event(id: string, startMin: number, endMin: number, extra: Partial<GridEvent> = {}): GridEvent {
  return { id, columnId: "d", startMin, endMin, title: id, tone: "b", label: `${id} label`, ...extra };
}

const COLUMNS = [{ id: "d", label: "Mon", dateLabel: "16", showNow: true }];

afterEach(cleanup);

describe("TimeGrid overlap layout", () => {
  it("draws two appointments at the same time side by side, each half the column", () => {
    render(<TimeGrid columns={COLUMNS} events={[event("A", 630, 660), event("B", 630, 660)]} startHour={8} endHour={18} onSelect={() => undefined} summary="Grid" />);
    const a = screen.getByRole("button", { name: "A label" });
    const b = screen.getByRole("button", { name: "B label" });
    expect(a.style.width).toBe("calc(50% - 4px)");
    expect(b.style.width).toBe("calc(50% - 4px)");
    expect(a.style.left).toBe("calc(0% + 2px)");
    expect(b.style.left).toBe("calc(50% + 2px)");
    expect(a.style.top).toBe(b.style.top);
  });

  it("gives three at once a third each", () => {
    render(<TimeGrid columns={COLUMNS} events={[event("A", 600, 630), event("B", 600, 630), event("C", 600, 630)]} startHour={8} endHour={18} onSelect={() => undefined} summary="Grid" />);
    expect(screen.getByRole("button", { name: "C label" }).style.left).toMatch(/^calc\(66\.666\d*% \+ 2px\)$/);
  });
});

describe("TimeGrid now line", () => {
  it("draws the line at the clinic time with the time on the gutter, in today's column only", () => {
    const { container } = render(
      <TimeGrid columns={[...COLUMNS, { id: "e", label: "Tue" }]} events={[]} startHour={8} endHour={18} nowMinute={13 * 60 + 15} onSelect={() => undefined} summary="Grid" />,
    );
    expect(screen.getAllByTestId("now-line")).toHaveLength(1);
    expect(screen.getByTestId("now-line").style.top).toBe("52.5%");
    expect(container.querySelector(".mk-tg-nowtag")?.textContent).toBe("1:15 pm");
  });
});

describe("TimeGrid chips", () => {
  it("shows a status icon and leaves a slot for a tag", () => {
    render(
      <TimeGrid columns={COLUMNS} events={[event("A", 600, 660, { status: "completed", doctorTone: 2, tag: <i data-testid="tag">New patient</i>, subtitle: "10:00 am · Root canal" })]} startHour={8} endHour={18} onSelect={() => undefined} summary="Grid" />,
    );
    const chip = screen.getByRole("button", { name: "A label" });
    expect(chip.querySelector("svg.mk-ev-ic")).not.toBeNull();
    expect(chip.getAttribute("data-status")).toBe("completed");
    expect(chip.classList.contains("d2")).toBe(true);
    expect(screen.getByTestId("tag").closest(".mk-ev-tag")).not.toBeNull();
    expect(chip.textContent).toContain("Root canal");
  });

  it("counts the visits in each column header", () => {
    render(<TimeGrid columns={COLUMNS} events={[event("A", 600, 630), event("B", 700, 730)]} startHour={8} endHour={18} onSelect={() => undefined} summary="Grid" />);
    expect(screen.getByText("2 visits")).toBeTruthy();
  });
});

describe("TimeGrid booking an empty slot", () => {
  it("shows + Book at the slot under the pointer and books it on click", () => {
    const onBook = vi.fn();
    const { container } = render(<TimeGrid columns={COLUMNS} events={[event("A", 600, 660)]} startHour={8} endHour={18} onSelect={() => undefined} onBook={onBook} summary="Grid" />);
    const column = container.querySelector<HTMLElement>(".mk-tg-col");
    if (column === null) throw new Error("expected a column");
    // 72px an hour with the column at the top of the page: y = 180 is 2.5 hours in, so the 10:30 slot.
    fireEvent.mouseMove(column, { clientY: 180 });
    expect(container.querySelector(".mk-tg-ghost")?.textContent).toBe("+ Book 10:30 am");
    fireEvent.click(column, { clientY: 180 });
    expect(onBook).toHaveBeenCalledWith({ columnId: "d", startMin: 630 });
    fireEvent.mouseLeave(column);
    expect(container.querySelector(".mk-tg-ghost")).toBeNull();
  });

  it("is reachable by keyboard: tab to the column, arrows pick the time, Enter books", async () => {
    const user = userEvent.setup();
    const onBook = vi.fn();
    render(<TimeGrid columns={[{ id: "d", label: "Mon", dateLabel: "16" }]} events={[]} startHour={8} endHour={18} workingMinutes={{ start: 540, end: 1020 }} onSelect={() => undefined} onBook={onBook} summary="Grid" />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("group", { name: /Mon 16: free time/ }));
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Starts at the 9 am opening; two steps down is 10:00.
    expect(onBook).toHaveBeenCalledWith({ columnId: "d", startMin: 600 });
  });

  it("does not turn a click on an appointment into a booking", async () => {
    const user = userEvent.setup();
    const onBook = vi.fn();
    const onSelect = vi.fn();
    render(<TimeGrid columns={COLUMNS} events={[event("A", 600, 660)]} startHour={8} endHour={18} onSelect={onSelect} onBook={onBook} summary="Grid" />);
    await user.click(screen.getByRole("button", { name: "A label" }));
    expect(onSelect).toHaveBeenCalledWith("A");
    expect(onBook).not.toHaveBeenCalled();
  });
});

describe("Calendar page: booking from the grid and axe (New look)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(NEW_LOOK_KEY, "1");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("opens the booking form on the day of the clicked empty slot", async () => {
    renderPortal("/calendar?from=2026-10-12&to=2026-10-18", { as: PEOPLE.asha });
    const column = await screen.findByRole("group", { name: /^Thu 15: free time/ });
    fireEvent.click(column, { clientY: 100 });
    expect(await screen.findByRole("dialog", { name: "New appointment" })).toBeTruthy();
  });

  it("has no axe violations in the week view", async () => {
    renderPortal("/calendar?from=2026-09-28&to=2026-10-04", { as: PEOPLE.asha });
    const grid = await screen.findByRole("group", { name: /Appointments from 2026-09-28/ });
    await waitFor(() => {
      expect(grid.querySelectorAll(".mk-tg-ev").length).toBeGreaterThan(0);
    });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("has no axe violations in the day view", async () => {
    const user = userEvent.setup();
    renderPortal("/calendar?from=2026-10-03&to=2026-10-09", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Day" }));
    await screen.findByRole("group", { name: /Appointments from 2026-10-0\d to 2026-10-0\d/ });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });

  it("has no axe violations in the month view", async () => {
    const user = userEvent.setup();
    renderPortal("/calendar?from=2026-10-01&to=2026-10-01", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Month" }));
    await screen.findByRole("group", { name: "Appointments in 2026-10" });
    expect(problems(await axe.run(document.body, AXE))).toEqual([]);
  });
});
