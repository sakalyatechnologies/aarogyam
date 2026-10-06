import { useEffect } from "react";

import { centralHomeUrl, centralSignInUrl } from "./handoff.js";
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

/** Signs out here, then, when central sign-in is on, returns to the public site. */
export async function signOutToSite(auth: AuthClient, signInUrl: string): Promise<void> {
  if (signInUrl !== "") {
    leaving = true;
  }
  await auth.signOut();
  if (signInUrl !== "") {
    window.location.assign(centralHomeUrl(signInUrl));
  }
}
