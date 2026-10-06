import { describe, expect, it, vi } from "vitest";

import { fetchMe, handoffUrl, requestHandoff, submitRegistration, type Fetch, type RegistrationFields } from "./api";
import { decideDestination } from "./routing";

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
const mock = (res: Response): Fetch => vi.fn(() => Promise.resolve(res)) as unknown as Fetch;

const clinic = (slug: string, host: string | null) => ({ org_id: slug, slug, name: slug, role_key: "doctor", role_name: "Doctor", host });
const fields: RegistrationFields = { name: "A", email: "a@b.in", phone: "1", role: "Doctor", spec: "Orthodontics", clinic: "C", city: "Pune", lic: "" };

describe("decideDestination", () => {
  it("sends console users to the console", () => {
    expect(decideDestination({ clinics: [], console_access: true }, "https://c/").kind).toBe("console");
  });
  it("opens the only clinic, picks between several, and says when there is none", () => {
    expect(decideDestination({ clinics: [clinic("a", "a.x")] }, "").kind).toBe("clinic");
    expect(decideDestination({ clinics: [clinic("a", "a.x"), clinic("b", "b.x")] }, "").kind).toBe("picker");
    expect(decideDestination({ clinics: [clinic("a", null)] }, "").kind).toBe("none");
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
    expect(JSON.parse(String(vi.mocked(f).mock.calls[0]?.[1]?.body))).toEqual({ target_host: "a.x" });
    expect(handoffUrl("a.x", "abc 1")).toBe("https://a.x/auth/handoff#code=abc%201");
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
