import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { placementOf } from "../../lib/time-grid.js";
import { TimeGrid, type GridEvent } from "./time-grid.js";

function event(id: string, startMin: number, endMin: number, extra: Partial<GridEvent> = {}): GridEvent {
  return { id, columnId: "d", startMin, endMin, title: id, tone: "b", label: `${id} label`, ...extra };
}

const COLUMNS = [{ id: "d", label: "Mon", dateLabel: "29", showNow: true }];

describe("TimeGrid", () => {
  it("shows 12-hour labels for each hour row", () => {
    const { container } = render(<TimeGrid columns={COLUMNS} events={[]} startHour={8} endHour={14} onSelect={() => undefined} summary="Grid" />);
    const labels = [...container.querySelectorAll(".mk-tg-hours span")].map((n) => n.textContent);
    expect(labels).toEqual(["8 am", "9 am", "10 am", "11 am", "12 pm", "1 pm"]);
  });

  it("places an event by start and sizes it by duration", () => {
    // 13:15 IST for 45 minutes, in a grid of 8 to 18 (10 hours): top 5.25h/10, height 0.75h/10.
    const place = placementOf("2026-10-03T07:45:00Z", "2026-10-03T08:30:00Z", "Asia/Kolkata");
    render(<TimeGrid columns={COLUMNS} events={[event("A", place.startMin, place.endMin)]} startHour={8} endHour={18} onSelect={() => undefined} summary="Grid" />);
    const button = screen.getByRole("button", { name: "A label" });
    expect(button.style.top).toBe("52.5%");
    expect(button.style.height).toContain("7.5%");
  });

  it("puts overlapping events side by side", () => {
    render(<TimeGrid columns={COLUMNS} events={[event("A", 600, 660), event("B", 620, 680), event("C", 800, 830)]} startHour={8} endHour={18} onSelect={() => undefined} summary="Grid" />);
    expect(screen.getByRole("button", { name: "A label" }).style.width).toContain("50%");
    expect(screen.getByRole("button", { name: "B label" }).style.left).toContain("50%");
    expect(screen.getByRole("button", { name: "C label" }).style.width).toContain("100%");
  });

  it("opens an event on click and from the keyboard, and shows the full title on hover", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { container } = render(<TimeGrid columns={COLUMNS} events={[event("A", 600, 660, { label: "Asha Rao, Cleaning at 10:00 am", subtitle: "10:00 am · Dr Shah" })]} startHour={8} endHour={18} onSelect={onSelect} summary="Grid" />);
    const button = screen.getByRole("button", { name: "Asha Rao, Cleaning at 10:00 am" });
    // The hover/focus popover carries the full details.
    expect(container.querySelector(".mk-tip")?.textContent).toBe("A10:00 am · Dr Shah");
    await user.tab();
    expect(document.activeElement).toBe(button);
    await user.keyboard("{Enter}");
    await user.click(button);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenCalledWith("A");
  });

  it("draws the now-line only where asked and inside the visible hours", () => {
    const { rerender } = render(<TimeGrid columns={COLUMNS} events={[]} startHour={8} endHour={18} nowMinute={13 * 60} onSelect={() => undefined} summary="Grid" />);
    expect(screen.getByTestId("now-line").style.top).toBe("50%");
    rerender(<TimeGrid columns={[{ id: "d", label: "Mon" }]} events={[]} startHour={8} endHour={18} nowMinute={13 * 60} onSelect={() => undefined} summary="Grid" />);
    expect(screen.queryByTestId("now-line")).toBeNull();
  });
});

describe("TimeGrid cards", () => {
  it("shows the second line only when the card is tall enough, and shades non-working time", () => {
    const { container } = render(
      <TimeGrid
        columns={[{ id: "d", label: "Mon", current: true }]}
        events={[event("Long", 600, 660, { subtitle: "10:00 am · Dr Shah" }), event("Short", 720, 735, { subtitle: "12:00 pm · Dr Shah" })]}
        startHour={8}
        endHour={18}
        workingMinutes={{ start: 540, end: 1020 }}
        onSelect={() => undefined}
        summary="Grid"
      />,
    );
    const buttons = container.querySelectorAll<HTMLElement>(".mk-tg-ev");
    expect(buttons[0]?.textContent).toContain("Dr Shah");
    expect(buttons[1]?.textContent).toBe("Short");
    expect(container.querySelectorAll(".mk-tg-off").length).toBe(2);
    expect(container.querySelector(".mk-tg-col.current")).not.toBeNull();
  });
});

describe("TimeGrid working spans", () => {
  it("shades outside per-column working spans", () => {
    const { container } = render(
      <TimeGrid
        columns={[{ id: "d", label: "Mon", working: [{ startMin: 600, endMin: 660 }, { startMin: 720, endMin: 780 }] }]}
        events={[event("A", 600, 660)]}
        startHour={8}
        endHour={18}
        onSelect={() => undefined}
        summary="Grid"
      />,
    );
    // Two working spans means 3 shading areas (before first, between, after last)
    expect(container.querySelectorAll(".mk-tg-off").length).toBe(3);
  });

  it("shades the whole column when working spans are empty", () => {
    const { container } = render(
      <TimeGrid
        columns={[{ id: "d", label: "Mon", working: [] }]}
        events={[]}
        startHour={8}
        endHour={18}
        onSelect={() => undefined}
        summary="Grid"
      />,
    );
    // Empty spans means the whole column should be shaded
    expect(container.querySelectorAll(".mk-tg-off").length).toBe(1);
    expect(Number.parseFloat(container.querySelector<HTMLElement>(".mk-tg-off")?.style.height ?? "100")).toBe(100);
  });
});
