-- Permission scopes: what `own` reaches. Queries pass the member to narrow to as a nullable
-- parameter (null for a permission held at `all`) and call these functions in their WHERE, so
-- scoping costs no extra round trip. They run as the caller, so row-level security limits them
-- to the current clinic. `assigned` narrows the same way until the schema has care teams.
-- See docs/decisions.md, "Permission scopes".
set local lock_timeout = '5s';

-- A member's own patients: seen in a visit by them, booked with them (any status but deleted),
-- or registered by them.
create function app.own_patient(p_patient_id uuid, p_member_id uuid)
  returns boolean
  language sql stable
  as $$
    select exists (select 1 from aarogyam.encounters e
                   where e.patient_id = p_patient_id and e.clinician_id = p_member_id)
        or exists (select 1 from aarogyam.appointments a
                   join aarogyam.practitioners pr on pr.org_id = a.org_id and pr.id = a.practitioner_id
                   where a.patient_id = p_patient_id and a.deleted_at is null
                     and pr.membership_id = p_member_id)
        or exists (select 1 from aarogyam.patients p
                   join aarogyam.memberships m on m.org_id = p.org_id and m.user_id = p.created_by
                   where p.id = p_patient_id and m.id = p_member_id)
  $$;
grant execute on function app.own_patient(uuid, uuid) to app_user;

-- Whether a patient is within reach: every patient when p_member_id is null.
create function app.patient_in_reach(p_patient_id uuid, p_member_id uuid)
  returns boolean
  language sql stable
  as $$ select p_member_id is null or app.own_patient(p_patient_id, p_member_id) $$;
grant execute on function app.patient_in_reach(uuid, uuid) to app_user;

-- Whether a clinical record (a visit, note, prescription, procedure, observation or plan) is
-- within reach: the member is responsible for it (p_responsible: the visit's clinician, the
-- note's author, who issued), created it, or treats the visit it belongs to (p_encounter_id).
create function app.clinical_in_reach(p_responsible uuid, p_created_by uuid,
                                      p_encounter_id uuid, p_member_id uuid)
  returns boolean
  language sql stable
  as $$
    select p_member_id is null
        or p_responsible = p_member_id
        or exists (select 1 from aarogyam.memberships m
                   where m.id = p_member_id and m.user_id = p_created_by)
        or exists (select 1 from aarogyam.encounters e
                   where e.id = p_encounter_id and e.clinician_id = p_member_id)
  $$;
grant execute on function app.clinical_in_reach(uuid, uuid, uuid, uuid) to app_user;

-- Whether an appointment or queue token is within reach: it is with the member's own
-- practitioner record.
create function app.practitioner_in_reach(p_practitioner_id uuid, p_member_id uuid)
  returns boolean
  language sql stable
  as $$
    select p_member_id is null
        or exists (select 1 from aarogyam.practitioners pr
                   where pr.id = p_practitioner_id and pr.membership_id = p_member_id)
  $$;
grant execute on function app.practitioner_in_reach(uuid, uuid) to app_user;
