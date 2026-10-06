import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_MESSAGES, AuthShell, AuthSteps, createDevAuth, DevSignIn, digitsOnly, EmailCodeSignIn, hasPasswordReset, passwordStrength, type AuthOutcome, type EmailCodeAuthClient } from "./index.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function stubAuth(responses: { request?: AuthOutcome; verify?: AuthOutcome; password?: AuthOutcome; setPassword?: AuthOutcome } = {}) {
  const signInWithPassword = vi.fn((email: string, password: string) =>
    Promise.resolve(responses.password ?? { ok: true as const, email, password }),
  );
  const setPassword = vi.fn((password: string) => Promise.resolve(responses.setPassword ?? { ok: true as const, password }));
  const requestCode = vi.fn((email: string) => Promise.resolve(responses.request ?? { ok: true as const, email }));
  const verifyCode = vi.fn((email: string, code: string) => Promise.resolve(responses.verify ?? { ok: true as const, email, code }));
  const auth: EmailCodeAuthClient = {
    kind: "email_code",
    getState: () => ({ status: "signed_out" }),
    subscribe: () => () => undefined,
    getAccessToken: () => Promise.resolve(null),
    signOut: () => Promise.resolve(),
    verifySession: () => Promise.resolve(true),
    requestCode,
    verifyCode,
    completeRedirect: () => Promise.resolve({ ok: true }),
    signInWithPassword,
    setPassword,
    verifyTokenHash: () => Promise.resolve({ ok: true as const }),
  };
  return { auth, requestCode, verifyCode, signInWithPassword, setPassword };
}

describe("EmailCodeSignIn", () => {
  it("rejects a malformed email without calling the service", async () => {
    const user = userEvent.setup();
    const { auth, requestCode } = stubAuth();
    render(<EmailCodeSignIn auth={auth} />);

    await user.type(screen.getByLabelText(/work email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));

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
    await user.click(screen.getByRole("button", { name: "Email me a code" }));

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

describe("EmailCodeSignIn: the code step", () => {
  async function toCodeStep(responses: Parameters<typeof stubAuth>[0] = {}) {
    const user = userEvent.setup();
    const stub = stubAuth(responses);
    render(<EmailCodeSignIn auth={stub.auth} />);
    await user.type(screen.getByLabelText(/work email/i), "aarav@sakalya.example{Enter}");
    return { user, ...stub };
  }

  it("shows two steps and marks the current one", async () => {
    const user = userEvent.setup();
    render(<EmailCodeSignIn auth={stubAuth().auth} />);
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("Your email");
    await user.type(screen.getByLabelText(/work email/i), "aarav@sakalya.example{Enter}");
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toContain("Your code");
  });

  it("signs in as soon as the sixth digit is typed", async () => {
    const { user, verifyCode } = await toCodeStep();
    await user.type(screen.getByLabelText(/6-digit code/i), "12345");
    expect(verifyCode).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(/6-digit code/i), "6");
    expect(verifyCode).toHaveBeenCalledExactlyOnceWith("aarav@sakalya.example", "123456");
  });

  it("takes a pasted code with spaces and dashes", async () => {
    const { user, verifyCode } = await toCodeStep();
    screen.getByLabelText(/6-digit code/i).focus();
    await user.paste("123 456");
    expect(verifyCode).toHaveBeenCalledWith("aarav@sakalya.example", "123456");
  });

  it("returns to the email step with a different address", async () => {
    const { user } = await toCodeStep();
    await user.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByLabelText(/work email/i)).toHaveProperty("value", "aarav@sakalya.example");
    // The same address must wait out the resend timer; a corrected one may go at once.
    expect(screen.getByRole("button", { name: /try again in 60 s/i }).hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByLabelText(/work email/i), "x");
    expect(screen.getByRole("button", { name: "Email me a code" }).hasAttribute("disabled")).toBe(false);
  });

  it("can hide its own progress bar inside a flow that has one", () => {
    render(<EmailCodeSignIn auth={stubAuth().auth} showSteps={false} />);
    expect(screen.queryByRole("list", { name: "Sign-in steps" })).toBeNull();
  });
});

describe("email step validation", () => {
  it("flags a malformed email when the field loses focus, and clears it once fixed", async () => {
    const user = userEvent.setup();
    render(<EmailCodeSignIn auth={stubAuth().auth} />);
    await user.type(screen.getByLabelText(/work email/i), "aarav@");
    await user.tab();
    expect(screen.getByText(AUTH_MESSAGES.invalidEmail)).toBeTruthy();
    await user.type(screen.getByLabelText(/work email/i), "sakalya.example");
    expect(screen.queryByText(AUTH_MESSAGES.invalidEmail)).toBeNull();
  });
});

describe("helpers and shell", () => {
  it("keeps only digits, at most six", () => {
    expect(digitsOnly("12-34 56789", 6)).toBe("123456");
    expect(digitsOnly("abc", 6)).toBe("");
  });

  it("frames a form beside a product picture, with the brand once for screen readers' landmarks", () => {
    render(
      <AuthShell name="Aarogyam" tagline="Care" icon={null} headline="Calm" points={["One", "Two"]} visual="clinic">
        <h1>Sign in</h1>
      </AuthShell>,
    );
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(screen.getAllByRole("main")).toHaveLength(1);
    expect(screen.getByText("One")).toBeTruthy();
  });

  it("marks done and current steps", () => {
    render(<AuthSteps steps={["A", "B", "C"]} current={1} />);
    const items = screen.getAllByRole("listitem");
    expect(items[0]?.textContent).toContain("(done)");
    expect(items[1]?.getAttribute("aria-current")).toBe("step");
    expect(items[2]?.getAttribute("aria-current")).toBeNull();
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
      tokenFor: (person) => person.id,
      storage: null,
    });
    render(<DevSignIn auth={auth} />);

    await user.click(screen.getByRole("button", { name: "Isha Nair" }));

    expect(auth.getState()).toMatchObject({ status: "signed_in", user: { id: "p2" } });
  });
});

describe("password sign-in", () => {
  afterEach(() => {
    window.sessionStorage.clear();
  });

  async function toPasswordStep(responses: Parameters<typeof stubAuth>[0] = {}) {
    const user = userEvent.setup();
    const stub = stubAuth(responses);
    render(<EmailCodeSignIn auth={stub.auth} />);
    await user.type(screen.getByLabelText(/work email/i), "aarav@sakalya.example");
    await user.click(screen.getByRole("button", { name: "Use a password" }));
    return { user, ...stub };
  }

  it("offers the code first and a password as the alternative", () => {
    render(<EmailCodeSignIn auth={stubAuth().auth} />);
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Use a password" })).toBeTruthy();
  });

  it("checks the email before moving to the password", async () => {
    const user = userEvent.setup();
    render(<EmailCodeSignIn auth={stubAuth().auth} />);
    await user.type(screen.getByLabelText(/work email/i), "nope");
    await user.click(screen.getByRole("button", { name: "Use a password" }));
    expect(screen.getByText(AUTH_MESSAGES.invalidEmail)).toBeTruthy();
    expect(screen.queryByLabelText(/^password/i)).toBeNull();
  });

  it("signs in with email and password", async () => {
    const { user, signInWithPassword } = await toPasswordStep();
    await user.type(screen.getByLabelText(/^password/i), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(signInWithPassword).toHaveBeenCalledWith("aarav@sakalya.example", "correct horse battery");
  });

  it("shows one message for a wrong password or an unknown email", async () => {
    const { user } = await toPasswordStep({ password: { ok: false, code: "invalid_credentials", message: AUTH_MESSAGES.invalidCredentials } });
    await user.type(screen.getByLabelText(/^password/i), "whatever it is");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert").textContent).toBe(AUTH_MESSAGES.invalidCredentials);
  });

  it("does not call the service with an empty password", async () => {
    const { user, signInWithPassword } = await toPasswordStep();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("Forgot password sends the email code and remembers to offer a new password", async () => {
    const { user, requestCode } = await toPasswordStep();
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    expect(requestCode).toHaveBeenCalledWith("aarav@sakalya.example");
    expect(screen.getByLabelText(/6-digit code/i)).toBeTruthy();
    expect(hasPasswordReset()).toBe(true);
  });

  it("Email me a code instead sends the code without the reset note", async () => {
    const { user, requestCode } = await toPasswordStep();
    await user.click(screen.getByRole("button", { name: "Email me a code instead" }));
    expect(requestCode).toHaveBeenCalledTimes(1);
    expect(hasPasswordReset()).toBe(false);
  });
});

describe("passwordStrength", () => {
  it("rejects fewer than 12 characters", () => {
    expect(passwordStrength("short1!")).toMatchObject({ score: 0, acceptable: false });
    expect(passwordStrength("elevenchars")).toMatchObject({ acceptable: false });
  });
  it("rates repeats and runs weak, and long mixed phrases strong", () => {
    expect(passwordStrength("aaaaaaaaaaaaaaaa")).toMatchObject({ score: 1, acceptable: true });
    expect(passwordStrength("Tulip-lantern-4-river-moss")).toMatchObject({ score: 4, acceptable: true });
  });
});
