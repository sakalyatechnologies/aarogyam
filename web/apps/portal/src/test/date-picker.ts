import { screen } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

/**
 * Picks `value` (YYYY-MM-DD) in the calendar date picker whose button is named `label` ("Paid on, Mon 5 Oct 2026"),
 * turning months until that day shows.
 */
export async function pickDate(user: ReturnType<typeof userEvent.setup>, label: string, value: string): Promise<void> {
  await user.click(screen.getByRole("button", { name: new RegExp(`^${label}, `) }));
  for (let turns = 0; turns < 36; turns += 1) {
    const cell = document.querySelector<HTMLElement>(`[role="gridcell"][data-date="${value}"]`);
    if (cell !== null) {
      await user.click(cell);
      return;
    }
    const shown = document.querySelector<HTMLElement>('[role="gridcell"]')?.dataset["date"] ?? value;
    await user.click(screen.getByRole("button", { name: value < shown ? "Previous month" : "Next month" }));
  }
  throw new Error(`couldn't reach ${value} in the ${label} picker`);
}
