/**
 * Setup through the API: the records a journey needs but doesn't test (a patient, an
 * appointment, an open visit) are created with one call each, as the person who would create
 * them, on the clinic's host. Bodies are checked at the boundary with small parsers.
 */
import type { ApiCallOptions, ApiClient, HttpMethod } from "@sakalya/e2e";

import { text } from "./db.ts";
import { API_URL, CONSOLE_URL } from "./stack.ts";
import type { Clinic, Person } from "./tenant.ts";

const tokens = new Map<string, { token: string; until: number }>();

/** A development token for `person`, minted by the API (cached for most of its hour). */
export async function devToken(api: ApiClient, person: Person): Promise<string> {
  const cached = tokens.get(person.authUid);
  if (cached !== undefined && cached.until > Date.now()) {
    return cached.token;
  }
  const body = await api.json("POST", `${API_URL}/api/v1/dev/token`, { data: { auth_uid: person.authUid, email: person.email } });
  const token = text(body, "access_token");
  tokens.set(person.authUid, { token, until: Date.now() + 45 * 60_000 });
  return token;
}

/** Calls the API as `person` on `host` (the clinic comes from the host, never the body). */
export async function callAs(api: ApiClient, person: Person, host: string, method: HttpMethod, path: string, options: ApiCallOptions = {}): Promise<unknown> {
  const bearer = await devToken(api, person);
  return api.json(method, `${API_URL}${path}`, { ...options, bearer, headers: { ...options.headers, host } });
}

/** Calls the console API as Sakalya staff. */
export async function consoleCall(api: ApiClient, person: Person, method: HttpMethod, path: string, options: ApiCallOptions = {}): Promise<unknown> {
  return callAs(api, person, new URL(CONSOLE_URL).hostname, method, path, options);
}

/** A patient registered for a test. */
export interface Patient {
  id: string;
  number: string;
  fullName: string;
}

/** The setup helpers for one clinic. */
export class ClinicApi {
  readonly clinic: Clinic;
  private readonly api: ApiClient;

  constructor(api: ApiClient, clinic: Clinic) {
    this.api = api;
    this.clinic = clinic;
  }

  /** Any call, as `person` (the front desk by default). */
  call(method: HttpMethod, path: string, options: ApiCallOptions = {}, person: Person = this.clinic.frontDesk): Promise<unknown> {
    return callAs(this.api, person, this.clinic.host, method, path, options);
  }

  /** Registers a patient with an age (and an email when given), as the front desk does. */
  async registerPatient(fullName: string, extra: { email?: string; sex?: "female" | "male" } = {}): Promise<Patient> {
    const body = await this.call("POST", "/api/v1/patients", {
      data: { full_name: fullName, sex: extra.sex ?? "female", age_years: 34, ...(extra.email === undefined ? {} : { email: extra.email }) },
    });
    return { id: text(body, "id"), number: text(body, "number"), fullName };
  }

  /** Records an allergy as the doctor. */
  async addAllergy(patientId: string, substance: string, severity: "mild" | "moderate" | "severe" = "severe"): Promise<void> {
    await this.call("POST", `/api/v1/patients/${patientId}/allergies`, { data: { substance, reaction: "Hives", severity } }, this.clinic.doctor);
  }

  /** Books an appointment as the front desk, with the clinic's doctor, and returns its id. */
  async book(patientId: string, startsAt: Date, options: { minutes?: number; chair?: 0 | 1; reason?: string } = {}): Promise<string> {
    const endsAt = new Date(startsAt.getTime() + (options.minutes ?? 30) * 60_000);
    const body = await this.call("POST", "/api/v1/appointments", {
      data: {
        patient_id: patientId,
        practitioner_id: this.clinic.practitionerId,
        room_id: this.clinic.chairIds[options.chair ?? 0],
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        kind: "follow_up",
        ...(options.reason === undefined ? {} : { reason: options.reason }),
      },
    });
    // The API wraps the booking with its conflict warnings: `{ appointment, ... }`.
    const appointment: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "appointment") : undefined;
    return text(appointment ?? body, "id");
  }

  /** The id of a price list item by its code (`CONS`, `SCAL`, `FILL`). */
  async priceItemId(code: string): Promise<string> {
    const body = await this.call("GET", "/api/v1/price-items");
    const items: unknown = typeof body === "object" && body !== null ? Reflect.get(body, "items") : undefined;
    const found: unknown = Array.isArray(items) ? items.find((item: unknown) => typeof item === "object" && item !== null && Reflect.get(item, "code") === code) : undefined;
    return text(found, "id");
  }

  /** A bill for one price list item, issued, as the front desk; returns its id. */
  async issuedBill(patientId: string, code = "CONS"): Promise<string> {
    const draft = await this.call("POST", "/api/v1/invoices", {
      data: { patient_id: patientId, items: [{ price_item_id: await this.priceItemId(code), quantity: 1 }] },
    });
    const id = text(draft, "id");
    await this.call("POST", `/api/v1/invoices/${id}/issue`, { data: {} });
    return id;
  }

  /** Starts a visit as the doctor and returns its id. */
  async startVisit(patientId: string): Promise<string> {
    const body = await this.call("POST", `/api/v1/patients/${patientId}/visits`, { data: {} }, this.clinic.doctor);
    return text(body, "id");
  }

  /** Records a treatment as done in an open visit, as the doctor ("Done today"). */
  async recordProcedure(visitId: string, name: string): Promise<void> {
    await this.call("POST", `/api/v1/visits/${visitId}/procedures`, { data: { name, status: "done" } }, this.clinic.doctor);
  }

  /** A finished visit with one signed SOAP note, as the doctor; returns the visit id. */
  async pastVisitWithNote(patientId: string, subjective: string): Promise<string> {
    const visitId = await this.startVisit(patientId);
    const note = await this.call("POST", `/api/v1/visits/${visitId}/notes`, { data: { sections: { subjective } } }, this.clinic.doctor);
    await this.call("POST", `/api/v1/notes/${text(note, "id")}/sign`, { data: {} }, this.clinic.doctor);
    await this.call("POST", `/api/v1/visits/${visitId}/close`, { data: {} }, this.clinic.doctor);
    return visitId;
  }
}
