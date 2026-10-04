import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { ApiFailure, requestId } from "@aarogyam/api-client";

import { CardLink } from "@sakalya/ui";

import { ApiErrorNotice, RouterLinks, createQueryClient } from "./index.js";

afterEach(cleanup);

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <RouterLinks>
            <CardLink href="/clinics">All clinics</CardLink>
          </RouterLinks>
        ),
      },
      { path: "/clinics", element: <p>Clinics page</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("RouterLinks", () => {
  it("routes library links inside the app instead of reloading the page", async () => {
    const user = userEvent.setup();
    const router = renderAt("/");
    await user.click(screen.getByRole("link", { name: "All clinics" }));
    expect(router.state.location.pathname).toBe("/clinics");
    expect(screen.getByText("Clinics page")).toBeTruthy();
  });
});

describe("ApiErrorNotice", () => {
  it("shows the API's message and the request ID to quote, as an alert", () => {
    const failure = new ApiFailure({
      status: 503,
      code: "unavailable",
      message: "The service is busy. Try again shortly.",
      requestId: requestId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405162"),
    });
    render(<ApiErrorNotice title="Couldn't load clinics" error={failure} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("The service is busy. Try again shortly.");
    expect(alert.textContent).toContain("0192f1c4-7a10-7c3e-9b2a-1d2e3f405162");
  });

  it("never shows raw text from an unexpected error", () => {
    render(<ApiErrorNotice title="Couldn't load" error={new Error("TypeError at line 12: patient Asha")} />);
    expect(screen.getByRole("alert").textContent).not.toContain("Asha");
  });
});

describe("createQueryClient", () => {
  it("does not retry client errors but retries server and network failures", () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry;
    expect(typeof retry).toBe("function");
    if (typeof retry !== "function") return;
    const failure = (status: number) => new ApiFailure({ status, code: "x", message: "x" });
    expect(retry(0, failure(404))).toBe(false);
    expect(retry(0, failure(503))).toBe(true);
    expect(retry(2, failure(503))).toBe(false);
    expect(retry(0, new ApiFailure({ status: 0, code: "network_error", message: "x" }))).toBe(true);
  });
});
