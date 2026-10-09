-- app.erase_patient: one patient, one transaction (see 0345 and docs/decisions.md, "Erasure job").
set local lock_timeout = '5s';

-- Append-only and final rows refuse every change, the owner's too, except inside an erasure
-- (`app.erasure` set by app.erase_patient). The API's roles can never pass: they hold no update
-- or delete grant on append-only tables, and this checks the role as well.
create or replace function app.forbid_change() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if current_setting('app.erasure', true) = 'on' and current_user not in ('app_user', 'aarogyam_api') then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    raise exception '%.% is append-only', tg_table_schema, tg_table_name
      using errcode = 'insufficient_privilege';
  end
  $$;

create or replace function app.freeze_when_final() returns trigger
  language plpgsql set search_path = ''
  as $$
  declare
    editable text := tg_argv[0];
    terminal text := tg_argv[1];
    allowed text[] := array['status', 'updated_at', 'updated_by'] || tg_argv[2:tg_nargs - 1];
  begin
    if current_setting('app.erasure', true) = 'on' and current_user not in ('app_user', 'aarogyam_api') then
      return new;
    end if;
    if old.status = editable then
      return new;
    end if;
    if old.status <> terminal and new.status = terminal
       and (to_jsonb(new) - allowed) = (to_jsonb(old) - allowed) then
      return new;
    end if;
    raise exception '%.% row % is final', tg_table_schema, tg_table_name, old.id
      using errcode = 'insufficient_privilege';
  end
  $$;

-- Erases one patient: runs every registered step, leaves a tombstone (id, number, status
-- `erased`, erased_at) with identity cleared, scrubs the change history of every row touched or
-- kept, and logs the erasure. False (nothing changed) when the patient isn't in the clinic, is
-- already erased, or is on legal hold. `p_replay` re-erases a patient a restore brought back,
-- whatever their state: the erasure was decided when it first ran.
create function app.erase_patient(p_org uuid, p_patient uuid, p_run uuid, p_replay boolean default false)
  returns boolean
  language plpgsql volatile security definer set search_path = ''
  as $$
  declare
    v_patient aarogyam.patients%rowtype;
    v_step record;
    v_found uuid[];
    v_rows uuid[] := array[p_patient];
  begin
    perform set_config('app.erasure', 'on', true);
    perform set_config('app.actor_kind', 'system', true);
    select * into v_patient from aarogyam.patients p
      where p.org_id = p_org and p.id = p_patient for update;
    if v_patient.id is null then
      return false;
    end if;
    if not p_replay and (v_patient.legal_hold or v_patient.status = 'erased') then
      return false;
    end if;

    for v_step in select * from audit.erasure_steps order by step_order, table_name loop
      execute format('select coalesce(array_agg(id), ''{}'') from %s where org_id = $1 and (%s)',
                     v_step.table_name, v_step.filter)
        into v_found using p_org, p_patient;
      v_rows := v_rows || v_found;
      continue when cardinality(v_found) = 0 or v_step.action = 'keep';
      if v_step.action = 'delete' then
        execute format('delete from %s where org_id = $1 and id = any($2)', v_step.table_name)
          using p_org, v_found;
      else
        execute format('update %s set %s where org_id = $1 and id = any($2)', v_step.table_name, v_step.set_clause)
          using p_org, v_found;
      end if;
    end loop;

    update aarogyam.patients p
      set full_name = 'Erased', phone_e164 = null, alt_phone_e164 = null, email = null, address = null,
          date_of_birth = null, birth_date_estimated = false, blood_group = null, tags = '{}',
          merged_into_id = null, status = 'erased', erased_at = coalesce(p.erased_at, now()),
          deleted_at = coalesce(p.deleted_at, now()),
          legal_hold = false, legal_hold_reason = null, legal_hold_at = null
      where p.org_id = p_org and p.id = p_patient;

    update audit.audit_events e set changes = null
      where e.org_id = p_org and e.row_id = any(v_rows) and e.changes is not null;
    insert into audit.erasure_log (org_id, patient_id, run_id) values (p_org, p_patient, p_run)
      on conflict do nothing;
    return true;
  end
  $$;
revoke execute on function app.erase_patient(uuid, uuid, uuid, boolean) from public;
