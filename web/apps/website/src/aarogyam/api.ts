// Aarogyam-owned. The three public-site calls to the API; each takes `fetch` so tests can mock it.
import { API_BASE_URL } from "./env";

export type Fetch = typeof fetch;

export interface MyClinic {
  org_id: string;
  slug: string;
  name: string;
  role_key: string;
  role_name: string;
  host?: string | null;
}

export interface Me {
  clinics: MyClinic[];
  /** Not in the API yet; read when it arrives so Sakalya staff can be sent to the console. */
  console_access?: boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

/** The API's error text, whichever of its shapes it arrived in. */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null) {
      const o = body as Record<string, unknown>;
      if (typeof o["message"] === "string") return o["message"];
      const e = o["error"];
      if (typeof e === "string") return e;
      if (typeof e === "object" && e !== null && typeof (e as Record<string, unknown>)["message"] === "string") {
        return (e as Record<string, string>)["message"] as string;
      }
    }
  } catch {
    // Not JSON: use the fallback.
  }
  return fallback;
}

const NETWORK = "We could not reach the server. Check your connection and try again.";

export async function fetchMe(token: string, f: Fetch = fetch): Promise<Result<Me>> {
  try {
    const res = await f(`${API_BASE_URL}/api/v1/me`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return { ok: false, message: await errorMessage(res, "We could not load your clinics. Try again.") };
    const body = (await res.json()) as Partial<Me>;
    const me: Me = { clinics: Array.isArray(body.clinics) ? body.clinics : [] };
    if (body.console_access === true) me.console_access = true;
    return { ok: true, value: me };
  } catch {
    return { ok: false, message: NETWORK };
  }
}

/**
 * Asks the API for a one-time code the clinic's portal exchanges for a session
 * (`POST /api/v1/auth/handoff`, body `{ target_host }`, answer `{ code }`).
 */
export async function requestHandoff(token: string, targetHost: string, f: Fetch = fetch): Promise<Result<string>> {
  try {
    const res = await f(`${API_BASE_URL}/api/v1/auth/handoff`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ target_host: targetHost }),
    });
    if (!res.ok) return { ok: false, message: await errorMessage(res, "We could not open that clinic. Try again.") };
    const body = (await res.json()) as { code?: unknown };
    return typeof body.code === "string" ? { ok: true, value: body.code } : { ok: false, message: "We could not open that clinic. Try again." };
  } catch {
    return { ok: false, message: NETWORK };
  }
}

export function handoffUrl(host: string, code: string): string {
  return `https://${host}/auth/handoff#code=${encodeURIComponent(code)}`;
}

export interface RegistrationFields {
  name: string;
  email: string;
  phone: string;
  role: string;
  spec: string;
  clinic: string;
  city: string;
  lic: string;
}

/** The API takes `dental` or `general`; the rest of the choice travels in the message. */
export const specialtyCode = (spec: string): "dental" | "general" =>
  /dentistry|orthodontics|implantology/i.test(spec) ? "dental" : "general";

/** `POST /api/v1/registrations`: lands in Console, Applications. */
export async function submitRegistration(fields: RegistrationFields, f: Fetch = fetch): Promise<Result<string>> {
  try {
    const res = await f(`${API_BASE_URL}/api/v1/registrations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinic_name: fields.clinic.trim(),
        city: fields.city.trim(),
        specialty: specialtyCode(fields.spec),
        contact_name: fields.name.trim(),
        email: fields.email.trim(),
        phone: fields.phone.trim(),
        message: `Role: ${fields.role}. Speciality: ${fields.spec}. Licence: ${fields.lic.trim() || "not given"}.`,
      }),
    });
    if (res.status === 429) return { ok: false, message: "Too many applications from this connection. Please try again later." };
    if (res.status === 400) return { ok: false, message: await errorMessage(res, "Please check your details and try again.") };
    if (!res.ok) return { ok: false, message: "We could not send your application right now. Please try again shortly." };
    const body = (await res.json().catch(() => ({}))) as { message?: unknown };
    return { ok: true, value: typeof body.message === "string" ? body.message : "Thank you. We will email you within two working days." };
  } catch {
    return { ok: false, message: NETWORK };
  }
}
