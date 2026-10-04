/**
 * End-to-end smoke test against the running API through both dev servers, using the apps' own
 * client and decoders. Skipped unless VITE_LIVE=1; it writes one patient and one clinic.
 *
 *   VITE_API_MODE=http pnpm dev:portal & VITE_API_MODE=http pnpm dev:console &
 *   VITE_LIVE=1 pnpm vitest run --project portal live
 */

import { describe, expect, it } from "vitest";

import { createDevTokenSource, createHttpClient, type ApiResult } from "@aarogyam/api-client";

const PORTAL = "http://sunrise.localtest.me:5173";
const NEUTRAL = "http://app.localtest.me:5173";
const CONSOLE = "http://console.localtest.me:5174";

function value<T>(result: ApiResult<T>): T {
  if (!result.ok) {
    throw new Error(`${result.error.code} (${String(result.error.status)}): ${result.error.message} [${result.error.requestId ?? "no id"}]`);
  }
  return result.value;
}

const as = (origin: string, person: { id: string; email?: string }) => {
  const token = createDevTokenSource(origin);
  return createHttpClient(origin, () => token(person));
};

describe.skipIf(import.meta.env["VITE_LIVE"] !== "1")("live: portal and console against the running API", () => {
  it("portal: Farah signs in, opens Sunrise Dental, lists, searches, opens and registers patients", async () => {
    const api = as(PORTAL, { id: "a1a1a1a1-0000-4000-8000-000000000003" });
    const me = value(await api.getMe());
    expect(me.clinics.map((c) => c.host)).toContain("sunrise.localtest.me");
    const session = value(await api.getSession());
    expect(session.clinic.name).toBe("Sunrise Dental");
    expect(session.user.display_name).toBe("Farah Shaikh");

    const recent = value(await api.listPatients()).items;
    expect(recent.length).toBeGreaterThan(0);
    const first = recent[0];
    const name = first?.full_name.split(" ")[0] ?? "";
    expect(value(await api.searchPatients({ q: name, limit: 10 })).items.map((p) => p.id)).toContain(first?.id);
    if (first !== undefined) {
      expect(value(await api.getPatient(first.id)).number).toBe(first.number);
    }

    const bad = await api.createPatient({ full_name: "Synthetic Check", sex: "unknown", phone: "+91123" });
    expect(bad.ok ? null : bad.error.field).toBe("phone");
    const created = value(await api.createPatient({ full_name: "Synthetic Check", sex: "unknown", age_years: 30 }));
    expect(created.number).toMatch(/^SD-\d+$/);
    expect(created.birth_date_estimated).toBe(true);
  });

  it("portal: a member of another clinic gets 404 on Sunrise's host", async () => {
    const bina = as(PORTAL, { id: "b1b1b1b1-0000-4000-8000-000000000001" });
    const result = await bina.getSession();
    expect(result.ok ? 200 : result.error.status).toBe(404);
  });

  it("console: the admin sees clinics and service health, creates a clinic, and its owner joins", async () => {
    const admin = as(CONSOLE, { id: "c1c1c1c1-0000-4000-8000-000000000001" });
    const clinics = value(await admin.listClinics()).items;
    expect(clinics.map((c) => c.slug)).toEqual(expect.arrayContaining(["sunrise", "lotus"]));
    const metrics = value(await admin.getMetrics("1h"));
    expect(metrics.api.requests).toBeGreaterThan(0);
    expect(metrics.db.connections_max).toBeGreaterThan(0);

    const slug = `check-${crypto.randomUUID().slice(0, 8)}`;
    const email = `${slug}@example.com`;
    const createdClinic = value(await admin.createClinic({ name: "Live Check Dental", slug, specialty: "dental", owner_email: email }));
    expect(createdClinic.portal_host).toBe(`${slug}.localtest.me`);

    const owner = { id: crypto.randomUUID(), email };
    const stranger = as(NEUTRAL, { id: crypto.randomUUID(), email: "someone-else@example.com" });
    const wrongEmail = await stranger.acceptInvitation({ token: createdClinic.invite_token });
    expect(wrongEmail.ok ? 200 : wrongEmail.error.status).toBe(409);

    const joined = value(await as(NEUTRAL, owner).acceptInvitation({ token: createdClinic.invite_token, display_name: "Live Check Owner" }));
    expect(joined.org_id).toBe(createdClinic.id);
    const onClinicHost = as(`http://${createdClinic.portal_host}:5173`, owner);
    const session = value(await onClinicHost.getSession());
    expect(session.membership.role_key).toBe("owner");
    const again = await as(NEUTRAL, owner).acceptInvitation({ token: createdClinic.invite_token });
    expect(again.ok ? 200 : again.error.status).toBe(404);
  });
});
