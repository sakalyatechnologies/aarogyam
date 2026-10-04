/** Failures are values: every client call resolves to an `ApiResult`, never rejects. */

import { errorBody, type RequestId } from "./schemas.js";

/** Client-side error codes, used when there is no API error body to read. */
export type ClientErrorCode = "network_error" | "aborted" | "invalid_response" | "unexpected_status";

export interface ApiError {
  /** HTTP status, or `0` when no response arrived. */
  status: number;
  /** The API's stable code, such as `validation_failed`, or a `ClientErrorCode`. */
  code: string;
  /** Safe to show. Never contains patient data, request bodies or URLs. */
  message: string;
  /** The request field the error is about, in the API's snake_case, for form errors. */
  field?: string;
  /** The `x-request-id` header, to quote to support and open with `sk request`. */
  requestId?: RequestId;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export function success<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

export function failure<T>(error: ApiError): ApiResult<T> {
  return { ok: false, error };
}

const FALLBACK_MESSAGES: Readonly<Record<number, string>> = {
  400: "The request was not valid.",
  401: "Your session has ended. Please sign in again.",
  403: "You don't have permission to do that.",
  404: "We couldn't find that.",
  409: "That conflicts with a change someone else made. Reload and try again.",
  422: "Some details need fixing.",
  429: "Too many requests. Wait a moment and try again.",
};

/**
 * Builds an `ApiError` from a failed response. Reads the API's error body when it has the agreed
 * shape; otherwise falls back to a generic message for the status, so a proxy's HTML error page
 * or a stack trace is never shown to anyone.
 */
export function parseApiError(status: number, body: unknown, requestId: RequestId | undefined): ApiError {
  const parsed = errorBody.safeParse(body);
  const base: ApiError = parsed.success
    ? {
        status,
        code: parsed.data.error.code,
        message: parsed.data.error.message,
        ...(parsed.data.error.field == null ? {} : { field: parsed.data.error.field }),
      }
    : {
        status,
        code: "unexpected_status",
        message: FALLBACK_MESSAGES[status] ?? "Something went wrong on our side. Please try again.",
      };
  return requestId === undefined ? base : { ...base, requestId };
}

/**
 * Thrown by `unwrap` so query libraries that expect a rejected promise (TanStack Query) see the
 * failure. It carries the `ApiError` value for the UI.
 */
export class ApiFailure extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "ApiFailure";
    this.error = error;
  }
}

/** Resolves to the value, or rejects with an `ApiFailure`. For query functions. */
export async function unwrap<T>(pending: Promise<ApiResult<T>>): Promise<T> {
  const result = await pending;
  if (result.ok) {
    return result.value;
  }
  throw new ApiFailure(result.error);
}

/** The `ApiError` inside an unknown thrown value, if it is an `ApiFailure`. */
export function apiErrorOf(thrown: unknown): ApiError | undefined {
  return thrown instanceof ApiFailure ? thrown.error : undefined;
}
