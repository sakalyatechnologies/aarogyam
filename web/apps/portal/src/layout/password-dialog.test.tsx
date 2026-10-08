import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_MESSAGES, PasswordDialog, type AuthOutcome, type EmailCodeAuthClient } from "@aarogyam/auth";

afterEach(cleanup);

// Lives with the portal because the dialog is Base UI, which only the apps resolve with one React.
function stubAuth(responses: { setPassword?: AuthOutcome } = {}) {
  const setPassword = vi.fn((password: string) => Promise.resolve(responses.setPassword ?? { ok: true as const, password }));
  const auth: EmailCodeAuthClient = {
    kind: "email_code",
    getState: () => ({ status: "signed_in", user: { id: "u1" } }),
    subscribe: () => () => undefined,
    getAccessToken: () => Promise.resolve("jwt"),
    signOut: () => Promise.resolve(),
    verifySession: () => Promise.resolve(true),
    requestCode: () => Promise.resolve({ ok: true }),
    verifyCode: () => Promise.resolve({ ok: true }),
    completeRedirect: () => Promise.resolve({ ok: true }),
    signInWithPassword: () => Promise.resolve({ ok: true }),
    setPassword,
    verifyTokenHash: () => Promise.resolve({ ok: true as const }),
    mfa: {
      status: () => Promise.resolve({ ok: true as const, status: { step: "done" as const } }),
      enrol: () => Promise.resolve({ ok: false as const, message: "unused" }),
      verify: () => Promise.resolve({ ok: true as const }),
    },
  };
  return { auth, setPassword };
}

describe("PasswordDialog", () => {
  function open(responses: Parameters<typeof stubAuth>[0] = {}) {
    const stub = stubAuth(responses);
    const onOpenChange = vi.fn();
    render(<PasswordDialog auth={stub.auth} open onOpenChange={onOpenChange} />);
    return { ...stub, onOpenChange, user: userEvent.setup() };
  }

  it("shows a strength hint as the person types", async () => {
    const { user } = open();
    expect(screen.queryByRole("progressbar")).toBeNull();
    await user.type(screen.getByLabelText(/^new password/i), "abc");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toContain("Too short");
  });

  it("refuses a short password or a mismatch without calling the service", async () => {
    const { user, setPassword } = open();
    await user.type(screen.getByLabelText(/^new password/i), "short");
    await user.type(screen.getByLabelText(/^confirm new password/i), "short");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(screen.getByText("Use at least 12 characters.")).toBeTruthy();

    await user.clear(screen.getByLabelText(/^new password/i));
    await user.type(screen.getByLabelText(/^new password/i), "a long enough phrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(screen.getByText("The two passwords don't match.")).toBeTruthy();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("saves a good password and confirms", async () => {
    const { user, setPassword } = open();
    await user.type(screen.getByLabelText(/^new password/i), "a long enough phrase");
    await user.type(screen.getByLabelText(/^confirm new password/i), "a long enough phrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect(setPassword).toHaveBeenCalledWith("a long enough phrase");
    expect((await screen.findByRole("status")).textContent).toContain("Password saved");
  });

  it("shows the service's refusal", async () => {
    const { user } = open({ setPassword: { ok: false, code: "rejected", message: AUTH_MESSAGES.passwordRejected } });
    await user.type(screen.getByLabelText(/^new password/i), "a long enough phrase");
    await user.type(screen.getByLabelText(/^confirm new password/i), "a long enough phrase");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    expect((await screen.findByRole("alert")).textContent).toBe(AUTH_MESSAGES.passwordRejected);
  });
});
