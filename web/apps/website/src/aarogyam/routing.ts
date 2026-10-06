// Aarogyam-owned. Where a signed-in person goes next.
import type { Me } from "./api";

/** Somewhere a person can be signed in to: the Sakalya console or one of their clinics. */
export interface Place {
  key: string;
  name: string;
  detail: string;
  host: string;
}

export type Destination = { kind: "go"; place: Place } | { kind: "picker"; places: Place[] } | { kind: "none" };

/** The console's host from its URL, or "" when unset or unreadable. */
export function consoleHost(consoleUrl: string): string {
  try {
    return consoleUrl === "" ? "" : new URL(consoleUrl).host;
  } catch {
    return "";
  }
}

/**
 * Staff only: the console. One clinic: that clinic. Staff with clinics, or several clinics: a
 * picker, with the Sakalya console first.
 */
export function decideDestination(me: Me, consoleUrl: string): Destination {
  const places: Place[] = [];
  const consoleAt = consoleHost(consoleUrl);
  if (me.console_access === true && consoleAt !== "") {
    places.push({ key: "console", name: "Sakalya console", detail: "Super admin", host: consoleAt });
  }
  for (const c of me.clinics) {
    if (typeof c.host === "string" && c.host !== "") {
      places.push({ key: c.org_id, name: c.name, detail: c.role_name, host: c.host });
    }
  }
  const [only] = places;
  if (places.length === 1 && only !== undefined) return { kind: "go", place: only };
  if (places.length > 1) return { kind: "picker", places };
  return { kind: "none" };
}

/**
 * Where `?next=` asks to go, if the person may go there: the console (`console`, for staff) or
 * one of their own clinics' hosts, matched exactly against what /me lists. Anything else
 * (another host, a URL, a path) gives null, so the normal routing applies and nobody is ever
 * sent to a host the account doesn't belong to.
 */
export function resolveNext(me: Me, next: string | null | undefined, consoleUrl: string): Place | null {
  const wanted = (next ?? "").trim().toLowerCase();
  if (wanted === "") return null;
  const consoleAt = consoleHost(consoleUrl);
  if (wanted === "console") {
    return me.console_access === true && consoleAt !== ""
      ? { key: "console", name: "Sakalya console", detail: "Super admin", host: consoleAt }
      : null;
  }
  for (const c of me.clinics) {
    if (typeof c.host === "string" && c.host !== "" && c.host.toLowerCase() === wanted) {
      return { key: c.org_id, name: c.name, detail: c.role_name, host: c.host };
    }
  }
  return null;
}
