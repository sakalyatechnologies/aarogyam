/**
 * Development sign-in, the way the apps themselves remember it: the portal keeps the signed-in
 * person in a cookie on `localtest.me` (so it carries across clinic hosts), the console in
 * session storage. Both hold who the person is, never a token; the app then asks the real
 * `POST /api/v1/dev/token` for one, as it does for a person picked on the sign-in screen.
 */
import type { SignIn } from "@sakalya/e2e";

import type { Clinic, Person } from "./tenant.ts";

const PORTAL_KEY = "aarogyam.portal.dev-auth";
const CONSOLE_KEY = "aarogyam.console.dev-auth";

/** What `@aarogyam/auth`'s dev storage reads back for a person who isn't in the seed. */
function stored(person: Person): string {
  return JSON.stringify({ id: person.authUid, displayName: person.displayName, email: person.email });
}

export const devSignIn: SignIn<Clinic, Person> = {
  async prepare(context, person) {
    const value = stored(person);
    await context.addCookies([{ name: PORTAL_KEY, value: encodeURIComponent(value), domain: ".localtest.me", path: "/", sameSite: "Lax" }]);
    await context.addInitScript(
      ([key, item]) => {
        if (window.location.hostname.startsWith("console.")) {
          window.sessionStorage.setItem(key, item);
        }
      },
      [CONSOLE_KEY, value] as const,
    );
  },
};

/** A context signed out on purpose: patients opening a shared link, visitors registering. */
export const SIGNED_OUT = "signed-out";
