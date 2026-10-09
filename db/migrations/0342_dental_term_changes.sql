-- Retiring and renaming a clinic's own dental terms (docs/decisions.md, "Retiring and renaming
-- dental terms"). Expand only: two new columns, and the table goes from append-only to mutable
-- for exactly the label and the retirement; a trigger keeps everything else fixed. Chart entries
-- name a term by id, so they are never rewritten: history shows the term's current label, and
-- the change history keeps every earlier one.
set local lock_timeout = '5s';

alter table aarogyam.dental_terms
  add column retired_at timestamptz,
  add column retired_by uuid,
  add constraint dental_terms_retired_by foreign key (org_id, retired_by)
    references aarogyam.memberships (org_id, id),
  add constraint dental_terms_retired check ((retired_at is null) = (retired_by is null));
create index dental_terms_retired_by on aarogyam.dental_terms (org_id, retired_by)
  where retired_by is not null;

drop trigger forbid_change on aarogyam.dental_terms;
grant update (label, retired_at, retired_by) on aarogyam.dental_terms to app_user;
comment on table aarogyam.dental_terms is 'sensitivity=internal offline=read_only lifecycle=mutable';

create function app.guard_dental_term() returns trigger
  language plpgsql set search_path = ''
  as $$
  begin
    if (to_jsonb(new) - array['label', 'retired_at', 'retired_by', 'updated_at', 'updated_by'])
       = (to_jsonb(old) - array['label', 'retired_at', 'retired_by', 'updated_at', 'updated_by']) then
      return new;
    end if;
    raise exception 'only a dental term''s label and retirement change'
      using errcode = 'insufficient_privilege';
  end
  $$;
create trigger guard before update on aarogyam.dental_terms
  for each row execute function app.guard_dental_term();
