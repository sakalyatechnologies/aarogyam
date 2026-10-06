import { describe, expect, it, vi } from "vitest";

import { fetchMe, handoffUrl, requestHandoff, submitRegistration, type Fetch, type RegistrationFields } from "./api";
import { decideDestination } from "./routing";

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const mock = (res: Response): Fetch => vi.fn(() => Promise.resolve(res)) as unknown as Fetch;

const clinic = (slug: string, host: string | null) => ({ org_id: slug, slug, name: slug, role_key: "doctor", role_name: "Doctor", host });
const fields: RegistrationFields = { name: "A", email: "a@b.in", phone: "1", role: "Doctor", spec: "Orthodontics", clinic: "C", city: "Pune", lic: "" };

describe("decideDestination", () => {
  const CONSOLE = "https://console-aarogyam.example.com/";
  it("sends staff with no clinic straight to the console", () => {
    expect(decideDestination({ clinics: [], console_access: true }, CONSOLE)).toEqual({
      kind: "go",
      place: { key: "console", name: "Sakalya console", detail: "Super admin", host: "console-aarogyam.example.com" },
    });
  });
  it("offers staff with clinics a picker, the console first", () => {
    const dest = decideDestination({ clinics: [clinic("a", "a.x")], console_access: true }, CONSOLE);
    expect(dest.kind === "picker" ? dest.places.map((p) => p.host) : []).toEqual(["console-aarogyam.example.com", "a.x"]);
  });
  it("opens the only clinic, picks between several, and says when there is none", () => {
    const one = decideDestination({ clinics: [clinic("a", "a.x")] }, CONSOLE);
    expect(one.kind === "go" ? one.place.host : "").toBe("a.x");
    expect(decideDestination({ clinics: [clinic("a", "a.x"), clinic("b", "b.x")] }, "").kind).toBe("picker");
    expect(decideDestination({ clinics: [clinic("a", null)] }, "").kind).toBe("none");
    // Not staff: no console, whatever the URL.
    expect(decideDestination({ clinics: [], console_access: false }, CONSOLE).kind).toBe("none");
  });
});

describe("API calls", () => {
  it("reads /me with the bearer token", async () => {
    const f = mock(json(200, { clinics: [clinic("a", "a.x")] }));
    const out = await fetchMe("tok", f);
    expect(out.ok && out.value.clinics).toHaveLength(1);
    expect(vi.mocked(f).mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: "Bearer tok" } });
  });

  it("asks for a handoff code for the target host and builds the redirect", async () => {
    const f = mock(json(200, { code: "abc 1" }));
    const out = await requestHandoff("tok", "a.x", f);
    expect(out).toEqual({ ok: true, value: "abc 1" });
    expect(JSON.parse(String(vi.mocked(f).mock.calls[0]?.[1]?.body))).toEqual({ host: "a.x" });
    expect(handoffUrl("a.x", "abc 1")).toBe("https://a.x/auth/handoff#code=abc%201");
  });

  it("explains a host the account may not open instead of sending them elsewhere", async () => {
    const out = await requestHandoff("tok", "a.x", mock(json(404, { error: { message: "not found" } })));
    expect(out.ok).toBe(false);
    expect(out.ok ? "" : out.message).toMatch(/isn't open to this account/);
  });

  it("maps the registration answer to the API's fields and shows its validation message", async () => {
    const ok = mock(json(202, { status: "received", message: "Thanks." }));
    expect(await submitRegistration(fields, ok)).toEqual({ ok: true, value: "Thanks." });
    expect(JSON.parse(String(vi.mocked(ok).mock.calls[0]?.[1]?.body))).toMatchObject({ clinic_name: "C", specialty: "dental", contact_name: "A" });
    const bad = await submitRegistration(fields, mock(json(400, { error: { message: "email is not valid" } })));
    expect(bad).toEqual({ ok: false, message: "email is not valid" });
    expect((await submitRegistration(fields, mock(json(429, {})))).ok).toBe(false);
  });
});
