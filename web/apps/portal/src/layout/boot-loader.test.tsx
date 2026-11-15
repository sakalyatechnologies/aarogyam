import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ApiFailure, type ApiClient } from "@aarogyam/api-client";

import { PEOPLE, renderPortal } from "../test/render.js";

describe("Portal boot loader", () => {
  it("stays one element from 'Signing you in…' to the clinic's name, then gives way to the page", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient): ApiClient => ({ ...client, getSession: async (options) => (await gate, client.getSession(options)) }),
    });
    const loader = await screen.findByTestId("boot-loader");
    await waitFor(() => {
      expect(loader.textContent).toContain("Opening Sunrise Dental…");
    });
    expect(screen.getByTestId("boot-loader")).toBe(loader);
    expect(screen.queryByText("Loading your clinics")).toBeNull();
    release();
    await waitFor(() => {
      expect(screen.queryByTestId("boot-loader")).toBeNull();
    });
  });

  it("shows one error with Try again, which retries the session", async () => {
    const user = userEvent.setup();
    let calls = 0;
    renderPortal("/today", {
      as: PEOPLE.asha,
      wrap: (client: ApiClient): ApiClient => ({
        ...client,
        getSession: (options) => {
          calls += 1;
          return calls === 1 ? Promise.reject(new ApiFailure({ status: 403, code: "forbidden", message: "You can't open this clinic." })) : client.getSession(options);
        },
      }),
    });
    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(screen.getByRole("button", { name: "Back to sign in" })).toBeTruthy();
    await user.click(retry);
    await waitFor(() => {
      expect(screen.queryByTestId("boot-loader")).toBeNull();
    });
    expect(calls).toBeGreaterThan(1);
  });
});
