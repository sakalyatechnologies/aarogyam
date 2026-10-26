-- A recall can be dismissed with a reason: who and when are kept.
alter table aarogyam.recalls
  add column dismissed_at timestamptz,
  add column dismissed_by uuid,
  add column dismiss_reason text check (dismiss_reason is null or char_length(dismiss_reason) <= 200),
  add foreign key (org_id, dismissed_by) references aarogyam.memberships (org_id, id),
  add check ((status = 'dismissed') = (dismissed_at is not null));
create index recalls_dismissed_by on aarogyam.recalls (org_id, dismissed_by) where dismissed_by is not null;
