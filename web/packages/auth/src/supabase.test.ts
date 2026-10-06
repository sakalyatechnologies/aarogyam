import { describe, expect, it, vi } from "vitest";

import { AUTH_MESSAGES } from "./index.js";
import { createSupabaseAuth, type SupabaseAuthApi } from "./supabase.js";

type Session = { access_token: string; user: { id: string; email?: string } } | null;

function stubApi(overrides: Partial<SupabaseAuthApi> = {}) {
  let emit: (session: Session) => void = () => undefined;
  const signInWithOtp = vi.fn(() => Promise.resolve({ error: null }));
  const api: SupabaseAuthApi = {
    signInWithOtp,
    verifyOtp: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    exchangeCodeForSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    setSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    getSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
    onAuthStateChange: (callback) => {
      emit = (session) => {
        callback("SIGNED_IN", session);
      };
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    signOut: vi.fn(() => Promise.resolve({ error: null })),
    getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "u1" } }, error: null })),
    signInWithPassword: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    updateUser: vi.fn(() => Promise.resolve({ error: null })),
    ...overrides,
  };
  return {
    api,
    signInWithOtp,
    emit: (session: Session) => {
      emit(session);
    },
  };
}

const apiError = (status: number | undefined, code?: string, name = "AuthApiError") => ({
  name,
  message: "upstream detail that must not be shown",
  status,
  code,
});

describe("createSupabaseAuth", () => {
  it("asks only for codes for existing accounts", async () => {
    const { api, signInWithOtp } = stubApi();
    await createSupabaseAuth(api).requestCode("aarav@sakalya.example");
    expect(signInWithOtp).toHaveBeenCalledWith({ email: "aarav@sakalya.example", options: { shouldCreateUser: false } });
  });

  it("answers an unknown account exactly like a known one", async () => {
    const { api } = stubApi({
      signInWithOtp: () => Promise.resolve({ error: apiError(422, "otp_disabled") }),
    });
    expect(await createSupabaseAuth(api).requestCode("nobody@example.com")).toEqual({ ok: true });
  });

  it("maps rate limits and network failures to safe messages", async () => {
    const limited = stubApi({ signInWithOtp: () => Promise.resolve({ error: apiError(429, "over_email_send_rate_limit") }) });
    expect(await createSupabaseAuth(limited.api).requestCode("a@b.co")).toEqual({
      ok: false,
      code: "rate_limited",
      message: AUTH_MESSAGES.rateLimited,
    });

    const offline = stubApi({ signInWithOtp: () => Promise.reject(new TypeError("Failed to fetch")) });
    expect(await createSupabaseAuth(offline.api).requestCode("a@b.co")).toEqual({
      ok: false,
      code: "network",
      message: AUTH_MESSAGES.network,
    });
  });

  it("reports a wrong or expired code without the upstream detail", async () => {
    const { api } = stubApi({
      verifyOtp: () => Promise.resolve({ data: { session: null }, error: apiError(403, "otp_expired") }),
    });
    const outcome = await createSupabaseAuth(api).verifyCode("a@b.co", "123456");
    expect(outcome).toEqual({ ok: false, code: "invalid_code", message: AUTH_MESSAGES.invalidCode });
  });

  it("moves from loading to signed out to signed in, and serves the access token", async () => {
    const session = { access_token: "jwt", user: { id: "u1", email: "a@b.co" } };
    const { api, emit } = stubApi({
      getSession: vi
        .fn()
        .mockResolvedValueOnce({ data: { session: null } })
        .mockResolvedValue({ data: { session } }),
    });
    const auth = createSupabaseAuth(api);
    expect(auth.getState()).toEqual({ status: "loading" });

    await vi.waitFor(() => {
      expect(auth.getState()).toEqual({ status: "signed_out" });
    });

    emit(session);
    expect(auth.getState()).toEqual({ status: "signed_in", user: { id: "u1", email: "a@b.co" } });
    expect(await auth.getAccessToken()).toBe("jwt");

    await auth.signOut();
    expect(auth.getState()).toEqual({ status: "signed_out" });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(api.signOut).toHaveBeenCalledWith({ scope: "global" });
  });

  it("still clears this browser when the global sign-out fails", async () => {
    const { api } = stubApi({ signOut: vi.fn(() => Promise.reject(new Error("offline"))) });
    const auth = createSupabaseAuth(api);
    await auth.signOut();
    expect(auth.getState()).toEqual({ status: "signed_out" });
  });

  it("verifies a stored session with the server, and drops one the server refuses", async () => {
    const good = stubApi();
    expect(await createSupabaseAuth(good.api).verifySession()).toBe(true);
    const bad = stubApi({ getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: apiError(401) })) });
    const auth = createSupabaseAuth(bad.api);
    expect(await auth.verifySession()).toBe(false);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(bad.api.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(auth.getState()).toEqual({ status: "signed_out" });
  });

  it("sends the redirect URL only when configured", async () => {
    const { api, signInWithOtp } = stubApi();
    await createSupabaseAuth(api, { redirectTo: "https://sunrise.example/auth/callback" }).requestCode("aarav@sakalya.example");
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "aarav@sakalya.example",
      options: { shouldCreateUser: false, emailRedirectTo: "https://sunrise.example/auth/callback" },
    });
  });

  describe("completeRedirect", () => {
    it("exchanges a PKCE code for a session", async () => {
      const session = { access_token: "jwt", user: { id: "u1", email: "a@b.co" } };
      const exchangeCodeForSession = vi.fn(() => Promise.resolve({ data: { session }, error: null }));
      const { api } = stubApi({ exchangeCodeForSession });
      const auth = createSupabaseAuth(api);
      const outcome = await auth.completeRedirect("https://sunrise.example/auth/callback?code=abc123");
      expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
      expect(outcome).toEqual({ ok: true });
      expect(auth.getState()).toEqual({ status: "signed_in", user: { id: "u1", email: "a@b.co" } });
    });

    it("sets the session from an implicit-flow hash", async () => {
      const session = { access_token: "jwt", user: { id: "u1", email: "a@b.co" } };
      const setSession = vi.fn(() => Promise.resolve({ data: { session }, error: null }));
      const { api } = stubApi({ setSession });
      const auth = createSupabaseAuth(api);
      const outcome = await auth.completeRedirect("https://sunrise.example/auth/callback#access_token=jwt&refresh_token=rt");
      expect(setSession).toHaveBeenCalledWith({ access_token: "jwt", refresh_token: "rt" });
      expect(outcome).toEqual({ ok: true });
    });

    it("reports an expired or reused link without the upstream detail", async () => {
      const { api } = stubApi({ exchangeCodeForSession: () => Promise.resolve({ data: { session: null }, error: apiError(403, "otp_expired") }) });
      const outcome = await createSupabaseAuth(api).completeRedirect("https://sunrise.example/auth/callback?code=used");
      expect(outcome.ok).toBe(false);
      expect(outcome).toMatchObject({ ok: false, code: "invalid_code" });
    });

    it("reports an incomplete link", async () => {
      const outcome = await createSupabaseAuth(stubApi().api).completeRedirect("https://sunrise.example/auth/callback");
      expect(outcome.ok).toBe(false);
    });
  });

  describe("passwords", () => {
    it("signs in and publishes the session", async () => {
      const session = { access_token: "jwt", user: { id: "u1", email: "a@b.co" } };
      const signInWithPassword = vi.fn(() => Promise.resolve({ data: { session }, error: null }));
      const auth = createSupabaseAuth(stubApi({ signInWithPassword }).api);
      expect(await auth.signInWithPassword("a@b.co", "a long enough phrase")).toEqual({ ok: true });
      expect(signInWithPassword).toHaveBeenCalledWith({ email: "a@b.co", password: "a long enough phrase" });
      expect(auth.getState()).toEqual({ status: "signed_in", user: { id: "u1", email: "a@b.co" } });
    });

    it("answers a wrong password and an unknown email identically", async () => {
      const wrong = stubApi({ signInWithPassword: () => Promise.resolve({ data: { session: null }, error: apiError(400, "invalid_credentials") }) });
      const unknown = stubApi({ signInWithPassword: () => Promise.resolve({ data: { session: null }, error: apiError(400, "user_not_found") }) });
      const expected = { ok: false, code: "invalid_credentials", message: AUTH_MESSAGES.invalidCredentials };
      expect(await createSupabaseAuth(wrong.api).signInWithPassword("a@b.co", "x")).toEqual(expected);
      expect(await createSupabaseAuth(unknown.api).signInWithPassword("z@b.co", "x")).toEqual(expected);
    });

    it("maps rate limits and network failures on sign-in", async () => {
      const limited = stubApi({ signInWithPassword: () => Promise.resolve({ data: { session: null }, error: apiError(429, "over_request_rate_limit") }) });
      expect(await createSupabaseAuth(limited.api).signInWithPassword("a@b.co", "x")).toMatchObject({ code: "rate_limited" });
      const offline = stubApi({ signInWithPassword: () => Promise.reject(new TypeError("Failed to fetch")) });
      expect(await createSupabaseAuth(offline.api).signInWithPassword("a@b.co", "x")).toMatchObject({ code: "network" });
    });

    it("sets a password through updateUser and maps refusals", async () => {
      const updateUser = vi.fn(() => Promise.resolve({ error: null }));
      expect(await createSupabaseAuth(stubApi({ updateUser }).api).setPassword("a long enough phrase")).toEqual({ ok: true });
      expect(updateUser).toHaveBeenCalledWith({ password: "a long enough phrase" });

      const weak = stubApi({ updateUser: () => Promise.resolve({ error: apiError(422, "weak_password") }) });
      expect(await createSupabaseAuth(weak.api).setPassword("x")).toMatchObject({ code: "weak_password" });
      const other = stubApi({ updateUser: () => Promise.resolve({ error: apiError(400, "reauthentication_needed") }) });
      expect(await createSupabaseAuth(other.api).setPassword("x")).toMatchObject({ code: "rejected", message: AUTH_MESSAGES.passwordRejected });
    });
  });
});
