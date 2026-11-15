import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const { signOutEverywhere, client } = vi.hoisted(() => ({
  signOutEverywhere: vi.fn(() => Promise.resolve()),
  client: {
    requestCode: vi.fn(() => Promise.resolve({ ok: true as const })),
    verifyCode: vi.fn(() => Promise.resolve({ ok: true as const })),
    getAccessToken: vi.fn(() => Promise.resolve(null as string | null)),
  },
}));

vi.mock("./env", () => ({ API_BASE_URL: "", CONSOLE_URL: "", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" }));
vi.mock("./auth", () => ({
  signInConfigured: true,
  getAuthClient: () => Promise.resolve(client),
  verifiedAccessToken: () => Promise.resolve(null),
  signOutEverywhere,
}));

import { SignInPage } from "./SignInPage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = "";
});

async function type(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function press(label: string) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  await act(async () => {
    button?.click();
  });
}

async function signInWithoutToken() {
  const host = document.createElement("div");
  document.body.append(host);
  await act(async () => {
    createRoot(host).render(<SignInPage onBack={() => undefined} onRegister={() => undefined} />);
  });
  await type("si-email", "dr.test@example.org");
  await press("Email me a code");
  await type("si-code", "123456");
  await press("Sign in");
}

describe("website sign-in failure", () => {
  it("shows an error, not an endless loader, when no token comes back, and focuses it", async () => {
    await signInWithoutToken();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("We couldn't finish signing you in.");
    expect(document.activeElement?.tagName).toBe("H1");
    expect(document.querySelector('[data-testid="boot-loader"]')).not.toBeNull();
  });

  it("signs out when going back to sign in, then shows the form", async () => {
    await signInWithoutToken();
    await press("Back to sign in");
    expect(signOutEverywhere).toHaveBeenCalledOnce();
    expect(document.getElementById("si-email")).not.toBeNull();
  });
});
