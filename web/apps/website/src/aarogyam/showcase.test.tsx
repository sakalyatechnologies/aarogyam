import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./env", () => ({ API_BASE_URL: "", CONSOLE_URL: "", SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "k" }));
vi.mock("@aarogyam/auth/supabase", () => ({ createSupabaseAuthClient: () => ({}) }));

import { SignInPage } from "./SignInPage";
import { Showcase } from "./Showcase";

describe("sign-in showcase", () => {
  it("shows the product preview with its three value points and an accessible label", () => {
    const html = renderToString(<Showcase />);
    expect(html).toContain("Today");
    expect(html).toContain("Patient 360");
    expect(html).toContain("Dental chart with materials");
    expect(html).toContain("Prescriptions with allergy checks");
    expect(html).toContain("Billing and GST");
    expect(html).toContain("aria-label");
  });

  it("sits beside the unchanged sign-in form, which stays first in the DOM-independent right column", () => {
    const html = renderToString(<SignInPage onBack={() => undefined} onRegister={() => undefined} />);
    expect(html).toContain("v4-auth-left");
    expect(html).toContain("v4-auth-right");
    expect(html).toContain("Request access");
  });

  it("links the privacy policy, terms and notices under the form", () => {
    const html = renderToString(<SignInPage onBack={() => undefined} onRegister={() => undefined} />);
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });
});
