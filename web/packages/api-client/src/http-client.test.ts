import { describe, expect, it, vi } from "vitest";

import { createFakeBackend, createFixtures, fakeTokenFor } from "./fake/index.js";
import { ApiFailure, appointmentId, importSessionId, createDevTokenSource, createHttpClient, expenseId, inventoryItemId, invoiceId, patientId, practitionerId, prescriptionId, purchaseOrderId, queueTokenId, recurringExpenseId, sessionId, taskId, taskOccurrenceId, unwrap, visitId } from "./index.js";

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
  allergy_alert: false,
  consent_pending: false,
  has_photo: false,
  balance_paise: null,
  lifetime_paid_paise: null,
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
    await client.listMissedAppointments("2026-10-03");
    await client.listQueueToCollect();

    expect(calls.map((c) => c.url)).toEqual([
      "/api/v1/today?date=2026-10-01",
      "/api/v1/appointments/month-summary?month=2026-10",
      "/api/v1/lab-orders?open=1",
      `/api/v1/queue/${ID}/call`,
      `/api/v1/queue?date=2026-10-03&practitioner_id=${PRACTITIONER}`,
      "/api/v1/reports/collections?weeks=8",
      "/api/v1/appointments/missed?date=2026-10-03",
      "/api/v1/queue/to-collect",
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

  it("reads a queue token whose automatic-message status is null or absent", async () => {
    const token = {
      id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405163",
      branch_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405165",
      day: "2026-10-03",
      token_number: 4,
      patient: { id: patientBody.id, number: "SD-9", full_name: "Test Patient", sex: "female" },
      status: "waiting",
      issued_at: "2026-10-03T05:30:00Z",
      wait_minutes: 3,
    };
    const { fetch } = stubFetch(json(200, { date: "2026-10-03", items: [{ ...token, welcome_status: null, thanks_status: null }, token] }));
    const client = createHttpClient("", () => null, { fetch });

    const result = await client.listQueue("2026-10-03");

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toHaveLength(2);
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
  it("reads the staff member's support grants from the console path and checks the body against the contract", async () => {
    const item = {
      id: "g1",
      access: "read",
      clinic_id: "c1",
      clinic_name: "Sunrise Dental",
      slug: "sunrise",
      portal_host: "sunrise.localtest.me",
      reason: "Synthetic reason",
      starts_at: "2026-10-03T04:00:00Z",
      ends_at: "2026-10-03T08:00:00Z",
      status: "active",
      granted_by: "Asha Kulkarni",
    };
    const { fetch, calls } = stubFetch(json(200, { items: [item] }));
    const result = await createHttpClient("http://console.localtest.me/", () => Promise.resolve("abc"), { fetch }).listMySupportGrants();

    expect(calls[0]?.url).toBe("http://console.localtest.me/api/v1/console/support-grants");
    expect(calls[0]?.init?.method).toBe("GET");
    expect(result.ok && result.value.items[0]?.clinic_name).toBe("Sunrise Dental");
    const bad = createHttpClient("", () => null, { fetch: stubFetch(json(200, { items: [{ ...item, ends_at: 5 }] })).fetch });
    expect((await bad.listMySupportGrants()).ok).toBe(false);
  });

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

  it("checks a patient in, lists and dismisses duplicates and merges on their own paths, checking each body against the contract", async () => {
    const fixtures = createFixtures({ now: new Date("2026-10-03T05:30:00Z") });
    const fake = createFakeBackend(fixtures).client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: "a1a1a1a1-0000-4000-8000-000000000003" }), now: () => new Date("2026-10-03T05:30:00Z") });
    const appointment = (await unwrap(fake.listAppointments({ from: "2026-01-01", to: "2026-12-31" }))).items[0];
    const checked = { appointment, allergies_recorded: 1, consents_recorded: ["care"], queue_token_id: "tok-1" };
    const make = (response: Response) => {
      const stub = stubFetch(response);
      return { stub, client: createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stub.fetch }) };
    };
    const id = appointmentId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405170");
    const checkIn = make(json(200, checked));
    const result = await checkIn.client.checkInAppointment(id, { sex: "female", age_years: 31, no_known_allergies: true });
    expect(checkIn.stub.calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/appointments/0192f1c4-7a10-7c3e-9b2a-1d2e3f405170/check-in");
    expect(checkIn.stub.calls[0]?.init?.method).toBe("POST");
    expect(checkIn.stub.calls[0]?.init?.body).toBe(JSON.stringify({ sex: "female", age_years: 31, no_known_allergies: true }));
    expect(result.ok && result.value.consents_recorded).toEqual(["care"]);
    expect((await make(json(200, { ...checked, consents_recorded: 3 })).client.checkInAppointment(id, {})).ok).toBe(false);

    const side = (n: string) => ({ id: `01a103b1-ea26-7120-ad93-41b6b4b4eb0${n}`, number: `SD-${n}`, full_name: "Test Person", sex: "unknown" });
    const flag = { id: "flag-1", reason: "phone", flagged_at: "2026-10-03T04:00:00Z", patient: side("1"), candidate: side("2") };
    const list = make(json(200, { items: [flag] }));
    const listed = await list.client.listPatientDuplicates();
    expect(list.stub.calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/patient-duplicates");
    expect(listed.ok && listed.value.items[0]?.candidate.number).toBe("SD-2");
    expect((await make(json(200, { items: [{ ...flag, patient: { id: 1 } }] })).client.listPatientDuplicates()).ok).toBe(false);

    const dismiss = make(new Response(null, { status: 204 }));
    expect((await dismiss.client.dismissPatientDuplicate("flag-1")).ok).toBe(true);
    expect(dismiss.stub.calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/patient-duplicates/flag-1/dismiss");
    expect(dismiss.stub.calls[0]?.init?.method).toBe("POST");

    const merge = make(json(200, { patient_id: side("2").id, appointments_moved: 2 }));
    const into = patientId.parse(side("2").id);
    const merged = await merge.client.mergePatient(patientId.parse(side("1").id), { into_patient_id: into });
    expect(merge.stub.calls[0]?.url).toBe(`http://sunrise.localtest.me/api/v1/patients/${side("1").id}/merge`);
    expect(merge.stub.calls[0]?.init?.body).toBe(JSON.stringify({ into_patient_id: side("2").id }));
    expect(merged.ok && merged.value.appointments_moved).toBe(2);
  });

  it("reads patient_overlaps on booking and on move, and accepts a warning code it doesn't know (a stale tab must not refuse a saved booking)", async () => {
    const fixtures = createFixtures({ now: new Date("2026-10-03T05:30:00Z") });
    const fake = createFakeBackend(fixtures).client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: "a1a1a1a1-0000-4000-8000-000000000003" }), now: () => new Date("2026-10-03T05:30:00Z") });
    const appointment = (await unwrap(fake.listAppointments({ from: "2026-01-01", to: "2026-12-31" }))).items[0];
    const make = (response: Response) => createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stubFetch(response).fetch });
    const input = { patient_id: patientId.parse("01a103b1-ea26-7120-ad93-41b6b4b4ebf2"), practitioner_id: practitionerId.parse("01a103b1-ea26-7120-ad93-41b6b4b4ebf3"), starts_at: "2026-10-05T04:30:00Z" };
    const overlap = { appointment_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405170", starts_at: "2026-10-05T04:30:00Z", ends_at: "2026-10-05T05:00:00Z", practitioner_name: "Dr Dev", room_name: "Chair 2" };
    const clash = await make(json(201, { appointment, warnings: [], patient_overlaps: [overlap] })).bookAppointment(input);
    expect(clash.ok && clash.value.patient_overlaps?.[0]?.room_name).toBe("Chair 2");
    const noRoom = await make(json(201, { appointment, warnings: [], patient_overlaps: [{ ...overlap, room_name: null }] })).bookAppointment(input);
    expect(noRoom.ok).toBe(true);
    const clean = await make(json(201, { appointment, warnings: [] })).bookAppointment(input);
    expect(clean.ok && clean.value.patient_overlaps).toBeUndefined();
    const moved = await make(json(200, { appointment, patient_overlaps: [overlap] })).moveAppointment(appointmentId.parse(appointment?.id), { starts_at: "2026-10-05T04:30:00Z" });
    expect(moved.ok && moved.value.patient_overlaps?.length).toBe(1);
    // A newer server may add a warning code; the booking was saved, so the answer must still parse.
    const future = await make(json(201, { appointment, warnings: [{ code: "some_future_code", message: "Something new." }], extra_key: 1 })).bookAppointment(input);
    expect(future.ok && future.value.warnings[0]?.code).toBe("some_future_code");
    expect((await make(json(201, { appointment, warnings: [{ code: 5, message: "x" }] })).bookAppointment(input)).ok).toBe(false);
  });

  it("sends purchase orders and the stock import to their own paths and checks each body against the contract", async () => {
    const order = {
      id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405180",
      number: "PO-1",
      supplier_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405181",
      supplier_name: "Depot",
      status: "draft",
      expected_on: null,
      notes: null,
      ordered_at: null,
      received_at: null,
      cancelled_at: null,
      created_at: "2026-10-01T04:30:00Z",
      total_paise: 45000,
      lines: [{ id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405182", line_no: 1, item_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405183", item_name: "Gloves", unit: "box", quantity: 10, received_quantity: 0, unit_cost_paise: 4500 }],
      receipts: [],
    };
    const { fetch, calls } = stubFetch(() => Promise.resolve(json(200, order)));
    const client = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch });
    const id = purchaseOrderId.parse(order.id);

    const made = await client.createPurchaseOrder({ supplier_id: order.supplier_id, lines: [{ item_id: order.lines[0]?.item_id ?? "", quantity: 10, unit_cost_paise: 4500 }] });
    await client.updatePurchaseOrder(id, { status: "ordered" });
    await client.receivePurchaseOrder(id, {});
    await client.listPurchaseOrders({ status: "ordered" });
    await client.getPurchaseOrder(id);

    expect(made.ok && made.value.total_paise).toBe(45000);
    expect(calls.map((c) => `${c.init?.method ?? ""} ${c.url.replace("http://sunrise.localtest.me", "")}`)).toEqual([
      "POST /api/v1/purchase-orders",
      `PATCH /api/v1/purchase-orders/${order.id}`,
      `POST /api/v1/purchase-orders/${order.id}/receive`,
      "GET /api/v1/purchase-orders?status=ordered",
      `GET /api/v1/purchase-orders/${order.id}`,
    ]);
    expect(calls[0]?.init?.body).toContain('"quantity":10');
    const bad = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stubFetch(json(200, { ...order, status: "lost" })).fetch });
    expect((await bad.getPurchaseOrder(id)).ok).toBe(false);

    const preview = { token: "t0k3n", file_name: "stock.csv", row_count: 2, valid_rows: 1, error_rows: 1, errors: [{ row: 3, field: "name", message: "is required" }], rows: [{ row: 2, name: "Gloves", quantity: 5, new_item: true }], new_items: 1, warnings: [], expires_at: "2026-10-02T04:30:00Z" };
    const importing = stubFetch(json(201, preview));
    const importer = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: importing.fetch });
    const form = new FormData();
    form.set("file", new File(["name,qty\nGloves,5\n"], "stock.csv"));
    const shown = await importer.previewStockImport(form);
    expect(importing.calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/stock/import");
    expect(importing.calls[0]?.init?.body).toBe(form);
    expect(shown.ok && shown.value.errors[0]?.field).toBe("name");

    const committing = stubFetch(json(200, { items_created: 1, items_updated: 0, batches_received: 1, units_received: 5, skipped: [], replayed: false }));
    const committer = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: committing.fetch });
    const done = await committer.commitStockImport({ token: "t0k3n" });
    expect(committing.calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/stock/import/commit");
    expect(committing.calls[0]?.init?.body).toBe(JSON.stringify({ token: "t0k3n" }));
    expect(done.ok && done.value.replayed).toBe(false);
  });

  it("reads the collect summary of a bill from its own path, with the UPI link optional, and checks the body", async () => {
    const id = invoiceId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405170");
    const upi = { uri: "upi://pay?pa=a@b", qr_data: "upi://pay?pa=a@b", upi_id: "a@b", payee_name: "Sunrise Dental" };
    const patient = { id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405180", name: "Neha Rao", number: "SD-1042" };
    const full = { invoice_id: id, number: "INV-1", patient, status: "issued", total_paise: 50000, balance_paise: 30000, upi };
    const { fetch, calls } = stubFetch(json(200, full));
    const client = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch });

    const result = await client.getInvoiceCollectSummary(id);

    expect(calls[0]?.url).toBe(`http://sunrise.localtest.me/api/v1/invoices/${id}/collect-summary`);
    expect(calls[0]?.init?.method).toBe("GET");
    expect(result.ok && [result.value.number, result.value.balance_paise, result.value.upi?.upi_id]).toEqual(["INV-1", 30000, "a@b"]);
    const bare = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), {
      fetch: stubFetch(json(200, { invoice_id: id, patient, status: "draft", total_paise: 50000, balance_paise: 50000 })).fetch,
    });
    expect((await bare.getInvoiceCollectSummary(id)).ok).toBe(true);
    const bad = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stubFetch(json(200, { invoice_id: id })).fetch });
    expect((await bad.getInvoiceCollectSummary(id)).ok).toBe(false);
  });

  it("moves an appointment and reads and sets a doctor's conflict policy on their own paths", async () => {
    const make = (response: Response) => {
      const stub = stubFetch(response);
      return { stub, client: createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stub.fetch }) };
    };
    const policy = make(json(200, { policy: null, effective: "request" }));
    const read = await policy.client.getConflictPolicy(PRACTITIONER);
    expect(policy.stub.calls[0]?.url).toBe(`http://sunrise.localtest.me/api/v1/practitioners/${PRACTITIONER}/conflict-policy`);
    expect(read.ok && read.value.policy).toBeNull();
    const put = make(json(200, { policy: "strict", effective: "strict" }));
    await put.client.setConflictPolicy(PRACTITIONER, { policy: "strict" });
    expect(put.stub.calls[0]?.init?.method).toBe("PUT");
    expect(put.stub.calls[0]?.init?.body).toBe(JSON.stringify({ policy: "strict" }));
    expect((await make(json(200, { policy: "maybe", effective: "request" })).client.getConflictPolicy(PRACTITIONER)).ok).toBe(false);

    const moved = make(json(409, { error: { code: "slot_occupied", message: "Another appointment holds that time." } }));
    const result = await moved.client.moveAppointment(appointmentId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405170"), { starts_at: "2026-10-05T11:00:00+05:30" });
    expect(moved.stub.calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/appointments/0192f1c4-7a10-7c3e-9b2a-1d2e3f405170/move");
    expect(moved.stub.calls[0]?.init?.method).toBe("POST");
    expect(!result.ok && result.error.code).toBe("slot_occupied");
  });

  it("reads and finishes tasks on their own paths and checks the bodies against the contract", async () => {
    const occurrence = {
      id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405171",
      template_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405172",
      title: "Check photos",
      action: "confirm_photos",
      assignee_role_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405173",
      local_date: "2026-10-03",
      due_at: "2026-10-03T14:00:00Z",
      status: "open",
      patients_without_photos_today: 2,
    };
    const replies = [json(200, { date: "2026-10-03", items: [occurrence] }), json(200, { ...occurrence, status: "done", completed_at: "2026-10-03T14:05:00Z" }), json(200, { items: [{ local_date: "2026-10-04", due_at: "2026-10-04T14:00:00Z" }] })];
    const { fetch, calls } = stubFetch(() => Promise.resolve(replies.shift() ?? json(500, {})));
    const client = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch });

    const mine = await client.listMyTasks("2026-10-03");
    expect(calls[0]?.url).toBe("http://sunrise.localtest.me/api/v1/tasks/mine?date=2026-10-03");
    expect(mine.ok && mine.value.items[0]?.patients_without_photos_today).toBe(2);
    const done = await client.completeTask(taskOccurrenceId.parse(occurrence.id), { note: "ok", usage: [{ item_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405174", quantity: 2 }] });
    expect(calls[1]?.url).toBe(`http://sunrise.localtest.me/api/v1/tasks/occurrences/${occurrence.id}/complete`);
    expect(calls[1]?.init?.method).toBe("POST");
    expect(done.ok && done.value.status).toBe("done");
    const preview = await client.previewTask(taskId.parse(occurrence.template_id));
    expect(calls[2]?.url).toBe(`http://sunrise.localtest.me/api/v1/tasks/${occurrence.template_id}/preview`);
    expect(preview.ok && preview.value.items).toHaveLength(1);
    const bad = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stubFetch(json(200, { date: "2026-10-03", items: [{ ...occurrence, status: "gone" }] })).fetch });
    expect((await bad.listMyTasks()).ok).toBe(false);
  });

  it("reads console insights on their own paths and checks the bodies against the contract", async () => {
    const db = {
      generated_at: "2026-11-19T06:00:00Z",
      range: "24h",
      interval_seconds: 900,
      size_limit_bytes: 524_288_000,
      current: { connections_used: 3, connections_max: 60, cache_hit_ratio: 0.99, size_bytes: 1000, slow_queries: [], tables: [] },
      samples: [
        { at: "2026-11-19T05:45:00Z", connections: 3, max_connections: 60, cache_hit_ratio: 0.99, db_bytes: 1000, commits_per_min: null, rollbacks_per_min: null, rows_read_per_min: null, rows_written_per_min: null, deadlocks: 0, temp_bytes: 0 },
      ],
    };
    const timings = { arrive_to_seat_minutes: null, seat_to_start_minutes: null, visit_minutes: 24.5, end_to_paid_minutes: null, booking_lead_days: null };
    const usage = {
      generated_at: "2026-11-19T06:00:00Z",
      range: "7d",
      from: "2026-11-12",
      to: "2026-11-19",
      days: [{ day: "2026-11-18", clinics: 2, visits: 12, booked: 14, no_shows: 1, active_staff: 6, timings }],
      clinics: [{ org_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405180", slug: "sunrise", name: "Sunrise", days: 1, visits: 12, booked: 14, no_shows: 1, active_staff: 6, timings, roles: [{ role_key: "doctor", members: 3 }] }],
      roles: [{ day: "2026-11-18", role_key: "doctor", members: 3, clinics: 1 }],
      onboarding: [{ org_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405180", slug: "sunrise", name: "Sunrise", status: "trial", created_at: "2026-11-01T04:00:00Z", owner_joined_at: null, setup_steps_done: 0, setup_completed_at: null, first_patient_at: null, first_visit_at: null, first_bill_at: null, first_busy_week: null }],
    };
    const replies = [json(200, db), json(200, usage), json(200, { ...usage, days: [{ ...usage.days[0], visits: -1 }] })];
    const { fetch, calls } = stubFetch(() => Promise.resolve(replies.shift() ?? json(500, {})));
    const client = createHttpClient("http://console.localtest.me/", () => Promise.resolve("abc"), { fetch });

    const history = await client.getDbInsights("24h");
    expect(calls[0]?.url).toBe("http://console.localtest.me/api/v1/console/insights/db?range=24h");
    expect(history.ok && history.value.samples[0]?.commits_per_min).toBeNull();
    const used = await client.getUsageInsights("7d");
    expect(calls[1]?.url).toBe("http://console.localtest.me/api/v1/console/insights/usage?range=7d");
    expect(used.ok && used.value.clinics[0]?.timings.visit_minutes).toBe(24.5);
    expect((await client.getUsageInsights("7d")).ok).toBe(false);
  });

  it("reads routes, front-end and page insights on their own paths and checks the bodies", async () => {
    const routes = {
      generated_at: "2026-11-19T06:00:00Z",
      range: "24h",
      since: "2026-11-18T06:00:00Z",
      routes: [{ method: "GET", route: "/api/v1/patients/{id}", requests: 20, errors_4xx: 2, errors_5xx: 0, errors_429: 0, error_rate: 0, p50_ms: 4.2, p95_ms: 10_000 }],
    };
    const front = {
      generated_at: "2026-11-19T06:00:00Z",
      range: "7d",
      from: "2026-11-13",
      to: "2026-11-19",
      thresholds: [{ vital: "lcp", good: 2500, poor: 4000, unit: "ms" }],
      vitals: [{ app: "portal", route: "/today", vital: "lcp", samples: 6, p75: 3250, rating: "needs_work", good: 4, needs_work: 1, poor: 1 }],
      errors: [{ app: "portal", route: "/today", class: "chunk_load", count: 1 }],
    };
    const pages = {
      generated_at: "2026-11-19T06:00:00Z",
      range: "7d",
      from: "2026-11-13",
      to: "2026-11-19",
      pages: [{ app: "portal", route: "/queue", views: 2, visible_ms: null, avg_visible_ms: null }],
      roles: [{ app: "portal", role_key: "owner", views: 10, visible_ms: 83_000 }],
      clinics: [{ org_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405180", slug: "alpha", name: "Alpha", views: 10, visible_ms: 83_000 }],
    };
    const replies = [json(200, routes), json(200, front), json(200, pages), json(200, { ...front, vitals: [{ ...front.vitals[0], rating: "fine" }] })];
    const { fetch, calls } = stubFetch(() => Promise.resolve(replies.shift() ?? json(500, {})));
    const client = createHttpClient("http://console.localtest.me/", () => Promise.resolve("abc"), { fetch });

    const durable = await client.getRouteInsights("24h");
    expect(calls[0]?.url).toBe("http://console.localtest.me/api/v1/console/insights/routes?range=24h");
    expect(durable.ok && durable.value.routes[0]?.p95_ms).toBe(10_000);
    const speed = await client.getFrontEndInsights("7d");
    expect(calls[1]?.url).toBe("http://console.localtest.me/api/v1/console/insights/frontend?range=7d");
    expect(speed.ok && speed.value.vitals[0]?.rating).toBe("needs_work");
    const used = await client.getPageInsights("7d");
    expect(calls[2]?.url).toBe("http://console.localtest.me/api/v1/console/insights/pages?range=7d");
    expect(used.ok && used.value.pages[0]?.visible_ms).toBeNull();
    // A rating outside the contract is refused.
    expect((await client.getFrontEndInsights("7d")).ok).toBe(false);
  });

  it("lists walk-ins with the calendar's range and filters, reads optional fields and an unknown status, and checks the body", async () => {
    const fixtures = createFixtures({ now: new Date("2026-10-03T05:30:00Z") });
    const fake = createFakeBackend(fixtures).client({ host: "sunrise.localtest.me", getToken: () => fakeTokenFor({ id: "a1a1a1a1-0000-4000-8000-000000000003" }), now: () => new Date("2026-10-03T05:30:00Z") });
    const patient = (await unwrap(fake.listAppointments({ from: "2026-01-01", to: "2026-12-31" }))).items[0]?.patient;
    const bare = { visit_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405170", patient, starts_at: "2026-10-03T04:00:00Z", status: "open" };
    const full = {
      ...bare,
      visit_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405171",
      practitioner: { id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf3", display_name: "Dr Dev", calendar_color: "#336699" },
      room_id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf4",
      room: "Chair 1",
      token_number: 7,
      ends_at: "2026-10-03T04:40:00Z",
      status: "paused",
    };
    const { fetch, calls } = stubFetch(json(200, { items: [bare, full] }));
    const client = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch });
    const result = await client.listWalkIns({ from: "2026-10-01", to: "2026-10-07", practitionerId: practitionerId.parse("01a103b1-ea26-7120-ad93-41b6b4b4ebf3") });
    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v1/calendar/walk-ins");
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-07");
    expect(url.searchParams.get("practitioner_id")).toBe("01a103b1-ea26-7120-ad93-41b6b4b4ebf3");
    expect(url.searchParams.has("room_id")).toBe(false);
    expect(result.ok && result.value.items[0]?.practitioner).toBeUndefined();
    expect(result.ok && result.value.items[1]?.status).toBe("paused");
    expect(result.ok && result.value.items[1]?.token_number).toBe(7);
    const bad = createHttpClient("http://sunrise.localtest.me/", () => Promise.resolve("abc"), { fetch: stubFetch(json(200, { items: [{ ...bare, starts_at: 5 }] })).fetch });
    expect((await bad.listWalkIns({ from: "2026-10-01", to: "2026-10-07" })).ok).toBe(false);
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

describe("createHttpClient patient directory, photo and consent link", () => {
  it("calls the family routes and decodes the lookup's family group", async () => {
    const id = patientId.parse("01a103b1-ea26-7120-ad93-41b6b4b4ebf2");
    const other = "01a103b1-ea26-7120-ad93-41b6b4b4ebf3";
    const link = { id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf4", patient_id: other, number: "SD-2", full_name: "Aarav Patil", relation: "child", is_primary_contact: false };
    const bodies = [json(200, { items: [link] }), json(200, link), new Response(null, { status: 204 }), json(200, { items: [], family_group: [{ of_patient_id: id, id: other, number: "SD-2", full_name: "Aarav Patil", relation: "sibling" }] })];
    const { calls, fetch } = stubFetch(() => Promise.resolve(bodies.shift() ?? json(500, {})));
    const client = createHttpClient("", () => "abc", { fetch });
    expect((await unwrap(client.listFamily(id))).items[0]?.relation).toBe("child");
    expect((await unwrap(client.addFamilyLink(id, { related_patient_id: other, relation: "child" }))).full_name).toBe("Aarav Patil");
    await unwrap(client.removeFamilyLink(id, link.id));
    expect((await unwrap(client.lookupPatientsByPhone("9876543210"))).family_group[0]?.relation).toBe("sibling");
    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      `GET /api/v1/patients/${id}/family`,
      `POST /api/v1/patients/${id}/family`,
      `DELETE /api/v1/patients/${id}/family/${link.id}`,
      "POST /api/v1/patients/lookup",
    ]);
    expect(calls[1]?.init?.body).toBe(JSON.stringify({ related_patient_id: other, relation: "child" }));
  });

  it("calls the summary, photo and consent routes", async () => {
    const summary = stubFetch(() => Promise.resolve(json(200, { total: 3, new_this_month: 1, recalls_due: 0, with_balance: null })));
    const got = await unwrap(createHttpClient("", () => "abc", { fetch: summary.fetch }).getPatientsSummary());
    // Null without billing.read.
    expect(got.with_balance).toBeNull();
    expect(summary.calls[0]?.url).toBe("/api/v1/patients/summary");

    const id = patientId.parse("01a103b1-ea26-7120-ad93-41b6b4b4ebf2");
    const bytes = stubFetch(() => Promise.resolve(new Response(new Blob(["png"], { type: "image/png" }), { status: 200 })));
    const photo = await unwrap(createHttpClient("", () => "abc", { fetch: bytes.fetch }).getPatientPhoto(id));
    expect(photo.size).toBe(3);
    expect(`${bytes.calls[0]?.init?.method ?? ""} ${bytes.calls[0]?.url ?? ""}`).toBe(`GET /api/v1/patients/${id}/photo`);

    const missing = stubFetch(() => Promise.resolve(json(404, { error: { code: "not_found", message: "Not found." } })));
    const none = await createHttpClient("", () => "abc", { fetch: missing.fetch }).getPatientPhoto(id);
    expect(none.ok ? 0 : none.error.status).toBe(404);

    const form = new FormData();
    form.set("file", new File(["x"], "me.png", { type: "image/png" }));
    const saved = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = createHttpClient("", () => "abc", { fetch: saved.fetch });
    expect((await client.putPatientPhoto(id, form)).ok).toBe(true);
    expect((await client.deletePatientPhoto(id)).ok).toBe(true);
    expect(saved.calls.map((c) => `${c.init?.method ?? ""} ${c.url}`)).toEqual([`PUT /api/v1/patients/${id}/photo`, `DELETE /api/v1/patients/${id}/photo`]);

    const link = stubFetch(() =>
      Promise.resolve(
        json(200, { clinic_name: "Sunrise", state: "pending", purposes: ["care"], notice: { version: "v1", body: null }, expires_at: "2026-10-17T04:30:00Z" }),
      ),
    );
    const shown = await unwrap(createHttpClient("", () => null, { fetch: link.fetch }).getConsentLink("tok/en"));
    expect(shown.state).toBe("pending");
    expect(link.calls[0]?.url).toBe("/api/v1/public/consents/tok%2Fen");
    const signed = stubFetch(() => Promise.resolve(json(200, { recorded: ["care"] })));
    expect((await unwrap(createHttpClient("", () => null, { fetch: signed.fetch }).signConsentLink("tok", { agree: true }))).recorded).toEqual(["care"]);
    expect(signed.calls[0]?.init?.body).toBe(JSON.stringify({ agree: true }));
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
    welcome: true,
    visit_summary: true,
    follow_up_booking: false,
    thanks: true,
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
    invoice: { id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405171", number: "AD/26-27/000001", total_paise: 50000, balance_paise: 20000 },
    recall: null,
  };

  it("sets and removes the caller's avatar on /me/avatar, sending the form as it is", async () => {
    const bodies = [json(200, { preset: "tooth_3" }), new Response(null, { status: 204 })];
    const { calls, fetch } = stubFetch(() => Promise.resolve(bodies.shift() ?? json(500, {})));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    const form = new FormData();
    form.set("preset", "tooth_3");
    expect((await unwrap(client.putMyAvatar(form))).preset).toBe("tooth_3");
    await unwrap(client.deleteMyAvatar());
    expect(calls.map((c) => `${c.init?.method ?? ""} ${new URL(c.url).pathname}`)).toEqual(["PUT /api/v1/me/avatar", "DELETE /api/v1/me/avatar"]);
    expect(calls[0]?.init?.body).toBe(form);
  });

  it("uploads and reads a task's proof photo on its own route", async () => {
    const bodies = [json(200, { proof_file_id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405199" }), new Response(new Blob([new Uint8Array([1, 2])], { type: "image/png" }), { status: 200 })];
    const { calls, fetch } = stubFetch(() => Promise.resolve(bodies.shift() ?? json(500, {})));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    const occurrence = taskOccurrenceId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405171");
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array([1, 2])], { type: "image/png" }), "p.png");
    expect((await unwrap(client.uploadTaskProof(occurrence, form))).proof_file_id).toBe("0192f1c4-7a10-7c3e-9b2a-1d2e3f405199");
    expect((await unwrap(client.getTaskProof(occurrence))).size).toBe(2);
    expect(calls.map((c) => `${c.init?.method ?? ""} ${new URL(c.url).pathname}`)).toEqual([`POST /api/v1/tasks/occurrences/${occurrence}/proof`, `GET /api/v1/tasks/occurrences/${occurrence}/proof`]);
    expect(calls[0]?.init?.body).toBe(form);
  });

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

  it("reads visit notices: audience, the token's id and number, an invoice with or without totals, and a handled row", async () => {
    const waiting = {
      ...alert,
      id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405172",
      kind: "patient_waiting",
      audience: "doctor",
      href: "/queue",
      invoice: null,
      queue_token: { id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405173", number: 7 },
      handled: { at: "2026-10-10T05:40:00Z", name: "Dr Dev" },
    };
    const collect = { ...alert, id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405174", kind: "collect_payment", audience: "front_desk", invoice: { id: "0192f1c4-7a10-7c3e-9b2a-1d2e3f405171" } };
    const { fetch } = stubFetch(json(200, { items: [waiting, collect] }));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    const feed = await unwrap(client.listNotifications());
    expect(feed.items[0]).toMatchObject({ audience: "doctor", queue_token: { number: 7 }, handled: { name: "Dr Dev" } });
    expect(feed.items[1]?.invoice?.total_paise).toBeUndefined();
    const bad = createHttpClient("http://sunrise.localtest.me", () => "token", {
      fetch: stubFetch(json(200, { items: [{ ...waiting, queue_token: { id: "x" } }] })).fetch,
    });
    expect((await bad.listNotifications()).ok).toBe(false);
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
        no_show_auto: true,
        no_show_grace_minutes: 30,
        conflict_policy: "request",
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

describe("createHttpClient import file and opening balances", () => {
  const session = {
    id: "01a103b1-ea26-7120-ad93-41b6b4b4ebf2",
    file_name: "register.xlsx",
    kind: "xlsx",
    sheets: ["Sheet1"],
    header_row: 1,
    headers: ["Naav", "Baki"],
    row_count: 1,
    sample: [["Asha", "1,200"]],
    suggestions: [],
    expires_at: "2026-11-16T05:30:00Z",
  };
  const result = { total: 1, imported: 1, incomplete: 0, merged: 0, skipped: 0, failed: 0, opening_bills: 1, notes: [], rows: [] };

  it("calls the link and delete routes", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, { url: "/x?token=t", expires_at: "2026-11-15T05:35:00Z" })));
    const client = createHttpClient("", () => "abc", { fetch });
    await client.getImportFileDownloadLink(importSessionId.parse(session.id));
    await client.deleteImportFile(importSessionId.parse(session.id));
    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      `GET /api/v1/imports/sessions/${session.id}/file/download`,
      `DELETE /api/v1/imports/sessions/${session.id}/file`,
    ]);
  });

  it("reads a session with the file absent, null or present", async () => {
    const read = async (body: unknown) => {
      const client = createHttpClient("", () => "abc", { fetch: stubFetch(json(201, body)).fetch });
      const out = await client.uploadImportFile(new FormData());
      if (!out.ok) throw new Error(out.error.message);
      return out.value.file;
    };
    expect(await read(session)).toBeUndefined();
    expect(await read({ ...session, file: null })).toBeNull();
    const file = { file_name: "register.xlsx", size_bytes: 2048, mime_type: "application/octet-stream", stored_at: "2026-11-15T05:30:00Z" };
    expect(await read({ ...session, file })).toEqual(file);
  });

  it("reads results with the opening-balance fields absent, null or present", async () => {
    const read = async (body: unknown) => {
      const client = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, body)).fetch });
      const out = await client.commitImport(importSessionId.parse(session.id), { mapping: { full_name: 0 } });
      if (!out.ok) throw new Error(out.error.message);
      return out.value;
    };
    expect((await read(result)).opening_total_paise).toBeUndefined();
    expect((await read({ ...result, opening_total_paise: null })).opening_total_paise).toBeNull();
    expect((await read({ ...result, opening_total_paise: 120_000 })).opening_total_paise).toBe(120_000);
    const row = { row: 2, action: "imported", missing: [], errors: [], warnings: [], values: {}, opening_balance_paise: 120_000 };
    expect((await read({ ...result, rows: [row] })).rows[0]?.opening_balance_paise).toBe(120_000);
  });
});

describe("createHttpClient labs, chat files and stats (B7)", () => {
  it("calls the batch reminder, conversation, attachment, link and stats routes", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, {})));
    const client = createHttpClient("", () => "abc", { fetch });
    await client.remindLabs({ order_ids: ["o1", "o2"], channel: "whatsapp" });
    await client.getConversation("c1");
    const form = new FormData();
    form.set("client_id", "k1");
    await client.postChatAttachment("c1", form);
    await client.getChatAttachmentDownloadLink("f1");
    await client.getMessageStats();
    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      "POST /api/v1/lab-orders/reminders",
      "GET /api/v1/conversations/c1",
      "POST /api/v1/conversations/c1/attachments",
      "GET /api/v1/chat-attachments/f1/download",
      "GET /api/v1/messages/stats",
    ]);
    const sent = calls[0]?.init?.body;
    expect(JSON.parse(typeof sent === "string" ? sent : "{}")).toEqual({ order_ids: ["o1", "o2"], channel: "whatsapp" });
    expect(calls[2]?.init?.body).toBeInstanceOf(FormData);
  });

  it("reads the new optional fields and still reads responses without them", async () => {
    const message = { id: "m1", conversation_id: "c1", author_membership_id: "a1", client_id: "k1", created_at: "2026-11-01T05:30:00Z", deleted: false };
    const old = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, { items: [message] })).fetch });
    const oldPage = await old.listChatMessages("c1");
    expect(oldPage.ok && oldPage.value.items[0]?.attachment).toBeUndefined();
    const withFile = { ...message, is_notice: true, attachment: { id: "f1", mime_type: "application/pdf", size_bytes: 12, file_name: "plan.pdf" } };
    const next = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, { items: [withFile] })).fetch });
    const nextPage = await next.listChatMessages("c1");
    expect(nextPage.ok && nextPage.value.items[0]?.attachment?.mime_type).toBe("application/pdf");
  });
});

describe("createHttpClient lab requests", () => {
  it("sends the order filters, the status and stage changes, the reminder, the log and the payment calls", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, {})));
    const client = createHttpClient("", () => "abc", { fetch });

    await client.listLabOrders({ open: true, vendorId: "v1" });
    await client.listLabOrders({ overdue: true });
    await client.setLabOrderStatus("o1", { status: "received", stage: "Final" });
    await client.updateLabOrder("o1", { stage: "Trial" });
    await client.addLabOrderItem("o1", { work_type: "Crown", teeth: [36] });
    await client.updateLabOrderItem("i1", { qty: 2, unit_cost_paise: null });
    await client.removeLabOrderItem("i 1");
    await client.recordLabPayment({ vendor_id: "v1", paid_on: "2026-10-03", amount_paise: 100, method: "upi" });
    await client.remindLab("o1");
    await client.logLabContact("o1", { channel: "call", outcome: "no_answer" });
    await client.getLabBalance("v1");
    await client.listLabPayments("v1");
    await client.voidLabPayment("p1", { reason: "Entered twice" });
    const proof = new FormData();
    proof.set("file", new File(["%PDF"], "receipt.pdf", { type: "application/pdf" }));
    await client.uploadLabPaymentProof("p 1", proof);
    await client.getLabPaymentProofDownloadLink("p1");
    await client.removeLabPaymentProof("p1");

    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      "GET /api/v1/lab-orders?vendor_id=v1&open=1",
      "GET /api/v1/lab-orders?overdue=true",
      "POST /api/v1/lab-orders/o1/status",
      "PATCH /api/v1/lab-orders/o1",
      "POST /api/v1/lab-orders/o1/items",
      "PATCH /api/v1/lab-order-items/i1",
      "DELETE /api/v1/lab-order-items/i%201",
      "POST /api/v1/lab-payments",
      "POST /api/v1/lab-orders/o1/remind",
      "POST /api/v1/lab-orders/o1/contacts-log",
      "GET /api/v1/lab-vendors/v1/balance",
      "GET /api/v1/lab-payments?vendor_id=v1",
      "POST /api/v1/lab-payments/p1/void",
      "POST /api/v1/lab-payments/p%201/proof",
      "GET /api/v1/lab-payments/p1/proof/download",
      "DELETE /api/v1/lab-payments/p1/proof",
    ]);
    const sentBody = calls[2]?.init?.body;
    expect(JSON.parse(typeof sentBody === "string" ? sentBody : "{}")).toEqual({ status: "received", stage: "Final" });
    const bodyOf = (i: number): unknown => {
      const body = calls[i]?.init?.body;
      return JSON.parse(typeof body === "string" ? body : "null");
    };
    expect(bodyOf(4)).toEqual({ work_type: "Crown", teeth: [36] });
    expect(bodyOf(5)).toEqual({ qty: 2, unit_cost_paise: null });
    expect(calls[6]?.init?.body).toBeUndefined();
    expect(bodyOf(7)).toMatchObject({ method: "upi" });
    expect(calls[13]?.init?.body).toBeInstanceOf(FormData);
  });

  it("reads a lab payment with its method absent, null or present", async () => {
    const payment = {
      id: "p1",
      vendor_id: "v1",
      paid_on: "2026-10-03",
      amount_paise: 100,
      expense_id: "e1",
      status: "recorded",
      recorded_by: "m1",
      created_at: "2026-10-03T05:30:00Z",
    };
    const read = async (extra: object) => {
      const client = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, { items: [{ ...payment, ...extra }] })).fetch });
      return client.listLabPayments();
    };
    for (const extra of [{}, { method: null }, { method: "upi" }]) {
      const result = await read(extra);
      expect(result.ok, JSON.stringify(extra)).toBe(true);
    }
    const upi = await read({ method: "upi" });
    expect(upi.ok && upi.value.items[0]?.method).toBe("upi");
  });

  it("reads a lab payment with its proof absent, null or present", async () => {
    const payment = {
      id: "p1",
      vendor_id: "v1",
      paid_on: "2026-10-03",
      amount_paise: 100,
      expense_id: "e1",
      status: "recorded",
      recorded_by: "m1",
      created_at: "2026-10-03T05:30:00Z",
    };
    const read = async (extra: object) => {
      const client = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, { items: [{ ...payment, ...extra }] })).fetch });
      return client.listLabPayments();
    };
    const proofs = [{}, { proof: null }, { proof: { mime_type: "application/pdf", size_bytes: 4 } }, { proof: { mime_type: "image/png", size_bytes: 9, file_name: "a.png" } }];
    for (const extra of proofs) {
      const result = await read(extra);
      expect(result.ok, JSON.stringify(extra)).toBe(true);
    }
    const shown = await read({ proof: { mime_type: "image/png", size_bytes: 9, file_name: "a.png" } });
    expect(shown.ok && shown.value.items[0]?.proof?.file_name).toBe("a.png");
    // Not a proof at all: refused.
    expect((await read({ proof: { mime_type: 3 } })).ok).toBe(false);
  });

  it("decodes an order and refuses one the contract doesn't allow", async () => {
    const order = {
      id: "o1",
      number: "LAB-1",
      vendor_id: "v1",
      contact_whatsapp: false,
      patient_id: "p1",
      patient_number: "SD-9",
      patient_name: "Test Patient",
      doctor_id: "d1",
      status: "sent",
      pipeline_stage: "sent",
      late: false,
      created_at: "2026-10-01T04:30:00Z",
      costs_visible: false,
      items: [{ id: "i1", line_no: 1, work_type: "Zirconia crown", teeth: [36], qty: 1 }],
      events: [],
    };
    const ok = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, order)).fetch });
    expect((await unwrap(ok.getLabOrder("o1"))).items[0]?.work_type).toBe("Zirconia crown");
    const bad = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, { ...order, pipeline_stage: "somewhere" })).fetch });
    expect((await bad.getLabOrder("o1")).ok).toBe(false);
  });
});

describe("createHttpClient stock analytics requests", () => {
  const ITEM = inventoryItemId.parse("0192f1c4-7a10-7c3e-9b2a-1d2e3f405170");

  it("asks for one item or all, and sends the alert settings", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, {})));
    const client = createHttpClient("", () => "abc", { fetch });

    await client.getStockAnalytics();
    await client.getStockAnalytics({ itemId: ITEM });
    await client.changeInventoryItemAlerts(ITEM, { lead_time_days: 14, alerts_enabled: false });

    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([
      ["GET", "/api/v1/stock/analytics"],
      ["GET", `/api/v1/stock/analytics?item_id=${ITEM}`],
      ["PATCH", `/api/v1/inventory-items/${ITEM}/alerts`],
    ]);
  });
});

describe("deleting the own account", () => {
  it("sends the confirmation, and reads the clinics of a last_owner refusal", async () => {
    const bodies = [
      new Response(null, { status: 204 }),
      json(409, {
        error: { code: "last_owner", message: "Make another member an owner of these clinics first." },
        clinics: [{ id: "a0000000-0000-4000-8000-000000000001", name: "Alpha Dental" }],
      }),
    ];
    const { calls, fetch } = stubFetch(() => Promise.resolve(bodies.shift() ?? json(500, {})));
    const client = createHttpClient("http://sunrise.localtest.me", () => "token", { fetch });
    expect((await client.deleteMyAccount()).ok).toBe(true);
    const refused = await client.deleteMyAccount();
    expect(refused.ok ? undefined : [refused.error.code, refused.error.clinics?.map((c) => c.name)]).toEqual(["last_owner", ["Alpha Dental"]]);
    expect(calls.map((c) => `${c.init?.method ?? ""} ${new URL(c.url).pathname}`)).toEqual(["DELETE /api/v1/me/account", "DELETE /api/v1/me/account"]);
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ confirm: "delete" }));
  });
});

describe("createHttpClient recurring expense requests", () => {
  it("sends each recurring expense call to its path and reads the rule", async () => {
    const rule = {
      id: "r1",
      category: "rent",
      category_name: "Rent",
      amount_paise: 3_000_000,
      note: null,
      cadence: "monthly",
      day_of_month: 1,
      starts_on: "2026-11-01",
      ends_on: null,
      next_due_on: "2026-12-01",
      status: "active",
      recorded_by: "m1",
      created_at: "2026-11-01T05:30:00Z",
    };
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, rule)));
    const client = createHttpClient("", () => "abc", { fetch });
    const id = recurringExpenseId.parse("r 1");
    const made = await client.createRecurringExpense({ category: "rent", amount_paise: 3_000_000, cadence: "monthly", day_of_month: 1, starts_on: "2026-11-01" });
    expect(made.ok ? made.value.next_due_on : undefined).toBe("2026-12-01");
    await client.updateRecurringExpense(id, { ends_on: null, amount_paise: 3_100_000 });
    await client.pauseRecurringExpense(id);
    await client.resumeRecurringExpense(id);
    await client.stopRecurringExpense(id);
    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      "POST /api/v1/recurring-expenses",
      "PATCH /api/v1/recurring-expenses/r%201",
      "POST /api/v1/recurring-expenses/r%201/pause",
      "POST /api/v1/recurring-expenses/r%201/resume",
      "POST /api/v1/recurring-expenses/r%201/stop",
    ]);
    const sent = calls[1]?.init?.body;
    expect(JSON.parse(typeof sent === "string" ? sent : "{}")).toEqual({ ends_on: null, amount_paise: 3_100_000 });
  });
});

describe("createHttpClient expense requests", () => {
  it("sends the method with an expense, and the bill calls", async () => {
    const { calls, fetch } = stubFetch(() => Promise.resolve(json(200, {})));
    const client = createHttpClient("", () => "abc", { fetch });
    await client.recordExpense({ category: "rent", spent_on: "2026-10-03", amount_paise: 100, method: "upi" });
    const bill = new FormData();
    bill.set("file", new File(["%PDF"], "bill.pdf", { type: "application/pdf" }));
    await client.uploadExpenseBill(expenseId.parse("e 1"), bill);
    await client.getExpenseBillDownloadLink(expenseId.parse("e1"));
    await client.removeExpenseBill(expenseId.parse("e1"));
    expect(calls.map((c) => `${c.init?.method ?? "GET"} ${c.url}`)).toEqual([
      "POST /api/v1/expenses",
      "POST /api/v1/expenses/e%201/bill",
      "GET /api/v1/expenses/e1/bill/download",
      "DELETE /api/v1/expenses/e1/bill",
    ]);
    const sent = calls[0]?.init?.body;
    expect(JSON.parse(typeof sent === "string" ? sent : "{}")).toMatchObject({ method: "upi" });
    expect(calls[1]?.init?.body).toBeInstanceOf(FormData);
  });

  it("reads an expense with its method and bill absent, null or present", async () => {
    const row = {
      id: "e1",
      category: "rent",
      category_name: "Rent",
      spent_on: "2026-10-03",
      amount_paise: 100,
      note: null,
      status: "recorded",
      recorded_by: "m1",
      created_at: "2026-10-03T05:30:00Z",
      void_reason: null,
      voided_at: null,
    };
    const read = async (extra: object) => {
      const client = createHttpClient("", () => "abc", { fetch: stubFetch(json(200, { items: [{ ...row, ...extra }] })).fetch });
      return client.listExpenses({});
    };
    const extras = [{}, { method: null, bill: null }, { method: "cash" }, { bill: { mime_type: "image/png", size_bytes: 9, file_name: "a.png" } }];
    for (const extra of extras) {
      expect((await read(extra)).ok, JSON.stringify(extra)).toBe(true);
    }
    const shown = await read({ method: "card", bill: { mime_type: "application/pdf", size_bytes: 4 } });
    expect(shown.ok && [shown.value.items[0]?.method, shown.value.items[0]?.bill?.mime_type]).toEqual(["card", "application/pdf"]);
    expect((await read({ bill: { mime_type: 3 } })).ok).toBe(false);
  });
});
