import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MonthView, type MonthItem } from "./month-view.js";

const item = (id: string, date: string, startMin: number): MonthItem => ({ id, date, startMin, label: `${id} label`, tone: "b" });

describe("MonthView", () => {
  const items = [item("A", "2026-10-03", 600), item("B", "2026-10-03", 540), item("C", "2026-10-03", 700), item("D", "2026-10-03", 800), item("E", "2026-10-10", 600)];

  it("shows counts, the first items in time order and +N more", () => {
    render(<MonthView month="2026-10-03" today="2026-10-03" items={items} onOpenDay={() => undefined} onSelect={() => undefined} />);
    const day = screen.getByRole("button", { name: /^2026-10-03, 4 appointments/ }).parentElement;
    if (day === null) throw new Error("expected the day cell");
    expect(within(day).getAllByTitle(/label$/).map((n) => n.textContent)).toEqual(["B label", "A label"]);
    expect(within(day).getByRole("button", { name: "+2 more" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^2026-10-10, 1 appointment\./ })).toBeTruthy();
  });

  it("covers the month in Monday-first weeks", () => {
    render(<MonthView month="2026-10-03" today="2026-10-03" items={[]} onOpenDay={() => undefined} onSelect={() => undefined} />);
    expect(screen.getByRole("button", { name: /^2026-09-28,/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^2026-11-01,/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^2026-11-02,/ })).toBeNull();
  });

  it("opens a day from its number or +N more, and an appointment from its chip", async () => {
    const user = userEvent.setup();
    const onOpenDay = vi.fn();
    const onSelect = vi.fn();
    render(<MonthView month="2026-10-03" today="2026-10-03" items={items} onOpenDay={onOpenDay} onSelect={onSelect} />);
    await user.click(screen.getByRole("button", { name: /^2026-10-10,/ }));
    await user.click(screen.getByRole("button", { name: "+2 more" }));
    await user.click(screen.getByTitle("E label"));
    expect(onOpenDay.mock.calls).toEqual([["2026-10-10"], ["2026-10-03"]]);
    expect(onSelect).toHaveBeenCalledWith("E");
  });

  it("counts walk-ins in the day's number without listing them", () => {
    render(<MonthView month="2026-10-03" today="2026-10-03" items={items} walkIns={{ "2026-10-03": 2, "2026-10-05": 1 }} onOpenDay={() => undefined} onSelect={() => undefined} />);
    const busy = screen.getByRole("button", { name: "2026-10-03, 4 appointments and 2 walk-ins. Open day" });
    expect(busy.querySelector(".mk-mcount")?.textContent).toBe("6");
    const day = busy.parentElement;
    if (day === null) throw new Error("expected the day cell");
    expect(within(day).getAllByTitle(/label$/)).toHaveLength(2);
    const only = screen.getByRole("button", { name: "2026-10-05, 0 appointments and 1 walk-in. Open day" });
    expect(only.querySelector(".mk-mcount")?.textContent).toBe("1");
    expect(screen.getByRole("button", { name: /^2026-10-10, 1 appointment\. Open day/ }).querySelector(".mk-mcount")?.textContent).toBe("1");
  });
});
