import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LegalLinks } from "./legal-links.js";
import { PEOPLE, renderPortal } from "../test/render.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Legal links", () => {
  it("point at the public website's pages", () => {
    render(<LegalLinks />);
    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "https://aarogyam.sakalyatechnologies.com/privacy",
      "https://aarogyam.sakalyatechnologies.com/terms",
      "https://aarogyam.sakalyatechnologies.com/dpa",
      "https://aarogyam.sakalyatechnologies.com/patient-notice",
    ]);
  });

  it("follow the central sign-in's site when the build has one", () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", "https://staging.example.test/sign-in");
    render(<LegalLinks />);
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("https://staging.example.test/privacy");
  });

  it("are in the signed-in portal's footer", async () => {
    renderPortal("/today", { as: PEOPLE.asha });
    expect(await screen.findByRole("link", { name: "Privacy Policy" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Patient notice" })).toBeTruthy();
  });
});
