import { act, render, screen } from "@testing-library/react";
import { LazyMotion, domAnimation } from "motion/react";
import { useEffect } from "react";
import { createMemoryRouter, useSearchParams } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it } from "vitest";

import { PageTransition, sectionOf } from "./page-transition.js";

/** Mirrors a range into its query string on every location change, as Calendar does. */
function RangePage() {
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get("from") !== "2026-10-05") setParams({ from: "2026-10-05" }, { replace: true });
  }, [params, setParams]);
  return <h1>Calendar</h1>;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <PageTransition />,
        children: [
          { path: "patients", element: <h1>Patient list</h1> },
          { path: "patients/:id", element: <h1>One patient</h1> },
          { path: "stock", element: <h1>Stock</h1> },
          { path: "calendar", element: <RangePage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(
    <LazyMotion features={domAnimation} strict>
      <RouterProvider router={router} />
    </LazyMotion>,
  );
  return router;
}

describe("PageTransition", () => {
  it("keys pages by their section", () => {
    expect(sectionOf("/patients/42/edit")).toBe("patients");
    expect(sectionOf("/patients")).toBe("patients");
    expect(sectionOf("/")).toBe("");
  });

  it("renders the routed page and swaps it when the section changes", async () => {
    const router = renderAt("/patients");
    expect(screen.getByRole("heading", { name: "Patient list" })).toBeTruthy();
    const wrapper = screen.getByRole("heading").parentElement;

    // Within a section the wrapper stays, so the page doesn't replay its entrance.
    await act(() => router.navigate("/patients/7"));
    expect(screen.getByRole("heading", { name: "One patient" })).toBeTruthy();
    expect(screen.getByRole("heading").parentElement).toBe(wrapper);

    // A new section waits for the old page to leave, then shows the new one.
    await act(() => router.navigate("/stock"));
    expect(await screen.findByRole("heading", { name: "Stock" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "One patient" })).toBeNull();
  });

  it("keeps a leaving page's query string off the next page", async () => {
    const router = renderAt("/calendar");
    expect(router.state.location.search).toBe("?from=2026-10-05");
    await act(() => router.navigate("/stock"));
    expect(await screen.findByRole("heading", { name: "Stock" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/stock");
    expect(router.state.location.search).toBe("");
  });
});
