import { describe, expect, it, vi } from "vitest";

import { createDevAuth } from "./dev-auth.js";
import { centralSignInUrl, completeHandoff, handoffCode, HANDOFF_EXPIRED } from "./handoff.js";
import { createSupabaseAuth, type SupabaseAuthApi } from "./supabase.js";

const people = [{ id: "a0000000-0000-4000-8000-000000000001", displayName: "Asha Owner", email: "asha@alpha.test" }];

function devAuth() {
  return createDevAuth({ people, tokenFor: () => "token", storage: null });
}

describe("central sign-in handoff", () => {
  it("reads the code from the fragment only", () => {
    expect(handoffCode("#code=abc")).toBe("abc");
    expect(handoffCode("code=abc&x=1")).toBe("abc");
    expect(handoffCode("#")).toBeUndefined();
    expect(handoffCode("#code=")).toBeUndefined();
  });

  it("signs in with a development token from the API", async () => {
    const auth = devAuth();
    const redeem = vi.fn().mockResolvedValue({ kind: "dev", access_token: "fake:a0000000-0000-4000-8000-000000000001" });
    expect(await completeHandoff(auth, "#code=abc", redeem)).toEqual({ ok: true });
    expect(redeem).toHaveBeenCalledWith("abc");
    const state = auth.getState();
    expect(state.status === "signed_in" ? state.user.displayName : null).toBe("Asha Owner");
  });

  it("trades a Supabase token hash for a session on this host", async () => {
    const session = { access_token: "jwt", user: { id: "u1", email: "asha@alpha.test" } };
    const verifyOtp = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const none = () => Promise.resolve({ data: { session: null }, error: null });
    const api: SupabaseAuthApi = {
      signInWithOtp: () => Promise.resolve({ error: null }),
      verifyOtp,
      exchangeCodeForSession: none,
      setSession: none,
      getSession: () => Promise.resolve({ data: { session: null } }),
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      signOut: () => Promise.resolve({ error: null }),
      signInWithPassword: none,
      updateUser: () => Promise.resolve({ error: null }),
      mfa: {
        getAuthenticatorAssuranceLevel: () => Promise.resolve({ data: null, error: null }),
        listFactors: () => Promise.resolve({ data: null, error: null }),
        enroll: () => Promise.resolve({ data: null, error: null }),
        challengeAndVerify: () => Promise.resolve({ data: null, error: null }),
        unenroll: () => Promise.resolve({ data: null, error: null }),
      },
    };
    const auth = createSupabaseAuth(api);
    const outcome = await completeHandoff(auth, "#code=abc", () => Promise.resolve({ kind: "supabase", token_hash: "th-1" }));
    expect(outcome).toEqual({ ok: true });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "th-1", type: "magiclink" });
  });

  it("explains a used or expired code without trying to sign in", async () => {
    const auth = devAuth();
    expect(await completeHandoff(auth, "#code=abc", () => Promise.resolve(null))).toEqual({ ok: false, code: "invalid_code", message: HANDOFF_EXPIRED });
    expect(await completeHandoff(auth, "", () => Promise.reject(new Error("never called")))).toMatchObject({ ok: false, code: "invalid_code" });
    expect(auth.getState().status).toBe("signed_out");
  });

  it("sends signed-out visitors to the central sign-in with this host", () => {
    expect(centralSignInUrl("https://aarogyam.sakalyatechnologies.com/sign-in", "sunrise-aarogyam.sakalyatechnologies.com")).toBe(
      "https://aarogyam.sakalyatechnologies.com/sign-in?next=sunrise-aarogyam.sakalyatechnologies.com",
    );
  });
});

describe("central sign-in addresses", () => {
  it("builds the handoff address with the code in the fragment, encoded", async () => {
    const { handoffUrl } = await import("./handoff.js");
    expect(handoffUrl("a.x", "abc 1")).toBe("https://a.x/auth/handoff#code=abc%201");
  });
  it("sends sign-out to the site's /sign-out, and names the console in next", async () => {
    const { centralSignOutUrl, centralSignInUrl, CONSOLE_NEXT } = await import("./handoff.js");
    expect(centralSignOutUrl("https://aarogyam-website.pages.dev/sign-in")).toBe("https://aarogyam-website.pages.dev/sign-out");
    expect(centralSignInUrl("https://site.example/sign-in", CONSOLE_NEXT)).toBe("https://site.example/sign-in?next=console");
  });
});
