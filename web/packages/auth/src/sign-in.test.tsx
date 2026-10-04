import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_MESSAGES, createDevAuth, DevSignIn, EmailCodeSignIn, type AuthOutcome, type EmailCodeAuthClient } from "./index.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function stubAuth(responses: { request?: AuthOutcome; verify?: AuthOutcome } = {}) {
  const requestCode = vi.fn((email: string) => Promise.resolve(responses.request ?? { ok: true as const, email }));
  const verifyCode = vi.fn((email: string, code: string) => Promise.resolve(responses.verify ?? { ok: true as const, email, code }));
  const auth: EmailCodeAuthClient = {
    kind: "email_code",
    getState: () => ({ status: "signed_out" }),
    subscribe: () => () => undefined,
    getAccessToken: () => Promise.resolve(null),
    signOut: () => Promise.resolve(),
    requestCode,
    verifyCode,
  };
  return { auth, requestCode, verifyCode };
}

describe("EmailCodeSignIn", () => {
  it("rejects a malformed email without calling the service", async () => {
    const user = userEvent.setup();
    const { auth, requestCode } = stubAuth();
    render(<EmailCodeSignIn auth={auth} />);

    await user.type(screen.getByLabelText(/work email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(screen.getByText(AUTH_MESSAGES.invalidEmail)).toBeTruthy();
    expect(screen.getByLabelText(/work email/i).getAttribute("aria-invalid")).toBe("true");
    expect(requestCode).not.toHaveBeenCalled();
  });

  it("asks for the code with a message that never says whether the account exists", async () => {
    const user = userEvent.setup();
    const { auth, requestCode } = stubAuth();
    render(<EmailCodeSignIn auth={auth} />);

    await user.type(screen.getByLabelText(/work email/i), " aarav@sakalya.example ");
    await user.keyboard("{Enter}");

    expect(requestCode).toHaveBeenCalledWith("aarav@sakalya.example");
    expect(screen.getByRole("status").textContent).toContain("If aarav@sakalya.example is registered, we've sent a 6-digit code");
    expect(document.activeElement).toBe(screen.getByLabelText(/6-digit code/i));
  });

  it("keeps Resend disabled for 60 seconds, counting down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { auth, requestCode } = stubAuth();
    render(<EmailCodeSignIn auth={auth} />);
    await user.type(screen.getByLabelText(/work email/i), "aarav@sakalya.example");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    const resend = () => screen.getByRole("button", { name: /resend code/i });
    expect(resend().textContent).toBe("Resend code in 60 s");
    expect(resend().hasAttribute("disabled")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(resend().textContent).toBe("Resend code in 30 s");

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(resend().textContent).toBe("Resend code");
    await user.click(resend());
    expect(requestCode).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status").textContent).toContain("we've sent a new code");
  });

  it("shows a wrong or expired code as an error on the code field", async () => {
    const user = userEvent.setup();
    const { auth, verifyCode } = stubAuth({ verify: { ok: false, code: "invalid_code", message: AUTH_MESSAGES.invalidCode } });
    render(<EmailCodeSignIn auth={auth} />);
    await user.type(screen.getByLabelText(/work email/i), "aarav@sakalya.example{Enter}");

    await user.type(screen.getByLabelText(/6-digit code/i), "12a3456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(verifyCode).toHaveBeenCalledWith("aarav@sakalya.example", "123456");
    expect(screen.getByText(AUTH_MESSAGES.invalidCode)).toBeTruthy();
  });

  it("explains a rate limit and blocks another request until the cooldown ends", async () => {
    const user = userEvent.setup();
    const { auth } = stubAuth({ request: { ok: false, code: "rate_limited", message: AUTH_MESSAGES.rateLimited } });
    render(<EmailCodeSignIn auth={auth} />);
    await user.type(screen.getByLabelText(/work email/i), "aarav@sakalya.example{Enter}");

    expect(screen.getByRole("alert").textContent).toBe(AUTH_MESSAGES.rateLimited);
    expect(screen.getByRole("button", { name: /try again in 60 s/i }).hasAttribute("disabled")).toBe(true);
  });
});

describe("DevSignIn", () => {
  it("signs in as the chosen person", async () => {
    const user = userEvent.setup();
    const auth = createDevAuth({
      people: [
        { id: "p1", displayName: "Aarav Kulkarni", description: "Sakalya admin" },
        { id: "p2", displayName: "Isha Nair" },
      ],
      tokenFor: (id) => id,
      storage: null,
    });
    render(<DevSignIn auth={auth} />);

    await user.click(screen.getByRole("button", { name: "Isha Nair" }));

    expect(auth.getState()).toMatchObject({ status: "signed_in", user: { id: "p2" } });
  });
});
