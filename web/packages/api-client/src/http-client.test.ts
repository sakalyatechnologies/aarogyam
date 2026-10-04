import { describe, expect, it, vi } from "vitest";

import { ApiFailure, createDevTokenSource, createHttpClient, patientId, sessionId, unwrap } from "./index.js";

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
};

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
