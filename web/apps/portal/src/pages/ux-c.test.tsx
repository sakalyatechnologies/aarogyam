import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NEW_LOOK_KEY } from "../lib/new-look.js";
import { PEOPLE, renderPortal } from "../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("Calendar and queue simplifications", () => {
  it("shows no empty To collect section when nothing is owed", async () => {
    renderPortal("/queue", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: /Follow-ups/ });
    expect(screen.queryByRole("heading", { name: /To collect/ })).toBeNull();
  });

  it("says Just arrived instead of Waiting 0 min", async () => {
    renderPortal("/queue", { as: PEOPLE.asha });
    await screen.findByRole("heading", { name: /Follow-ups/ });
    expect(screen.queryByText("Waiting 0 min")).toBeNull();
  });

  it("does not tag every row of the check-in list as Booked", async () => {
    const user = userEvent.setup();
    renderPortal("/queue", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "Add to queue" }));
    await user.click(await screen.findByRole("button", { name: /Check in a booking/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByLabelText("Search today's bookings");
    expect(within(dialog).queryByText("Booked")).toBeNull();
  });

  it("names the calendar button like the queue's, New appointment", async () => {
    renderPortal("/calendar", { as: PEOPLE.asha });
    expect(await screen.findByRole("button", { name: "New appointment" })).toBeTruthy();
  });

  it("labels the booking dialog's kind field Visit type", async () => {
    const user = userEvent.setup();
    renderPortal("/calendar", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: "New appointment" }));
    expect(await screen.findByText("Visit type")).toBeTruthy();
  });
});
