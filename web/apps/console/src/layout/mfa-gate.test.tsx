import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AuthProvider, type EmailCodeAuthClient, type MfaClient, type MfaStatus } from "@aarogyam/auth";

import { MfaGate } from "./mfa-gate.js";

function client(initial: MfaStatus, verify = vi.fn<(factor: string, code: string) => Promise<{ ok: true }>>(() => Promise.resolve({ ok: true }))) {
  let status = initial;
  const mfa: MfaClient = {
    status: () => Promise.resolve({ ok: true, status }),
    enrol: () => Promise.resolve({ ok: true, enrolment: { factorId: "f1", qrCode: "data:image/svg+xml;utf8,<svg/>", secret: "SECRETKEY" } }),
    verify: (factor, code) => {
      status = { step: "done" };
      return verify(factor, code);
    },
  };
  const auth: EmailCodeAuthClient = {
    kind: "email_code",
    getState: () => ({ status: "signed_in", user: { id: "u1" } }),
    subscribe: () => () => undefined,
    getAccessToken: () => Promise.resolve("t"),
    signOut: () => Promise.resolve(),
    verifySession: () => Promise.resolve(true),
    requestCode: () => Promise.resolve({ ok: true }),
    verifyCode: () => Promise.resolve({ ok: true }),
    completeRedirect: () => Promise.resolve({ ok: true }),
    signInWithPassword: () => Promise.resolve({ ok: true }),
    setPassword: () => Promise.resolve({ ok: true }),
    verifyTokenHash: () => Promise.resolve({ ok: true }),
    mfa,
  };
  return { auth, verify };
}

function show(auth: EmailCodeAuthClient) {
  render(
    <AuthProvider client={auth}>
      <MfaGate>
        <p>Console content</p>
      </MfaGate>
    </AuthProvider>,
  );
}

describe("Console second step", () => {
  it("lets a session that already passed it straight in", async () => {
    show(client({ step: "done" }).auth);
    expect(await screen.findByText("Console content")).toBeTruthy();
  });

  it("asks someone with an authenticator for its code, then opens the console", async () => {
    const { auth, verify } = client({ step: "verify", factorId: "f9" });
    show(auth);
    expect(await screen.findByRole("heading", { name: "Enter your authenticator code" })).toBeTruthy();
    expect(screen.queryByText("Console content")).toBeNull();
    await userEvent.setup().type(screen.getByRole("textbox"), "123456");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(verify).toHaveBeenCalledWith("f9", "123456");
    });
    expect(await screen.findByText("Console content")).toBeTruthy();
  });

  it("shows the QR code and the key to someone with no authenticator yet", async () => {
    const { auth, verify } = client({ step: "enrol" });
    show(auth);
    expect(await screen.findByRole("img", { name: "QR code for your authenticator app" })).toBeTruthy();
    expect(screen.getByText("SECRETKEY")).toBeTruthy();
    await userEvent.setup().type(screen.getByRole("textbox"), "654321");
    await userEvent.setup().click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => {
      expect(verify).toHaveBeenCalledWith("f1", "654321");
    });
  });
});
