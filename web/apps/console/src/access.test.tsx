import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFixtures, fakeTokenFor } from "@aarogyam/api-client/fake";

import { renderConsole } from "./test/render-console.js";

const assign = vi.fn();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  assign.mockReset();
  window.history.replaceState(null, "", "/");
});

function stubLocation() {
  const { host, hostname, port, protocol, pathname, search, hash, href } = window.location;
  vi.stubGlobal("location", { host, hostname, port, protocol, pathname, search, hash, href, assign });
}

describe("Console access", () => {
  it("lets Sakalya staff in", async () => {
    renderConsole("/health");
    expect(await screen.findByRole("heading", { name: /Service health/i })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects a clinic member's stored session, signs it out and leaves for the site", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", "https://site.example/sign-in");
    stubLocation();
    const { auth } = renderConsole("/health", { asClinicMember: true });
    expect((await screen.findByRole("alert")).textContent).toContain("This account doesn't have Sakalya console access");
    await waitFor(() => {
      expect(auth.getState().status).toBe("signed_out");
    });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://site.example/sign-out");
    }, { timeout: 5000 });
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("refuses a non-staff handoff", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", "https://site.example/sign-in");
    window.history.replaceState(null, "", "/auth/handoff#code=whatever");
    stubLocation();
    const member = fakeTokenFor({ id: createFixtures().users[0]?.id ?? "" });
    const { auth, router } = renderConsole("/auth/handoff", {
      signedIn: false,
      override: (client) =>
        Object.assign(client, {
          redeemHandoff: () => Promise.resolve({ ok: true as const, value: { kind: "dev" as const, access_token: member } }),
        }),
    });
    expect((await screen.findByRole("alert")).textContent).toContain("This account doesn't have Sakalya console access");
    await waitFor(() => {
      expect(auth.getState().status).toBe("signed_out");
    });
    expect(router.state.location.pathname).toBe("/auth/handoff");
  });

  it("lands staff on the dashboard after a handoff", async () => {
    window.history.replaceState(null, "", "/auth/handoff#code=whatever");
    const { router, backend } = renderConsole("/auth/handoff", {
      signedIn: false,
      override: (client) =>
        Object.assign(client, {
          redeemHandoff: () => Promise.resolve({ ok: true as const, value: { kind: "dev" as const, access_token: fakeTokenFor({ id: backend.platformUsers()[0]?.id ?? "" }) } }),
        }),
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/health");
    });
  });
});
