import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DatePicker } from "./date-picker.js";
import { pickDate } from "../../test/date-picker.js";

function Optional({ start = "" }: { start?: string }) {
  const [value, setValue] = useState(start);
  return <DatePicker label="Expiry date" placeholder="No expiry" clearable value={value} today="2026-10-03" onChange={setValue} />;
}

afterEach(cleanup);

describe("DatePicker", () => {
  it("picks a day and clears it again when clearable", async () => {
    const user = userEvent.setup();
    render(<Optional />);
    await user.click(screen.getByRole("button", { name: "Expiry date, No expiry" }));
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    await user.keyboard("{Escape}");
    await pickDate(user, "Expiry date", "2027-01-15");
    expect(screen.getByRole("button", { name: /^Expiry date, Fri, 15 Jan 2027$/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Expiry date, / }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Expiry date, No expiry" })).toBeTruthy();
  });

  it("offers no Clear unless asked", async () => {
    const user = userEvent.setup();
    render(<DatePicker label="Date" value="2026-10-05" today="2026-10-03" onChange={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /^Date, / }));
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
    expect(screen.getByRole("button", { name: "Today" })).toBeTruthy();
  });
});
