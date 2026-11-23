-- Offers and referral codes (docs/plans/visit-story-v2-offers-design.md, Part 2; docs/decisions.md,
-- "Offers and referral codes"). The two tables were only modelled until now; this creates them.
--   * promo_codes: a patient's own offer, a patient's referral code (the owner may not redeem it),
--     or the reward a referrer earns when a new patient's referral bill is issued. The code text
--     is 8 Crockford base32 symbols, masked in the change history and never put in URLs or logs.
--   * promo_redemptions: one use of a code on a bill: held on a draft, final at issue, or
--     reversed (removed, void, replaced, revoked, moved, stale). used_count on the code counts the
--     held and final ones, so a hold reserves the use.
--   * invoice_items.promo_discount_paise: the code's share of each line. On a draft it is apart
--     from the manual discount_paise; at issue it is folded in (discount_paise = manual + promo)
--     and kept as a breakdown that no arithmetic reads.
--   * app.invoice_total_paise subtracts the code's share on drafts (the bell and the amount to
--     collect).
--   * app.promo_release_stale_holds: the outbox job releases holds on drafts left past the code's
--     last day + 7 (each clinic's own date), as the system actor.
-- Expand only: new tables, a column with a default, a replaced function, new erasure steps.
set local lock_timeout = '5s';

create table aarogyam.promo_codes (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  code text not null check (code ~ '^[0-9A-HJKMNP-TV-Z]{8}$'),
  purpose text not null check (purpose in ('patient_offer', 'referral', 'referrer_reward')),
  kind text not null check (kind in ('percent_bps', 'fixed')),
  value bigint not null,
  max_discount_paise bigint check (max_discount_paise > 0),
  patient_id uuid not null,
  issued_encounter_id uuid,
  source_code_id uuid,
  source_patient_id uuid,
  issued_by uuid not null,
  valid_from date not null,
  valid_to date not null,
  max_uses int not null check (max_uses between 1 and 1000),
  used_count int not null default 0,
  applies_to jsonb check (applies_to is null or jsonb_typeof(applies_to) = 'object'),
  revoked_at timestamptz,
  revoked_by uuid,
  revoke_reason text check (revoke_reason in ('undo', 'staff', 'erased', 'source_void', 'replaced')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  unique (org_id, code),
  check (case kind when 'percent_bps' then value between 1 and 10000 else value > 0 end),
  -- Every percentage code has a cap (copied from the issuer's role cap, or the referral caps).
  check (kind <> 'percent_bps' or max_discount_paise is not null),
  check (valid_to >= valid_from),
  check (used_count between 0 and max_uses),
  check ((purpose = 'referrer_reward') = (source_code_id is not null and source_patient_id is not null)),
  check (purpose = 'referrer_reward' or issued_encounter_id is not null),
  check (purpose = 'referral' or max_uses = 1),
  check ((revoked_at is null) = (revoke_reason is null)),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, issued_encounter_id, patient_id)
    references aarogyam.encounters (org_id, id, patient_id),
  foreign key (org_id, source_code_id) references aarogyam.promo_codes (org_id, id),
  foreign key (org_id, source_patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, issued_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, revoked_by) references aarogyam.memberships (org_id, id)
);
-- Issuing twice for a visit returns the live code.
create unique index promo_codes_visit_purpose on aarogyam.promo_codes (org_id, issued_encounter_id, purpose)
  where issued_encounter_id is not null and revoked_at is null;
-- One live referral code per patient.
create unique index promo_codes_one_referral on aarogyam.promo_codes (org_id, patient_id)
  where purpose = 'referral' and revoked_at is null;
-- A void and re-bill never mints a second reward for the same friend.
create unique index promo_codes_reward_source
  on aarogyam.promo_codes (org_id, source_code_id, source_patient_id)
  where source_code_id is not null;
create index promo_codes_patient on aarogyam.promo_codes (org_id, patient_id) where revoked_at is null;
create index promo_codes_issued_by on aarogyam.promo_codes (org_id, issued_by);
-- Every foreign key has an index (the schema check).
create index promo_codes_revoked_by on aarogyam.promo_codes (org_id, revoked_by) where revoked_by is not null;
create index promo_codes_source_patient on aarogyam.promo_codes (org_id, source_patient_id)
  where source_patient_id is not null;
create index promo_codes_encounter on aarogyam.promo_codes (org_id, issued_encounter_id, patient_id)
  where issued_encounter_id is not null;
comment on table aarogyam.promo_codes is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.promo_codes', 'mutable');
create policy no_support on aarogyam.promo_codes as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');
insert into audit.audit_config (table_name, exclude, mask) values
  ('aarogyam.promo_codes', '{}', '{code}');

create table aarogyam.promo_redemptions (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  promo_code_id uuid not null,
  patient_id uuid not null,
  invoice_id uuid not null,
  status text not null check (status in ('held', 'final', 'reversed')),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  applied_at timestamptz not null default now(),
  applied_by uuid,
  override boolean not null default false,
  redeemed_at timestamptz,
  reversed_at timestamptz,
  reversed_by uuid,
  reverse_reason text check (reverse_reason in ('removed', 'void', 'replaced', 'revoked', 'moved', 'stale')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  check ((status = 'reversed') = (reversed_at is not null and reverse_reason is not null)),
  check ((status = 'final') = (redeemed_at is not null) or status = 'reversed'),
  foreign key (org_id, promo_code_id) references aarogyam.promo_codes (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, invoice_id, patient_id) references aarogyam.invoices (org_id, id, patient_id),
  foreign key (org_id, applied_by) references aarogyam.memberships (org_id, id),
  foreign key (org_id, reversed_by) references aarogyam.memberships (org_id, id)
);
-- One code per bill (no stacking), one live use per code and patient.
create unique index promo_redemptions_invoice on aarogyam.promo_redemptions (org_id, invoice_id)
  where status <> 'reversed';
create unique index promo_redemptions_code_patient
  on aarogyam.promo_redemptions (org_id, promo_code_id, patient_id) where status <> 'reversed';
create index promo_redemptions_code on aarogyam.promo_redemptions (org_id, promo_code_id);
create index promo_redemptions_patient on aarogyam.promo_redemptions (org_id, patient_id);
create index promo_redemptions_held on aarogyam.promo_redemptions (promo_code_id) where status = 'held';
create index promo_redemptions_invoice_patient on aarogyam.promo_redemptions (org_id, invoice_id, patient_id);
create index promo_redemptions_applied_by on aarogyam.promo_redemptions (org_id, applied_by);
create index promo_redemptions_reversed_by on aarogyam.promo_redemptions (org_id, reversed_by)
  where reversed_by is not null;
comment on table aarogyam.promo_redemptions is 'sensitivity=personal offline=server_only lifecycle=mutable';
select app.protect_clinic_table('aarogyam.promo_redemptions', 'mutable');
create policy no_support on aarogyam.promo_redemptions as restrictive for select to app_user
  using ((select app.actor_kind()) <> 'support');

-- The code's share of each line (see the header). Written only by the promo code path.
alter table aarogyam.invoice_items
  add column promo_discount_paise bigint not null default 0 check (promo_discount_paise >= 0);

-- 0678's function, with the code's share taken off a draft's lines as well. An issued line has
-- it folded into discount_paise already, and an issued bill reads its stored total.
create or replace function app.invoice_total_paise(i aarogyam.invoices)
  returns bigint
  language sql stable set search_path = ''
  as $$
    select case
      when i.status = 'void' then 0::bigint
      when i.status = 'issued' then i.total_paise
      else (select coalesce(round(sum(
                    greatest(it.quantity::bigint * it.unit_price_paise - it.discount_paise
                             - it.promo_discount_paise, 0)
                    + 2 * floor(greatest(it.quantity::bigint * it.unit_price_paise - it.discount_paise
                                         - it.promo_discount_paise, 0)
                                * (it.tax_rate_bps / 2) / 10000.0 + 0.5)) / 100.0) * 100, 0)::bigint
            from aarogyam.invoice_items it
            where it.org_id = i.org_id and it.invoice_id = i.id)
    end
  $$;

-- Erasure (0345): the patient's codes are revoked before their links go (step 30); uses stay
-- with the bills. No step on patients.referred_by_patient_id: it would put every friend's row in
-- the erased set and clear their change history; the referrer's row becomes a tombstone anyway.
insert into audit.erasure_steps (table_name, step_order, action, set_clause, filter, note) values
  ('aarogyam.promo_codes', 25, 'update',
   'revoked_at = coalesce(revoked_at, now()), revoke_reason = coalesce(revoke_reason, ''erased'')',
   'patient_id = $2', 'offer, referral and reward codes'),
  ('aarogyam.promo_redemptions', 100, 'keep', null, 'patient_id = $2', 'code uses, kept with the bills');

-- Releases holds on drafts not issued by the code's last day + 7, in each clinic's own date.
-- Runs across clinics from the outbox job, so it is security definer and records the system
-- actor. Locks the code rows first, then the redemptions, as apply, move and issue do, so there
-- is no deadlock; a redemption that issue made final meanwhile fails the re-check and is skipped.
create function app.promo_release_stale_holds(p_batch int)
  returns table (org_id uuid, released int)
  language plpgsql volatile security definer set search_path = ''
  as $$
  #variable_conflict use_column
  declare
    v_limit int := least(greatest(coalesce(p_batch, 500), 1), 500);
  begin
    perform set_config('app.actor_kind', 'system', true);
    return query
    with stale as (
      select r.org_id, r.id, r.promo_code_id, r.invoice_id
      from aarogyam.promo_redemptions r
      join aarogyam.promo_codes c on c.org_id = r.org_id and c.id = r.promo_code_id
      join aarogyam.organizations o on o.id = r.org_id
      join aarogyam.invoices v on v.org_id = r.org_id and v.id = r.invoice_id
      where r.status = 'held' and v.status = 'draft'
        and (now() at time zone coalesce(o.timezone, 'Asia/Kolkata'))::date > c.valid_to + 7
      order by r.org_id, r.id
      limit v_limit
    ),
    codes as (
      select c.org_id, c.id from aarogyam.promo_codes c
      where (c.org_id, c.id) in (select s.org_id, s.promo_code_id from stale s)
      order by c.org_id, c.id
      for update of c
    ),
    locked as (
      select r.org_id, r.id, r.promo_code_id, r.invoice_id from aarogyam.promo_redemptions r
      where (r.org_id, r.id) in (select s.org_id, s.id from stale s)
        and r.status = 'held'
        and exists (select 1 from codes k where k.org_id = r.org_id and k.id = r.promo_code_id)
        and exists (select 1 from aarogyam.invoices v
                    where v.org_id = r.org_id and v.id = r.invoice_id and v.status = 'draft')
      for update of r
    ),
    released as (
      update aarogyam.promo_redemptions r
        set status = 'reversed', reverse_reason = 'stale', reversed_at = now(), discount_paise = 0
      from locked l
      where r.org_id = l.org_id and r.id = l.id and r.status = 'held'
      returning r.org_id, r.promo_code_id, r.invoice_id
    ),
    lines as (
      update aarogyam.invoice_items it set promo_discount_paise = 0
      from released x
      where it.org_id = x.org_id and it.invoice_id = x.invoice_id and it.promo_discount_paise <> 0
      returning it.org_id
    ),
    counted as (
      update aarogyam.promo_codes c
        set used_count = c.used_count - n.uses
      from (select x.org_id, x.promo_code_id, count(*)::int as uses from released x
            group by x.org_id, x.promo_code_id) n
      where c.org_id = n.org_id and c.id = n.promo_code_id
      returning c.org_id
    )
    -- lines and counted run whether read or not (data-modifying).
    select x.org_id, count(*)::int
    from released x
    group by x.org_id;
  end
  $$;
revoke execute on function app.promo_release_stale_holds(int) from public;
grant execute on function app.promo_release_stale_holds(int) to aarogyam_api;
