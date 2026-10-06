/**
 * The receiving end of central sign-in. People sign in once on the public site, which sends
 * them to `https://<this host>/auth/handoff#code=…` with a one-time code from the API. The code
 * rides in the fragment, so no server or log sees it; this page reads it, clears it from the
 * address bar, redeems it on this host and signs in here with what the API returns.
 */

import { AUTH_MESSAGES, type AuthClient, type AuthOutcome } from "./auth-client.js";

/** What the API's redeem answers with, as far as signing in needs. */
export type HandoffSessionLike =
  | { kind: "supabase"; token_hash: string }
  | { kind: "dev"; access_token: string };

/** Redeems a code on this host; `null` when it doesn't sign anyone in (unknown, used, expired, another host's). */
export type RedeemHandoff = (code: string) => Promise<HandoffSessionLike | null>;

export const HANDOFF_EXPIRED = "This sign-in link has expired or was already used. Sign in again.";

/** The code in a `#code=…` fragment, if any. */
export function handoffCode(hash: string): string | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const code = params.get("code");
  return code === null || code === "" ? undefined : code;
}

/** Redeems the fragment's code and signs in on this host. */
export async function completeHandoff(auth: AuthClient, hash: string, redeem: RedeemHandoff): Promise<AuthOutcome> {
  const code = handoffCode(hash);
  if (code === undefined) {
    return { ok: false, code: "invalid_code", message: HANDOFF_EXPIRED };
  }
  let session: HandoffSessionLike | null;
  try {
    session = await redeem(code);
  } catch {
    return { ok: false, code: "network", message: AUTH_MESSAGES.network };
  }
  if (session === null) {
    return { ok: false, code: "invalid_code", message: HANDOFF_EXPIRED };
  }
  if (session.kind === "supabase" && auth.kind === "email_code") {
    return auth.verifyTokenHash(session.token_hash);
  }
  if (session.kind === "dev" && auth.kind === "dev") {
    return auth.signInWithToken(session.access_token) ? { ok: true } : { ok: false, code: "invalid_code", message: HANDOFF_EXPIRED };
  }
  return { ok: false, code: "rejected", message: "This app signs in differently from the sign-in page. Sign in here instead." };
}

/** The `next` value that means the Sakalya console (a clinic is named by its host). */
export const CONSOLE_NEXT = "console";

/** Where a signed-out visitor goes when central sign-in is on: the public site's sign-in, told where to return to (a host, or `console`). */
export function centralSignInUrl(signInUrl: string, next: string): string {
  const url = new URL(signInUrl);
  url.searchParams.set("next", next);
  return url.toString();
}

/** Where signing out leaves to when central sign-in is on: the public site's front page. */
export function centralHomeUrl(signInUrl: string): string {
  return new URL("/", signInUrl).toString();
}

/** The address a one-time code is redeemed at: the target host's `/auth/handoff`, code in the fragment. */
export function handoffUrl(host: string, code: string): string {
  return `https://${host}/auth/handoff#code=${encodeURIComponent(code)}`;
}
