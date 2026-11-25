-- Patients checking themselves in by scanning the clinic's QR code (docs/plans/patient-self-check-in-design.md,
-- section 14). A scan makes an arrival request, never a patient: the front desk accepts it (which registers or
-- matches the patient and issues a token) or dismisses it.
--   - org_settings.self_check_in: {"enabled": bool, "key": "<128 random bits, base64url>"}. The key is the QR's
--     capability (not patient data), shown again to staff who manage settings; "New QR" replaces it.
--   - self_check_ins.payload holds what the patient typed (personal and health data). It is cleared the moment
--     the request is accepted or dismissed. Rows are audited with payload and phone_hash excluded, so the answers never reach the change history.
--   - phone_hash is sha256(org_id || phone), kept so the per-phone cap holds after the payload is cleared.
--   - app.sweep_self_check_ins deletes pending rows older than 24 hours and handled rows older than 7 days.
-- Expand only: a column with a default and a new table.
set local lock_timeout = '5s';

alter table aarogyam.org_settings
  add column self_check_in jsonb not null default '{}' check (jsonb_typeof(self_check_in) = 'object');

create table aarogyam.self_check_ins (
  org_id uuid not null default app.tenant_id() references aarogyam.organizations (id),
  id uuid not null default app.uuid_v7(),
  branch_id uuid,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  payload jsonb check (payload is null or jsonb_typeof(payload) = 'object'),
  phone_hash bytea not null,
  patient_id uuid,
  token_id uuid,
  handled_at timestamptz,
  handled_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, id),
  foreign key (org_id, branch_id) references aarogyam.branches (org_id, id),
  foreign key (org_id, patient_id) references aarogyam.patients (org_id, id),
  foreign key (org_id, token_id) references aarogyam.queue_tokens (org_id, id),
  check (status = 'pending' or (handled_at is not null and payload is null)),
  check (status <> 'pending' or payload is not null)
);
create index self_check_ins_by_status on aarogyam.self_check_ins (org_id, status, created_at);
create index self_check_ins_by_phone on aarogyam.self_check_ins (org_id, phone_hash, created_at);
create index self_check_ins_by_patient on aarogyam.self_check_ins (org_id, patient_id) where patient_id is not null;
create index self_check_ins_by_token on aarogyam.self_check_ins (org_id, token_id) where token_id is not null;
create index self_check_ins_by_branch on aarogyam.self_check_ins (org_id, branch_id) where branch_id is not null;
comment on table aarogyam.self_check_ins is 'sensitivity=health offline=none lifecycle=ephemeral';
select app.protect_clinic_table('aarogyam.self_check_ins', 'ephemeral');
-- Audited like every clinic table, but the submitted answers and the phone hash stay out of the change history.
insert into audit.audit_config (table_name, exclude) values
  ('aarogyam.self_check_ins', '{payload,phone_hash}')
on conflict (table_name) do update
  set exclude = array(select distinct unnest(audit.audit_config.exclude || '{payload,phone_hash}'::text[]));

insert into audit.erasure_steps (table_name, step_order, action, set_clause, note) values
  ('aarogyam.self_check_ins', 99, 'delete', null, 'QR arrival requests for the patient');

-- The sweep, one call for all clinics (the periodic worker).
create function app.sweep_self_check_ins(p_now timestamptz)
  returns int
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_deleted int;
  begin
    with gone as (
      delete from aarogyam.self_check_ins s
      where (s.status = 'pending' and s.created_at < p_now - interval '24 hours')
         or (s.status <> 'pending' and s.handled_at < p_now - interval '7 days')
      returning 1
    )
    select count(*)::int into v_deleted from gone;
    return v_deleted;
  end
  $$;
revoke execute on function app.sweep_self_check_ins(timestamptz) from public;
grant execute on function app.sweep_self_check_ins(timestamptz) to aarogyam_api;
