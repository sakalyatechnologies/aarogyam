-- Voice notes: a recording is an attachment linked to a note (or, for a signed note, to one of
-- its addenda), with its length and spoken language. The dictated text goes in the note's own
-- sections; the audio is kept beside it as evidence and is never part of the signed content.
set local lock_timeout = '5s';

alter table aarogyam.attachments drop constraint attachments_mime_type_check;
alter table aarogyam.attachments add constraint attachments_mime_type_check
  check (mime_type in ('image/jpeg', 'image/png', 'application/pdf', 'application/dicom',
                       'audio/webm', 'audio/mp4', 'audio/ogg'));

alter table aarogyam.attachments
  add column note_id uuid,
  add column addendum_id uuid,
  add column duration_seconds integer check (duration_seconds between 1 and 600),
  add column language text check (language in ('en-IN', 'hi-IN', 'mr-IN'));

-- A note's id plus its visit, so an attachment can only point at a note of its own visit.
create unique index clinical_notes_with_encounter on aarogyam.clinical_notes (org_id, id, encounter_id);
create unique index note_addenda_with_note on aarogyam.note_addenda (org_id, id, note_id);

alter table aarogyam.attachments
  add constraint attachments_note_fk foreign key (org_id, note_id, encounter_id)
    references aarogyam.clinical_notes (org_id, id, encounter_id),
  add constraint attachments_addendum_fk foreign key (org_id, addendum_id, note_id)
    references aarogyam.note_addenda (org_id, id, note_id),
  add constraint attachments_note_needs_visit check (note_id is null or encounter_id is not null),
  add constraint attachments_addendum_needs_note check (addendum_id is null or note_id is not null),
  add constraint attachments_audio_shape check (
    (kind = 'audio') = (mime_type like 'audio/%'));

create index attachments_note on aarogyam.attachments (org_id, note_id, encounter_id) where note_id is not null;
create index attachments_addendum on aarogyam.attachments (org_id, addendum_id, note_id) where addendum_id is not null;

-- A signed note is frozen: a recording may be linked to it only through an addendum.
create function app.attachment_note_frozen() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.note_id is not null and new.addendum_id is null
     and exists (select 1 from aarogyam.clinical_notes n
                 where n.org_id = new.org_id and n.id = new.note_id and n.status <> 'draft') then
    raise exception 'a recording joins a signed note only through an addendum'
      using errcode = '23514';
  end if;
  return new;
end $$;
revoke execute on function app.attachment_note_frozen() from public;
create trigger attachment_note_frozen before insert on aarogyam.attachments
  for each row execute function app.attachment_note_frozen();
