import { describe, expect, it, vi } from "vitest";

import { ApiFailure, createHttpClient, patientNumber, unwrap } from "./index.js";

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
  id: "0192f1c4-0000-7000-8000-000000000001",
  number: "SC-1042",
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
  it("reads the API error shape, the field and the x-request-id header", async () => {
    const { fetch } = stubFetch(
      json(422, { error: { code: "validation_failed", message: "Enter a valid mobile number.", field: "phone" } }),
    );
    const client = createHttpClient("https://smilecatchers.aarogyam.example", () => "token", { fetch });

    const result = await client.createPatient({ full_name: "Test Patient", sex: "female", phone: "+91123" });

    expect(result).toEqual({
      ok: false,
      error: {
        status: 422,
        code: "validation_failed",
        message: "Enter a valid mobile number.",
        field: "phone",
        requestId: REQUEST_ID,
      },
    });
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

    const result = await client.getPatient(patientNumber.parse("SC-1042"));

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

    const failure = await unwrap(client.listPatients({})).catch((thrown: unknown) => thrown);

    expect(failure).toBeInstanceOf(ApiFailure);
    expect(failure instanceof ApiFailure ? failure.error.code : null).toBe("forbidden");
  });
});

describe("createHttpClient requests", () => {
  it("sends the bearer token, asks for JSON and never uses the HTTP cache", async () => {
    const { fetch, calls } = stubFetch(json(200, { items: [], next_cursor: null }));
    const client = createHttpClient("https://smilecatchers.aarogyam.example/", () => Promise.resolve("abc"), { fetch });

    await client.listPatients({ q: "  rahul ", limit: 20 });

    const call = calls[0];
    expect(call?.url).toBe("https://smilecatchers.aarogyam.example/api/v1/patients?q=rahul&limit=20");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer abc");
    expect(headers.get("accept")).toBe("application/json");
    expect(call?.init?.cache).toBe("no-store");
  });

  it("sends no authorization header when signed out, and skips empty query values", async () => {
    const { fetch, calls } = stubFetch(json(200, { items: [] }));
    const client = createHttpClient("", () => null, { fetch });

    await client.listPatients({ q: "", cursor: undefined });

    expect(calls[0]?.url).toBe("/api/v1/patients");
    expect(new Headers(calls[0]?.init?.headers).has("authorization")).toBe(false);
  });

  it("posts JSON and decodes the created record into typed values", async () => {
    const { fetch, calls } = stubFetch(json(201, patientBody));
    const client = createHttpClient("", () => "token", { fetch });

    const result = await client.createPatient({ full_name: "Test Patient", sex: "female" });

    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ full_name: "Test Patient", sex: "female" }));
    expect(result.ok && result.value.number).toBe("SC-1042");
  });
});
