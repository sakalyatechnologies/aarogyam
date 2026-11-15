/**
 * Aarogyam's fixtures: the kit's (a clinic per test file, signed-in pages, the API client, the
 * outbox inbox, unique names) plus setup helpers for the clinic and a console page.
 *
 * ```ts
 * test("front desk issues a bill", async ({ tenant, pageAs, clinicApi, unique }) => { ... });
 * ```
 */
import { test as base, type Page } from "@playwright/test";
import { createFixtures, type KitFixtures, type KitWorkerFixtures } from "@sakalya/e2e";

import { ClinicApi } from "./clinic-api.ts";
import { outboxInbox } from "./inbox.ts";
import { devSignIn } from "./sign-in.ts";
import { CONSOLE_URL } from "./stack.ts";
import { SAKALYA_ADMIN, clinicFactory, type Clinic, type Person } from "./tenant.ts";

export interface AarogyamFixtures {
  /** Setup calls on the test file's clinic. */
  clinicApi: ClinicApi;
  /** The console, signed in as the seeded Sakalya platform owner. */
  consolePage: Page;
}

const kit = createFixtures<Clinic, Person>({
  tenants: clinicFactory,
  signIn: devSignIn,
  inbox: outboxInbox,
  describe: (person) => `${person.displayName} (${person.role})`,
});

export const test = base.extend<KitFixtures<Clinic, Person> & AarogyamFixtures, KitWorkerFixtures<Clinic>>({
  ...kit,
  clinicApi: async ({ api, tenant }, use) => {
    await use(new ClinicApi(api, tenant));
  },
  consolePage: async ({ pageAs, tenant }, use) => {
    // The console isn't a clinic's host; the tenant only supplies the time zone and locale.
    const page = await pageAs(SAKALYA_ADMIN, { tenant: { ...tenant, baseURL: CONSOLE_URL } });
    await use(page);
  },
});

export { expect } from "@playwright/test";
