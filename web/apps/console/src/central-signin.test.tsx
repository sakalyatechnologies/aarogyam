import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderConsole } from "./test/render-console.js";

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

describe("Console central sign-in", () => {
  it("sends a signed-out visitor to the site with next=console when the setting is on", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", CENTRAL);
    stubLocation();
    renderConsole("/health", { signedIn: false });
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith(`${CENTRAL}?next=console`);
    });
  });

  it("keeps the in-app sign-in when the setting is off", async () => {
    vi.stubEnv("VITE_CENTRAL_SIGNIN_URL", "");
    stubLocation();
    const { router } = renderConsole("/health", { signedIn: false });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/sign-in");
    });
    expect(assign).not.toHaveBeenCalled();
  });
});
