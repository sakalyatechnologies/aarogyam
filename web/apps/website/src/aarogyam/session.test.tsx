import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const client = {
  getAccessToken: vi.fn(),
  verifySession: vi.fn(),
  signOut: vi.fn(() => Promise.resolve()),
};

vi.mock("./env", () => ({ API_BASE_URL: "", CONSOLE_URL: "", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" }));
vi.mock("@aarogyam/auth/supabase", () => ({ createSupabaseAuthClient: () => client }));

import { signOutEverywhere, verifiedAccessToken } from "./auth";
import { SignOutPage } from "./SignOutPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.clearAllMocks();
});

describe("stored session", () => {
  it("is trusted only after the server confirms it", async () => {
    client.getAccessToken.mockResolvedValue("tok");
    client.verifySession.mockResolvedValue(true);
    expect(await verifiedAccessToken()).toBe("tok");
    client.verifySession.mockResolvedValue(false);
    expect(await verifiedAccessToken()).toBeNull();
  });

  it("is not verified when there is no stored session", async () => {
    client.getAccessToken.mockResolvedValue(null);
    expect(await verifiedAccessToken()).toBeNull();
    expect(client.verifySession).not.toHaveBeenCalled();
  });

  it("signs out everywhere", async () => {
    await signOutEverywhere();
    expect(client.signOut).toHaveBeenCalledOnce();
  });
});

describe("/sign-out page", () => {
  it("clears the site's session before showing the sign-in page", async () => {
    client.getAccessToken.mockResolvedValue(null);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<SignOutPage onBack={() => undefined} onRegister={() => undefined} />);
    });
    expect(client.signOut).toHaveBeenCalledOnce();
    expect(host.textContent).toContain("Email me a code");
    await act(async () => {
      root.unmount();
    });
  });
});
