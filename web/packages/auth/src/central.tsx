import { useEffect } from "react";

import { centralSignOutUrl, centralSignInUrl } from "./handoff.js";
import type { AuthClient } from "./auth-client.js";

/** Set while signing out so the signed-out redirect doesn't race the trip back to the site's front page. */
let leaving = false;

/** Leaves for the public site's sign-in (told where to return to) and renders nothing meanwhile. */
export function CentralSignInRedirect({ signInUrl, next }: { signInUrl: string; next: string }) {
  useEffect(() => {
    if (!leaving) {
      window.location.assign(centralSignInUrl(signInUrl, next));
    }
  }, [signInUrl, next]);
  return <div className="p-6" role="status" aria-label="Going to sign-in" />;
}

/**
 * Signs out everywhere (the session ends for every app), clears this origin's session, then,
 * when central sign-in is on, goes to the public site's `/sign-out`. `delayMs` leaves time to
 * read a message first.
 */
export async function signOutToSite(auth: AuthClient, signInUrl: string, delayMs = 0): Promise<void> {
  if (signInUrl !== "") {
    leaving = true;
  }
  await auth.signOut();
  if (signInUrl !== "") {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    window.location.assign(centralSignOutUrl(signInUrl));
  }
}
