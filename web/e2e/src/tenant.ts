/**
 * A fresh synthetic clinic for every test file: its own host, owner, doctor and front desk, two
 * chairs, the doctor's working hours every day, a short price list, and setup marked done so the
 * portal opens on Today. Created in one transaction as the schema owner, through the same
 * `app.create_clinic` the console uses, so it takes a few milliseconds and shares nothing with
 * the seed, other files or other runs.
 *
 * Clinics are not deleted afterwards: clinical records are append-only by design. Each has a
 * unique `e2e-<key>` slug, so leftovers never collide; `scripts/e2e-stack.sh reset` starts the
 * e2e database over.
 */
import { randomUUID } from "node:crypto";

import type { Tenant, TenantFactory } from "@sakalya/e2e";

import { ownerQuery, text } from "./db.ts";
import { CLINIC_TIME_ZONE, portalUrl } from "./stack.ts";

/** A person who signs in with a development token. */
export interface Person {
  /** The token's `sub`: `users.auth_uid`. */
  readonly authUid: string;
  readonly email: string;
  readonly displayName: string;
  /** The role key at the clinic, or `platform` for Sakalya staff. */
  readonly role: "owner" | "doctor" | "front_desk" | "platform";
}

/** The seeded Sakalya platform owner, who uses the console. */
export const SAKALYA_ADMIN: Person = {
  authUid: "c1c1c1c1-0000-4000-8000-000000000001",
  email: "admin@sakalya.example",
  displayName: "Sakalya Admin",
  role: "platform",
};

/** A price list item every clinic starts with. */
export interface PriceItem {
  readonly code: string;
  readonly name: string;
  readonly pricePaise: number;
}

export const PRICE_LIST: readonly PriceItem[] = [
  { code: "CONS", name: "Consultation", pricePaise: 50_000 },
  { code: "SCAL", name: "Scaling and polishing", pricePaise: 150_000 },
  { code: "FILL", name: "Composite filling", pricePaise: 200_000 },
];

/** One synthetic clinic. */
export interface Clinic extends Tenant {
  readonly slug: string;
  readonly name: string;
  /** `<slug>.localtest.me`: the clinic comes from the host. */
  readonly host: string;
  readonly owner: Person;
  readonly doctor: Person;
  readonly frontDesk: Person;
  /** The doctor's practitioner record, with hours 08:00 to 22:00 every day. */
  readonly practitionerId: string;
  readonly branchId: string;
  /** Chair 1 and Chair 2. */
  readonly chairIds: readonly [string, string];
}

const CREATE_CLINIC = String.raw`
begin;
insert into aarogyam.users (auth_uid, display_name, email) values (:'owner_uid', :'owner_name', :'owner_email') returning id as owner_user \gset
insert into aarogyam.users (auth_uid, display_name, email) values (:'doctor_uid', :'doctor_name', :'doctor_email') returning id as doctor_user \gset
insert into aarogyam.users (auth_uid, display_name, email) values (:'desk_uid', :'desk_name', :'desk_email') returning id as desk_user \gset
select app.create_clinic(:'slug', :'name', 'EE', 'dental', :'host', :'owner_user') as org \gset
select set_config('app.tenant_id', :'org', true) \gset
insert into aarogyam.memberships (org_id, user_id, role_id, status, joined_at)
select :'org', u.id, r.id, 'active', now()
from (values (:'doctor_user'::uuid, 'doctor'), (:'desk_user'::uuid, 'front_desk')) as u(id, role_key)
join aarogyam.roles r on r.org_id = :'org' and r.key = u.role_key;
update aarogyam.branches set state_code = '27' where org_id = :'org' and is_default;
select id as branch from aarogyam.branches where org_id = :'org' and is_default \gset
insert into aarogyam.rooms (branch_id, name, sort_order) values (:'branch', 'Chair 1', 1) returning id as chair1 \gset
insert into aarogyam.rooms (branch_id, name, sort_order) values (:'branch', 'Chair 2', 2) returning id as chair2 \gset
insert into aarogyam.practitioners (membership_id, display_name, registration_number, specialty)
select m.id, :'doctor_name', 'E2E-' || :'key', 'General dentistry'
from aarogyam.memberships m where m.org_id = :'org' and m.user_id = :'doctor_user'
returning id as practitioner \gset
insert into aarogyam.working_hours (practitioner_id, branch_id, weekday, starts, ends)
select :'practitioner', :'branch', d, time '08:00', time '22:00' from generate_series(1, 7) as d;
insert into aarogyam.price_items (code, name, category, sac_hsn, price_paise, taxable, tax_rate_bps) values
  ('CONS', 'Consultation', 'consultation', '9993', 50000, false, 0),
  ('SCAL', 'Scaling and polishing', 'preventive', '9993', 150000, false, 0),
  ('FILL', 'Composite filling', 'restorative', '9993', 200000, false, 0);
insert into aarogyam.clinic_setup (org_id, dismissed_at) values (:'org', now());
insert into aarogyam.member_setup (org_id, membership_id, dismissed_at)
select org_id, id, now() from aarogyam.memberships where org_id = :'org';
commit;
select json_build_object('org', :'org', 'branch', :'branch', 'practitioner', :'practitioner', 'chair1', :'chair1', 'chair2', :'chair2');
`;

function person(key: string, role: Person["role"], displayName: string): Person {
  return { authUid: randomUUID(), email: `${role.replace("_", "-")}.${key}@e2e.test`, displayName, role };
}

/** Creates one clinic. Exposed for tests that need a clinic outside the fixtures (onboarding). */
export async function createClinic(key: string): Promise<Clinic> {
  const slug = `e2e-${key}`;
  const host = `${slug}.localtest.me`;
  const name = `E2E Dental ${key}`;
  const owner = person(key, "owner", `Owner ${key}`);
  const doctor = person(key, "doctor", `Dr Test ${key}`);
  const frontDesk = person(key, "front_desk", `Desk ${key}`);
  const created = await ownerQuery(CREATE_CLINIC, {
    key,
    slug,
    host,
    name,
    owner_uid: owner.authUid,
    owner_name: owner.displayName,
    owner_email: owner.email,
    doctor_uid: doctor.authUid,
    doctor_name: doctor.displayName,
    doctor_email: doctor.email,
    desk_uid: frontDesk.authUid,
    desk_name: frontDesk.displayName,
    desk_email: frontDesk.email,
  });
  return {
    id: text(created, "org"),
    baseURL: portalUrl(host),
    timeZone: CLINIC_TIME_ZONE,
    locale: "en-IN",
    slug,
    name,
    host,
    owner,
    doctor,
    frontDesk,
    practitionerId: text(created, "practitioner"),
    branchId: text(created, "branch"),
    chairIds: [text(created, "chair1"), text(created, "chair2")],
  };
}

/** The kit's tenant factory: one clinic per test file. */
export const clinicFactory: TenantFactory<Clinic> = {
  create: ({ key }) => createClinic(key),
};
