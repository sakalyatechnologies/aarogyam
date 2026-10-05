import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { DatePicker } from "./date-picker.js";
import { TimeSlotPicker } from "./time-slots.js";

function Harness({ onChange = () => undefined }: { onChange?: (d: string) => void }) {
  const [value, setValue] = useState("2026-10-07");
  return (
    <DatePicker
      value={value}
      min="2026-10-05"
      today="2026-10-05"
      onChange={(d) => {
        setValue(d);
        onChange(d);
      }}
    />
  );
}

describe("DatePicker", () => {
  it("opens a month grid with today marked, the chosen day selected and past days disabled", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: /Wed, 7 Oct/ }));
    expect(screen.getByRole("gridcell", { name: /Mon, 5 Oct/ }).getAttribute("aria-current")).toBe("date");
    expect(screen.getByRole("gridcell", { name: /Wed, 7 Oct/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: /Sun, 4 Oct/ }).hasAttribute("disabled")).toBe(true);
  });

  it("picks with a click and ignores disabled days", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /7 Oct/ }));
    await user.click(screen.getByRole("gridcell", { name: /Sun, 4 Oct/ }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("gridcell", { name: /Fri, 9 Oct/ }));
    expect(onChange).toHaveBeenCalledWith("2026-10-09");
    expect(screen.queryByRole("grid")).toBeNull();
  });

  it("moves by keyboard: arrows by day and week, Enter picks, Escape closes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: /7 Oct/ }));
    await user.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("2026-10-15");
    await user.click(screen.getByRole("button", { name: /15 Oct/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("grid")).toBeNull();
  });
});

describe("TimeSlotPicker", () => {
  it("shows free slots, marks the chosen one and fills the time on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TimeSlotPicker value="09:30" onChange={onChange} slots={[540, 570, 600]} />);
    expect(screen.getByRole("button", { name: "9:30 am" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "10 am" }));
    expect(onChange).toHaveBeenCalledWith("10:00");
  });

  it("explains when there are none", () => {
    render(<TimeSlotPicker value="09:00" onChange={() => undefined} slots={[]} emptyNote="Choose a doctor first." />);
    expect(screen.getByText("Choose a doctor first.")).toBeTruthy();
  });
});
