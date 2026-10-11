import { describe, expect, it, vi } from "vitest";

import { ApiFailure, createDevTokenSource, createHttpClient, invoiceId, patientId, practitionerId, prescriptionId, queueTokenId, sessionId, unwrap, visitId } from "./index.js";

const REQUEST_ID = "0192f1c4-7a10-7c3e-9b2a-1d2e3f405162";

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "x-request-id": REQUEST_ID, ...headers },
  });
}

/** A fetch stub that records each call and answers with `response`. */
function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetchStub = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init });
    return typeof response === "function" ? response() : Promise.resolve(response);
  });
  return { calls, fetch: fetchStub };
}

const patientBody = {
  id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf2",
  row_version: 1,
  number: "SD-9",
  full_name: "Test Patient",
  sex: "female",
  date_of_birth: "1990-04-12",
  birth_date_estimated: false,
  phone: "+919876500000",
  email: null,
  preferred_language: "mr-IN",
  status: "active",
  created_at: "2026-10-01T04:30:00Z",
  recall_due: false,
};

const ID = queueTokenId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405163");
const PRACTITIONER = practitionerId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405164");

describe("createHttpClient Today requests", () => {
  it("sends the day, month, open-lab, call, practitioner and weeks parameters", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, {})));
    const client = createHttpClient("", () => "abc", { fetch });

    await client.getToday({ date: "2026-10-01" });
    await client.getMonthSummary("2026-10");
    await client.listOpenLabOrders();
    await client.callQueueToken(ID);
    await client.listQueue("2026-10-03", { practitionerId: PRACTITIONER });
    await client.getCollections({ weeks: 8 });

    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/today?date=2026-10-01",
      "/api/v1/appointments/month-summary?month=2026-10",
      "/api/v1/lab-orders?open=1",
      `/api/v1/queue/${ID}/call`,
      `/api/v1/queue?date=2026-10-03&practitioner_id=${PRACTITIONER}`,
      "/api/v1/reports/collections?weeks=8",
    ]);
    expect(calls[3]?.init?.method).toBe("POST");
  });
});

describe("createHttpClient errors", () => {
  it("reads the API error, takes the field from the message and keeps the x-request-id header", async () => {
    const { fetch } = stubFetch(json(400, { error: { code: "invalid_request", message: "phone: invalid phone number: too short" } }));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });

    const result = await client.createPatient({ full_name: "Test Patient", sex: "female", phone: "+91123" });

    expect(result).toEqual({
      ok: false,
      error: { status: 400, code: "invalid_request", message: "Invalid phone number: too short", field: "phone", requestId: REQUEST_ID },
    });
  });

  it("leaves messages without a field prefix alone", async () => {
    const { fetch } = stubFetch(json(409, { error: { code: "conflict", message: "that subdomain is taken" } }));
    const result = await createHttpClient("", () => "token", { fetch }).createClinic({ name: "Sunrise", owner_email: "a@example.com" });
    expect(result.ok ? null : [result.error.field, result.error.message]).toEqual([undefined, "that subdomain is taken"]);
  });

  it("falls back to a safe message when the body is not the API's, without echoing it", async () => {
    const { fetch } = stubFetch(
      new Response("<html>Bad gateway: upstream said Test Patient</html>", { status: 502, headers: { "x-request-id": REQUEST_ID } }),
    );
    const client = createHttpClient("", () => null, { fetch });

    const result = await client.getSession();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unexpected_status");
      expect(result.error.status).toBe(502);
      expect(result.error.requestId).toBe(REQUEST_ID);
      expect(result.error.message).not.toContain("Test Patient");
    }
  });

  it("rejects a success body that doesn't match the contract, without quoting it", async () => {
    const { fetch } = stubFetch(json(200, { ...patientBody, sex: "mystery" }));
    const client = createHttpClient("", () => null, { fetch });

    const result = await client.getPatient(patientId.parse("01a103b1-ea26-7120-ad93-41b6b4b4ebf2"));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_response");
      expect(result.error.requestId).toBe(REQUEST_ID);
      expect(result.error.message).not.toContain("mystery");
    }
  });

  it("reports a network failure and a cancelled request differently", async () => {
    const offline = createHttpClient("", () => null, {
      fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    const offlineResult = await offline.getMe();
    expect(offlineResult.ok ? null : offlineResult.error.code).toBe("network_error");

    const controller = new AbortController();
    controller.abort();
    const cancelled = createHttpClient("", () => null, {
      fetch: () => Promise.reject(new DOMException("aborted", "AbortError")),
    });
    const cancelledResult = await cancelled.getMe({ signal: controller.signal });
    expect(cancelledResult.ok ? null : cancelledResult.error.code).toBe("aborted");
  });

  it("unwrap throws an ApiFailure that carries the error value", async () => {
    const { fetch } = stubFetch(json(403, { error: { code: "forbidden", message: "You don't have permission to do that." } }));
    const client = createHttpClient("", () => "token", { fetch });

    const failure = await unwrap(client.listPatients()).catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure instanceof ApiFailure ? failure.error.code : null).toBe("forbidden");
  });
});

describe("createHttpClient requests", () => {
  it("reads the UPI link of a bill from its own path and checks the body against the contract", async () => {
    const body = { uri: "upi://pay?pa=a@b", qr_data: "upi://pay?pa=a@b", upi_id: "a@b", payee_name: "Sunrise Dental", invoice_number: "INV-1", amount_paise: 50000 };
    const { fetch, calls } = stubFetch(json(200, body));
    const client = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch });

    const result = await client.getInvoiceUpiLink(invoiceId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405170"));

    expect(calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/invoices/0192f1c4-7a10-7c3e-9b2a-1d2e3f405170/upi-link");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(result.ok && result.value.amount_paise).toBe(50000);
    const bad = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stubFetch(json(200, { uri: 1 })).fetch });
    expect((await bad.getInvoiceUpiLink(invoiceId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405170"))).ok).toBe(false);
  });

  it("searches with a POST body, so the search term never appears in a URL", async () => {
    const { fetch, calls } = stubFetch(json(200, { items: [] }));
    const client = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch });

    await client.searchPatients({ q: "  Ananya Gupta ", limit: 20 });

    const call = calls[0];
    expect(call?.url).toBe("http://sunrise.localtest.me/api/v1/patients/search");
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.body).toBe(JSON.stringify({ q: "Ananya Gupta", limit: 20 }));
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer abc");
    expect(headers.get("accept")).toBe("application/json");
    expect(call?.init?.cache).toBe("no-store");
  });

  it("sends the list filters as flags and the search filters in the body", async () => {
    const { fetch, calls } = stubFetch(json(200, { items: [] }));
    const client = createHttpClient("", () => "abc", { fetch });

    await client.listPatients({ withBalance: true, newThisMonth: true });
    await client.searchPatients({ q: "Ananya", recallsDue: true });

    expect(calls[0]?.url).toBe("/api/v1/patients?with_balance=true&new_this_month=true");
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ q: "Ananya", recalls_due: true }));
  });

  it("patches a plan item's status", async () => {
    const { fetch, calls } = stubFetch(json(404, { error: { code: "not_found", message: "Not found." } }));
    await createHttpClient("", () => "abc", { fetch }).setPlanItemStatus("item-1", "done");
    expect(calls[0]?.url).toBe("/api/v1/treatment-plan-items/item-1");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ status: "done" }));
  });

  it("sends no authorization header when signed out", async () => {
    const { fetch, calls } = stubFetch(json(200, { items: [] }));
    await createHttpClient("", () => null, { fetch }).listPatients();
    expect(calls[0]?.url).toBe("/api/v1/patients");
    expect(new Headers(calls[0]?.init?.headers).has("authorization")).toBe(false);
  });

  it("posts JSON and decodes the created record into typed values", async () => {
    const { fetch, calls } = stubFetch(json(201, patientBody));
    const client = createHttpClient("", () => "token", { fetch });

    const result = await client.createPatient({ full_name: "Test Patient", sex: "female" });

    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ full_name: "Test Patient", sex: "female" }));
    expect(result.ok && result.value.number).toBe("SD-9");
  });

  it("decodes a started visit, whose clinician is a member reference, not a staff member", async () => {
    const body = {
      id: "01a103b1-ea26-7120-ad93-41b6b4b4ec01",
      number: "V-1",
      patient_id: patientBody.id,
      clinician: { id: "01a103b1-ea26-7120-ad93-41b6b4b4ec02", name: "Dr Test" },
      chief_complaint: null,
      status: "open",
      started_at: "2026-10-01T04:30:00Z",
    };
    const { fetch } = stubFetch(json(201, body));
    const client = createHttpClient("", () => "token", { fetch });

    const result = await client.startVisit(patientId.parse(patientBody.id), {});

    expect(result.ok && result.value.clinician.name).toBe("Dr Test");
  });

  it("edits a patient with PATCH", async () => {
    const { fetch, calls } = stubFetch(json(200, patientBody));
    const client = createHttpClient("", () => "token", { fetch });

    await client.updatePatient(patientId.parse(patientBody.id), { full_name: "Renamed" });

    expect(calls[0]?.url).toBe(`/api/v1/patients/${patientBody.id}`);
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ full_name: "Renamed" }));
  });

  it("revokes a session with no request body, decoding the empty response", async () => {
    const { fetch, calls } = stubFetch(new Response(null, { status: 204, headers: { "x-request-id": REQUEST_ID } }));
    const client = createHttpClient("", () => "token", { fetch });

    const result = await client.revokeMySession(sessionId.parse("sess_1"));

    expect(calls[0]?.url).toBe("/api/v1/me/sessions/sess_1/revoke");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBeUndefined();
    expect(result.ok).toBe(true);
  });
});

describe("createDevTokenSource", () => {
  it("trades an auth_uid for a token once, then serves it from cache", async () => {
    const { fetch, calls } = stubFetch(json(200, { access_token: "dev-jwt", expires_in: 3600 }));
    const tokenFor = createDevTokenSource("http://localhost:8080/", { fetch });

    const person = { id: "a1a1a1a1-0000-4000-8000-000000000003" };
    expect(await tokenFor(person)).toBe("dev-jwt");
    expect(await tokenFor(person)).toBe("dev-jwt");

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:8080/api/v1/dev/token");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ auth_uid: "a1a1a1a1-0000-4000-8000-000000000003" }));
  });

  it("puts a new person's email in the token request, for accepting an invitation", async () => {
    const { fetch, calls } = stubFetch(json(200, { access_token: "dev-jwt", expires_in: 3600 }));
    await createDevTokenSource("", { fetch })({ id: "d1d1d1d1-0000-4000-8000-000000000009", email: "new@example.com" });
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ auth_uid: "d1d1d1d1-0000-4000-8000-000000000009", email: "new@example.com" }));
  });

  it("gives no token when the API refuses", async () => {
    const { fetch } = stubFetch(json(404, { error: { code: "not_found", message: "Not found." } }));
    expect(await createDevTokenSource("", { fetch })({ id: "x" })).toBeNull();
  });
});

describe("createHttpClient dashboard layout", () => {
  const catalogue = {
    version: 2,
    templates: [{ key: "medsync", label: "MedSync", description: "d", layout: { v: 2, tpl: "medsync", density: "cozy", card: "soft", rail: { side: "right", width: "medium" }, items: [{ key: "kpis", zone: "top", size: "full", opts: { metrics: ["appointments", "completed", "waiting", "collected"] } }] } }],
    widgets: [
      {
        key: "kpis",
        label: "Key numbers",
        description: "d",
        zones: ["top", "main"],
        sizes: ["L", "full"],
        default_zone: "top",
        default_size: "full",
        requires: null,
        options: [{ key: "metrics", label: "Numbers", kind: "metrics", default: ["appointments", "completed", "waiting", "new_patients"], choices: null, min: 4, max: 6 }],
      },
      {
        key: "collections",
        label: "Collections",
        description: "d",
        zones: ["main"],
        sizes: ["M", "L", "full"],
        default_zone: "main",
        default_size: "L",
        requires: "finance.view",
        options: [{ key: "weeks", label: "Weeks", kind: "int_choice", default: 8, choices: [4, 8, 12], min: null, max: null }],
      },
    ],
    metrics: [{ key: "collected", label: "Collected", requires: "finance.view" }],
    densities: ["compact", "cozy"],
    cards: ["flat", "soft", "outline"],
    rail_sides: ["left", "right"],
    rail_widths: ["narrow", "medium", "wide"],
    zones: ["top", "main", "rail"],
    sizes: ["S", "M", "L", "full"],
  };
  const view = { layout: catalogue.templates[0]?.layout, source: "clinic", catalogue };

  it("decodes the layout with its catalogue and calls the member and clinic routes", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, view)));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    const mine = await unwrap(client.getMyDashboardLayout());
    expect(mine.source).toBe("clinic");
    expect(mine.catalogue.widgets[0]?.options[0]).toMatchObject({ kind: "metrics", min: 4, max: 6 });
    expect(mine.catalogue.widgets[1]?.options[0]?.choices).toEqual([4, 8, 12]);

    const layout = mine.layout;
    await unwrap(client.saveMyDashboardLayout(layout));
    await unwrap(client.resetMyDashboardLayout());
    await unwrap(client.getDashboardLayout());
    await unwrap(client.saveDashboardLayout(layout));
    await unwrap(client.resetDashboardLayout());
    expect(calls.map((c) => `${c.init?.method ?? ""} ${new URL(c.url).pathname}`)).toEqual([
      "GET /api/v1/me/dashboard-layout",
      "PUT /api/v1/me/dashboard-layout",
      "DELETE /api/v1/me/dashboard-layout",
      "GET /api/v1/settings/dashboard-layout",
      "PUT /api/v1/settings/dashboard-layout",
      "DELETE /api/v1/settings/dashboard-layout",
    ]);
    expect(calls[1]?.init?.body).toBe(JSON.stringify(layout));
  });

  it("reads a 400 as the registry's refusal, naming the place", async () => {
    const { fetch } = stubFetch(json(400, { error: { code: "invalid_layout", message: "items[2].opts.weeks: not one of the allowed numbers" } }));
    const client = createHttpClient("", () => "token", { fetch });
    const result = await client.saveMyDashboardLayout({ tpl: "medsync", density: "cozy", card: "soft", rail: { side: "right", width: "medium" }, items: [] });
    expect(result.ok ? null : [result.error.status, result.error.code, result.error.field]).toEqual([400, "invalid_layout", "items[2].opts.weeks"]);
  });
});

describe("createHttpClient visit wrap-up, share links and medicine sets", () => {
  const VISIT = "0192f1c4-7a10-7c3e-9b2a-1d2e3f405170";
  const summary = {
    id: VISIT,
    number: "V-1",
    patient_id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf2",
    clinician: { id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405171", name: "Dr Asha" },
    status: "closed",
    started_at: "2026-10-01T04:30:00Z",
    ended_at: "2026-10-01T05:00:00Z",
  };

  it("sends close, finish and share bodies and reads the follow-up and the draft bill", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, { ...summary, follow_up: null, invoice: null })));
    const client = createHttpClient("", () => "abc", { fetch });
    const closed = await unwrap(client.closeVisitWith(visitId.parse(VISIT), { follow_up_on: "2026-10-17", fee_paise: 50_000 }));
    expect(closed.status).toBe("closed");
    expect(closed.follow_up ?? null).toBeNull();
    expect(`${calls[0]?.init?.method ?? ""} ${calls[0]?.url ?? ""}`).toBe(`POST /api/v1/visits/${VISIT}/close`);
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ follow_up_on: "2026-10-17", fee_paise: 50_000 }));

    const finish = stubFetch(() =>
      Promise.resolve(json(200, { visit: summary, signed_note_ids: ["n1"], unsigned_note_ids: [] })),
    );
    const finished = await unwrap(createHttpClient("", () => "abc", { fetch: finish.fetch }).finishVisit(visitId.parse(VISIT)));
    expect(finished.signed_note_ids).toEqual(["n1"]);
    expect(finish.calls[0]?.url).toBe(`/api/v1/visits/${VISIT}/finish`);
    expect(finish.calls[0]?.init?.body).toBe("{}");
  });

  it("reads visit_closed and the allergy block as the API's errors", async () => {
    const closed = stubFetch(json(409, { error: { code: "visit_closed", message: "That visit is already closed." } }));
    const result = await createHttpClient("", () => "abc", { fetch: closed.fetch }).finishVisit(visitId.parse(VISIT));
    expect(result.ok ? null : [result.error.status, result.error.code]).toEqual([409, "visit_closed"]);
  });

  it("shares a prescription and a visit with an expiry and a channel, and opens a visit link", async () => {
    const link = { id: "l1", token: "t".repeat(43), pin: "123456", expires_at: "2026-10-02T04:30:00Z", channel: "qr" };
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(201, link)));
    const client = createHttpClient("", () => "abc", { fetch });
    expect((await unwrap(client.shareVisit(visitId.parse(VISIT), { expires_in_hours: 24, channel: "qr" }))).channel).toBe("qr");
    await unwrap(client.createShareLinkWith(prescriptionId.parse("rx1"), { expires_in_hours: 48, channel: "whatsapp" }));
    expect(calls.map((c) => `${c.init?.method ?? ""} ${c.url}`)).toEqual([`POST /api/v1/visits/${VISIT}/share`, "POST /api/v1/prescriptions/rx1/share"]);
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ expires_in_hours: 24, channel: "qr" }));

    const opened = stubFetch(() =>
      Promise.resolve(
        json(200, {
          clinic_name: "Sunrise Dental",
          patient_name: "Meera Iyer",
          visit_number: "V-1",
          visited_on: "2026-10-01",
          treatments: [{ name: "Scaling", tooth: 11 }],
          expires_at: "2026-10-02T04:30:00Z",
        }),
      ),
    );
    const clientOpen = createHttpClient("", () => null, { fetch: opened.fetch });
    expect((await unwrap(clientOpen.openSharedVisit("tok", "123456"))).treatments[0]?.name).toBe("Scaling");
    expect(opened.calls[0]?.url).toBe("/api/v1/shared/tok/visit");
    expect(opened.calls[0]?.init?.body).toBe(JSON.stringify({ pin: "123456" }));
  });

  it("reads a link from an older server that sends no channel", async () => {
    const old = stubFetch(json(201, { id: "l1", token: "t", pin: "123456", expires_at: "2026-10-02T04:30:00Z" }));
    expect((await unwrap(createHttpClient("", () => "abc", { fetch: old.fetch }).createShareLink(prescriptionId.parse("rx1")))).channel).toBe("link");
  });

  it("calls the medicine set routes", async () => {
    const set = {
      id: "s1",
      label: "Post extraction",
      items: [{ drug_name: "Amoxicillin", strength: "500 mg", form: "capsule", dose: "1 capsule", frequency: "1-1-1" }],
      created_at: "2026-10-01T04:30:00Z",
      updated_at: "2026-10-01T04:30:00Z",
    };
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, set)));
    const client = createHttpClient("", () => "abc", { fetch });
    const values = { label: set.label, items: set.items };
    await unwrap(client.createMedicineSet(values));
    await unwrap(client.updateMedicineSet("s1", values));
    expect(calls.map((c) => `${c.init?.method ?? ""} ${c.url}`)).toEqual(["POST /api/v1/medicine-sets", "PUT /api/v1/medicine-sets/s1"]);
    const list = stubFetch(() => Promise.resolve(json(200, { items: [set] })));
    expect((await unwrap(createHttpClient("", () => "abc", { fetch: list.fetch }).listMedicineSets())).items[0]?.label).toBe("Post extraction");
    const gone = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    const removed = await createHttpClient("", () => "abc", { fetch: gone.fetch }).deleteMedicineSet("s1");
    expect(removed.ok).toBe(true);
    expect(`${gone.calls[0]?.init?.method ?? ""} ${gone.calls[0]?.url ?? ""}`).toBe("DELETE /api/v1/medicine-sets/s1");
  });
});

describe("createHttpClient settings v2", () => {
  const prefs = {
    reminder_24h: true,
    reminder_2h: false,
    receipts: false,
    recall: true,
    low_stock: true,
    lab_due: true,
    quiet_hours: { enabled: true, start: "21:00", end: "09:00" },
  };
  const alert = {
    id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405170",
    kind: "payment_due",
    created_at: "2026-10-10T05:30:00Z",
    read: false,
    read_at: null,
    handled: null,
    reminded_at: null,
    escalated_at: null,
    appointment: null,
    lab_order: null,
    href: "/billing/invoices/0192f1c4-7a10-7c3e-9b2a-1d2e3f405171",
    queue_token: null,
    invoice: { id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405171", number: "AD/26-27/000001" },
    recall: null,
  };

  it("decodes the profile, other-session sign-out and notification switches, on the routes the API serves", async () => {
    const bodies = [
      json(200, { display_name: "Asha Rao", phone: "+919876543210" }),
      json(200, { revoked: 2 }),
      json(200, prefs),
      json(200, { ...prefs, receipts: true }),
    ];
    const { calls, fetch } = stubFetch(() => Promise.resolve(bodies.shift() ?? json(500, {})));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    const me = await unwrap(client.updateMe({ display_name: "Asha Rao", phone: "98765 43210" }));
    expect(me).toEqual({ display_name: "Asha Rao", phone: "+919876543210" });
    expect((await unwrap(client.revokeOtherSessions())).revoked).toBe(2);
    expect((await unwrap(client.getNotificationSettings())).quiet_hours).toEqual({ enabled: true, start: "21:00", end: "09:00" });
    expect((await unwrap(client.updateNotificationSettings({ receipts: true }))).receipts).toBe(true);
    expect(calls.map((c) => `${c.init?.method ?? ""} ${new URL(c.url).pathname}`)).toEqual([
      "PATCH /api/v1/me",
      "POST /api/v1/me/sessions/revoke-others",
      "GET /api/v1/settings/notifications",
      "PATCH /api/v1/settings/notifications",
    ]);
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ display_name: "Asha Rao", phone: "98765 43210" }));
    expect(calls[3]?.init?.body).toBe(JSON.stringify({ receipts: true }));
  });

  it("reads the notification feed with its links, and the bell's calls", async () => {
    const bodies = [json(200, { items: [alert] }), json(200, { unread: 3 }), new Response(null, { status: 204 }), json(200, { marked: 2 })];
    const { calls, fetch } = stubFetch(() => Promise.resolve(bodies.shift() ?? json(500, {})));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    const feed = await unwrap(client.listNotifications({ unreadOnly: true, limit: 20 }));
    expect(feed.items[0]).toMatchObject({ kind: "payment_due", href: alert.href, invoice: { number: "AD/26-27/000001" } });
    expect((await unwrap(client.countUnreadNotifications())).unread).toBe(3);
    await unwrap(client.markNotificationRead(alert.id));
    expect((await unwrap(client.markAllNotificationsRead())).marked).toBe(2);
    expect(calls.map((c) => `${c.init?.method ?? ""} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      "GET /api/v1/notifications?unread_only=true&limit=20",
      "GET /api/v1/notifications/count",
      `POST /api/v1/notifications/${alert.id}/read`,
      "POST /api/v1/notifications/read-all",
    ]);
  });

  it("posts the logo as a form to the clinic logo route and decodes the settings, with branding mode auto and the default visit length", async () => {
    const settings = {
      name: "Sunrise Dental",
      specialty: "dental",
      legal_name: null,
      gstin: null,
      timezone: "Asia/Kolkata",
      branding: { brand: "#0F766E", mode: "auto" },
      prescription_footer: null,
      address: { line1: null, line2: null, city: null, state: null, pincode: null },
      phone: null,
      upi_id: null,
      online_booking: {
        enabled: true,
        slot_minutes: 15,
        buffer_minutes: 0,
        auto_confirm: false,
        horizon_days: 30,
        min_notice_minutes: 60,
        reminder_minutes: 15,
        default_visit_minutes: 45,
      },
      letterhead: {
        mode: "template",
        template: "classic",
        accent: null,
        show: { logo: true, doctors: true, registration: true, address: true, phone: true, email: true, timings: true, gstin: false },
        local_name: null,
        footer: null,
        email: null,
        timings: null,
        doctor_ids: [],
        has_image: false,
        has_logo: true,
      },
    };
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, settings)));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    const form = new FormData();
    form.set("file", new Blob(["x"], { type: "image/png" }), "logo.png");
    const saved = await unwrap(client.uploadClinicLogo(form));
    expect(saved.letterhead.has_logo).toBe(true);
    expect(saved.branding.mode).toBe("auto");
    expect(saved.online_booking.default_visit_minutes).toBe(45);
    expect(`${calls[0]?.init?.method ?? ""} ${new URL(calls[0]?.url ?? "").pathname}`).toBe("POST /api/v1/settings/clinic/logo");
    expect(calls[0]?.init?.body).toBe(form);
  });

  it("reads a 400 from the profile as the field's refusal and a 409 as a conflict", async () => {
    const bad = stubFetch(json(400, { error: { code: "invalid_input", message: "phone: is not a valid phone number" } }));
    const result = await createHttpClient("", () => "token", { fetch: bad.fetch }).updateMe({ phone: "12" });
    expect(result.ok ? null : [result.error.status, result.error.field]).toEqual([400, "phone"]);
    const taken = stubFetch(json(409, { error: { code: "conflict", message: "that phone number belongs to another account" } }));
    const conflict = await createHttpClient("", () => "token", { fetch: taken.fetch }).updateMe({ phone: "9876543210" });
    expect(conflict.ok ? null : conflict.error.status).toBe(409);
  });
});
