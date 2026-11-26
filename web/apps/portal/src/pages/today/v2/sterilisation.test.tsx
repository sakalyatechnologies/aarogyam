import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiClient } from "@aarogyam/api-client";
import { ROLES } from "@aarogyam/api-client/fake";

import { NEW_LOOK_KEY } from "../../../lib/new-look.js";
import { PEOPLE, fakeApi, renderPortal } from "../../../test/render.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(NEW_LOOK_KEY, "1");
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

const asFrontDesk = () =>
  fakeApi((fixtures) => {
    const membership = fixtures.memberships.find((m) => m.user_id === PEOPLE.farah);
    if (membership !== undefined) membership.role = ROLES.frontDesk;
  });

describe("Sterilisation on Today", () => {
  it("logs a cycle with a note and the count goes up", async () => {
    const user = userEvent.setup();
    const sent: (string | null | undefined)[] = [];
    renderPortal("/", {
      as: PEOPLE.farah,
      backend: asFrontDesk(),
      wrap: (client: ApiClient): ApiClient => ({
        ...client,
        recordSterilisationCycle: (input, opts) => {
          sent.push(input.load_note);
          return client.recordSterilisationCycle(input, opts);
        },
      }),
    });
    expect(await screen.findByText(/Sterilisation: 0 cycles today/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Log a cycle" }));
    await user.type(await screen.findByLabelText(/What was in the load/), "Handpieces");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Sterilisation: 1 cycle today/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
    expect(sent).toEqual(["Handpieces"]);
  });
});
