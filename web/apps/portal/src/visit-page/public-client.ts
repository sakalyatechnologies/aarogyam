/**
 * The visit page's own API calls: plain `fetch` and hand-checked shapes, not the portal's API
 * client, which brings every schema and zod along. Patients open this page on slow phones, so
 * the whole entry stays small (see `scripts/check-shared-size.mjs`). Public routes only; the
 * token and PIN are the only credentials.
 */

/** What `GET /api/v1/shared/{token}` says about a link before the PIN. */
export interface LinkPreview {
  readonly resource: string;
  readonly state: string;
  readonly clinicName: string;
  readonly expiresAt: string;
}

/** One thing done today. */
export interface Treatment {
  readonly name: string;
  readonly tooth?: number | null;
}

/** One planned treatment, with the doctor's estimate when the clinic shows estimates. */
export interface PlanItem {
  readonly id: string;
  readonly name: string;
  readonly tooth?: number | null;
  readonly estimatePaise?: number | null;
}

/** One medicine line as prescribed. */
export interface Medicine {
  readonly name: string;
  readonly strength?: string | null;
  readonly dose?: string | null;
  readonly frequency?: string | null;
  readonly timing?: string | null;
  readonly durationDays?: number | null;
}

/** Care at home after one kind of treatment. */
export interface Aftercare {
  readonly key: string;
  readonly title: string;
  readonly steps: readonly string[];
  readonly callIf?: string | null;
}

/** The visit as the patient may see it. Fields after `expiresAt` arrive with newer servers. */
export interface Visit {
  readonly clinicName: string;
  readonly patientName: string;
  readonly visitNumber: string;
  readonly visitedOn: string;
  readonly doctorName?: string | null;
  readonly treatments: readonly Treatment[];
  readonly followUpOn?: string | null;
  readonly bookingHost?: string | null;
  readonly bookingPath?: string | null;
  readonly expiresAt: string;
  readonly chiefComplaint?: string | null;
  readonly plan: readonly PlanItem[];
  readonly medicines: readonly Medicine[];
  readonly aftercare: readonly Aftercare[];
  readonly clinicPhone?: string | null;
  readonly practitionerId?: string | null;
}

/** Why a call failed, in the terms the page shows. */
export type Failure =
  | { readonly kind: "wrong_pin"; readonly message: string }
  | { readonly kind: "locked" }
  | { readonly kind: "expired" }
  | { readonly kind: "missing" }
  | { readonly kind: "offline" };

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const optText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const optNumber = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const list = (value: unknown): Json[] => (Array.isArray(value) ? value.filter(isObject) : []);

function failureFor(status: number, body: unknown): Failure {
  const message = isObject(body) && isObject(body["error"]) ? text(body["error"]["message"]) : undefined;
  switch (status) {
    case 403:
      return { kind: "wrong_pin", message: message ?? "That PIN didn't match. Please try again." };
    case 423:
      return { kind: "locked" };
    case 410:
      return { kind: "expired" };
    default:
      return { kind: "missing" };
  }
}

async function call(path: string, init?: RequestInit): Promise<Result<unknown>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "omit", cache: "no-store", ...init });
  } catch {
    return { ok: false, failure: { kind: "offline" } };
  }
  const body: unknown = await response.json().catch(() => undefined);
  return response.ok ? { ok: true, value: body } : { ok: false, failure: failureFor(response.status, body) };
}

const linkPath = (token: string) => `/api/v1/shared/${encodeURIComponent(token)}`;

/** The link's kind and state, before the PIN. */
export async function previewLink(token: string): Promise<Result<LinkPreview>> {
  const result = await call(linkPath(token));
  if (!result.ok) return result;
  const body = result.value;
  const resource = isObject(body) ? text(body["resource"]) : undefined;
  if (!isObject(body) || resource === undefined) return { ok: false, failure: { kind: "missing" } };
  return {
    ok: true,
    value: {
      resource,
      state: text(body["state"]) ?? "active",
      clinicName: text(body["clinic_name"]) ?? "",
      expiresAt: text(body["expires_at"]) ?? "",
    },
  };
}

/** Reads a visit summary response; unknown or missing optional parts become empty. */
export function parseVisit(body: unknown): Visit | undefined {
  if (!isObject(body)) return undefined;
  const clinicName = text(body["clinic_name"]);
  const patientName = text(body["patient_name"]);
  const visitNumber = text(body["visit_number"]);
  const visitedOn = text(body["visited_on"]);
  const expiresAt = text(body["expires_at"]);
  if (clinicName === undefined || patientName === undefined || visitNumber === undefined || visitedOn === undefined || expiresAt === undefined) {
    return undefined;
  }
  return {
    clinicName,
    patientName,
    visitNumber,
    visitedOn,
    expiresAt,
    doctorName: optText(body["doctor_name"]),
    followUpOn: optText(body["follow_up_on"]),
    bookingHost: optText(body["booking_host"]),
    bookingPath: optText(body["booking_path"]),
    chiefComplaint: optText(body["chief_complaint"]),
    clinicPhone: optText(body["clinic_phone"]),
    practitionerId: optText(body["practitioner_id"]),
    treatments: list(body["treatments"]).flatMap((item) => {
      const name = text(item["name"]);
      return name === undefined ? [] : [{ name, tooth: optNumber(item["tooth"]) }];
    }),
    plan: list(body["plan"]).flatMap((item) => {
      const id = text(item["id"]);
      const name = text(item["name"]);
      return id === undefined || name === undefined ? [] : [{ id, name, tooth: optNumber(item["tooth"]), estimatePaise: optNumber(item["estimate_paise"]) }];
    }),
    medicines: list(body["medicines"]).flatMap((item) => {
      const name = text(item["generic"]) ?? text(item["name"]);
      return name === undefined
        ? []
        : [
            {
              name,
              strength: optText(item["strength"]),
              dose: optText(item["dose"]),
              frequency: optText(item["frequency"]),
              timing: optText(item["timing"]),
              durationDays: optNumber(item["duration_days"]),
            },
          ];
    }),
    aftercare: list(body["aftercare"]).flatMap((item) => {
      const key = text(item["key"]);
      const title = text(item["title"]);
      const steps = Array.isArray(item["steps"]) ? item["steps"].filter((step): step is string => typeof step === "string") : [];
      return key === undefined || title === undefined ? [] : [{ key, title, steps, callIf: optText(item["call_if"]) }];
    }),
  };
}

/** The patient's answer to their plan. */
export type PlanChoice = "go_ahead" | "question";

/** The answer as the clinic saved it. */
export interface PlanAnswer {
  readonly choice: PlanChoice;
  readonly respondedAt: string;
}

/** Sends the answer to the plan; the PIN is checked again, as when opening. */
export async function answerPlan(token: string, pin: string, choice: PlanChoice): Promise<Result<PlanAnswer>> {
  const result = await call(`${linkPath(token)}/plan-response`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin, choice }),
  });
  if (!result.ok) return result;
  const body = result.value;
  const saved = isObject(body) ? text(body["choice"]) : undefined;
  return {
    ok: true,
    value: {
      choice: saved === "go_ahead" || saved === "question" ? saved : choice,
      respondedAt: isObject(body) ? (text(body["responded_at"]) ?? "") : "",
    },
  };
}

/** Opens the visit with the PIN. */
export async function openVisit(token: string, pin: string): Promise<Result<Visit>> {
  const result = await call(`${linkPath(token)}/visit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin }),
  });
  if (!result.ok) return result;
  const visit = parseVisit(result.value);
  return visit === undefined ? { ok: false, failure: { kind: "missing" } } : { ok: true, value: visit };
}
