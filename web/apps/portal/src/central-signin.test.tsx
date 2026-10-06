import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openClinic } from "./clinic.js";
import { fakeApi, PEOPLE, renderPortal } from "./test/render.js";

const CENTRAL = "https://site.example/sign-in";
const assign = vi.fn();

function stubLocation() {
  const { host, hostname, port, protocol, pathname, search, hash, href } = window.location;
  vi.stubGlobal("location", { host, hostname, port, protocol, pathname, search, hash, href, assign });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  assign.mockReset();
});

describe("Central sign-in", () => {
  it("sends a signed-out visitor to the site with this host as next, when the setting is on", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", CENTRAL);
    stubLocation();
    renderPortal("/today");
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(`${CENTRAL}?next=${encodeURIComponent(window.location.host)}`);
    });
  });

  it("does the same from the /sign-in route", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", CENTRAL);
    stubLocation();
    renderPortal("/sign-in");
    await waitFor(() => {
      expect(assign).toHaveBeenCalledOnce();
    });
    expect(screen.queryByText("For clinic owners, doctors and staff.")).toBeNull();
  });

  it("keeps the in-app sign-in when the setting is off", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", "");
    stubLocation();
    const { router } = renderPortal("/today");
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/sign-in");
    });
    expect(await screen.findByText("For clinic owners, doctors and staff.")).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("signs out here and returns to the site's front page", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", CENTRAL);
    stubLocation();
    const user = userEvent.setup();
    const { auth } = renderPortal("/today", { as: PEOPLE.asha });
    await user.click(await screen.findByRole("button", { name: /^Account:/ }));
    await user.click(screen.getByRole("button", { name: /Sign out/ }));
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://site.example/");
    });
    expect(auth.getState().status).toBe("signed_out");
    expect(assign).not.toHaveBeenCalledWith(expect.stringContaining("next="));
  });
});

describe("Clinic switcher", () => {
  const sunrise = "sunrise.example.com";

  it("asks for a handoff for the chosen host and goes to its /auth/handoff", async () => {
    stubLocation();
    const createHandoff = vi.fn(() => Promise.resolve({ ok: true as const, value: { code: "c 1", host: sunrise, expires_at: "", redirect_url: "" } }));
    await openClinic(Object.assign(fakeApi().client({}), { createHandoff }), sunrise);
    expect(createHandoff).toHaveBeenCalledWith({ host: sunrise });
    expect(assign).toHaveBeenCalledWith(`https://${sunrise}/auth/handoff#code=c%201`);
  });

  it("falls back to the clinic's own address (which sends them to sign in) when no code comes", async () => {
    stubLocation();
    const createHandoff = vi.fn(() => Promise.resolve({ ok: false as const, error: { message: "no" } }));
    await openClinic(Object.assign(fakeApi().client({}), { createHandoff }), sunrise);
    expect(assign).toHaveBeenCalledOnce();
    expect(String(assign.mock.calls[0]?.[0])).toContain(`//${sunrise}`);
    expect(String(assign.mock.calls[0]?.[0])).not.toContain("/auth/handoff");
  });
});
