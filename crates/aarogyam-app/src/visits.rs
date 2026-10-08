//! Visits and their notes: start, list, open, close; write a draft, edit it, sign it, add
//! addenda, mark a note entered in error. Every function runs in one clinic transaction.

use std::collections::HashMap;

use aarogyam_dal::{patients, visits};
use aarogyam_domain::access::{ClinicActor, Reach};
use aarogyam_domain::clinical::{
    ClinicalError, EncounterStatus, NoteBody, NoteKind, NoteRefusal, NoteSource, NoteState,
    NoteStatus, Signing, clinical_text, error_reason, optional_text,
};
use aarogyam_domain::ids::{ClinicalNoteId, EncounterId, MembershipId, NoteAddendumId, PatientId};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::schedule::QueueStatus;
use sakalya_db::{Db, ScopedTx};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::error::AppError;
use crate::moved::Moved;
use crate::scope::{STAFF, staff_scope as scope};

/// Most visits a list returns.
pub const MAX_VISITS: i64 = 200;

/// A member as shown on a clinical record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Member {
    /// Their membership.
    pub id: MembershipId,
    /// Their display name.
    pub name: String,
}

/// Display names for memberships, looked up once per request.
#[derive(Debug, Default)]
pub(crate) struct Names(HashMap<Uuid, String>);

impl Names {
    pub(crate) async fn load(
        tx: &mut ScopedTx,
        ids: impl IntoIterator<Item = Uuid>,
    ) -> Result<Self, AppError> {
        let mut ids: Vec<Uuid> = ids.into_iter().collect();
        ids.sort_unstable();
        ids.dedup();
        let rows = visits::member_names(tx.conn(), &ids).await?;
        Ok(Self(rows.into_iter().collect()))
    }

    pub(crate) fn member(&self, id: Uuid) -> Member {
        Member {
            id: MembershipId::from_uuid(id),
            name: self.0.get(&id).cloned().unwrap_or_default(),
        }
    }
}

/// Field-attributed validation failure for clinical values.
pub(crate) fn invalid(field: &'static str) -> impl Fn(ClinicalError) -> AppError {
    move |error| AppError::invalid(field, error)
}

/// A refused note change as a conflict.
pub(crate) const fn refused(refusal: NoteRefusal) -> AppError {
    match refusal {
        NoteRefusal::NotAuthor => AppError::Forbidden(refusal.message()),
        _ => AppError::Conflict(refusal.message()),
    }
}

/// Writes the access record for a clinical read.
pub(crate) async fn record_access(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: Uuid,
    resource: &str,
    resource_id: Option<Uuid>,
    action: &str,
) -> Result<(), AppError> {
    let request_text = request_id.map(|id| id.to_string());
    visits::record_access(
        tx.conn(),
        &visits::Access {
            actor_user_id: actor.user_id.uuid(),
            actor_kind: STAFF.as_str(),
            patient_id,
            resource,
            resource_id,
            action,
            purpose: actor.access_purpose(),
            request_id: request_text.as_deref(),
        },
    )
    .await?;
    Ok(())
}

/// The patient, or not found: also when out of `reach` (the scope of the route's permission).
pub(crate) async fn require_patient(
    tx: &mut ScopedTx,
    patient_id: PatientId,
    reach: Reach,
) -> Result<patients::PatientRow, AppError> {
    patients::get(tx.conn(), patient_id.uuid(), reach.member())
        .await?
        .ok_or(AppError::NotFound("patient"))
}

/// The visit, locked, which must still be open; not found when out of `reach`.
pub(crate) async fn require_open_visit(
    tx: &mut ScopedTx,
    visit_id: EncounterId,
    reach: Reach,
) -> Result<visits::EncounterRow, AppError> {
    let visit = visits::get_encounter(tx.conn(), visit_id.uuid(), true, reach.member())
        .await?
        .ok_or(AppError::NotFound("visit"))?;
    if visit.status != EncounterStatus::Open.as_str() {
        return Err(AppError::Conflict(NoteRefusal::VisitClosed.message()));
    }
    Ok(visit)
}

/// A visit as listed.
#[derive(Debug, Clone)]
pub struct VisitView {
    /// Identifier.
    pub id: EncounterId,
    /// Readable number, such as `V-318`.
    pub number: String,
    /// The patient.
    pub patient_id: PatientId,
    /// The member responsible.
    pub clinician: Member,
    /// The appointment it was started from.
    pub appointment_id: Option<Uuid>,
    /// `open` or `closed`.
    pub status: EncounterStatus,
    /// Why the patient came.
    pub chief_complaint: Option<String>,
    /// When it started.
    pub started_at: OffsetDateTime,
    /// When it was closed.
    pub ended_at: Option<OffsetDateTime>,
}

pub(crate) fn visit_view(row: visits::EncounterRow, names: &Names) -> Result<VisitView, AppError> {
    Ok(VisitView {
        id: EncounterId::from_uuid(row.id),
        number: row.number,
        patient_id: PatientId::from_uuid(row.patient_id),
        clinician: names.member(row.clinician_id),
        appointment_id: row.appointment_id,
        status: EncounterStatus::parse(&row.status).map_err(invalid("status"))?,
        chief_complaint: row.chief_complaint,
        started_at: row.started_at,
        ended_at: row.ended_at,
    })
}

/// An addendum to a signed note.
#[derive(Debug, Clone)]
pub struct AddendumView {
    /// Identifier.
    pub id: NoteAddendumId,
    /// Who wrote it.
    pub author: Member,
    /// The text.
    pub body: String,
    /// When.
    pub created_at: OffsetDateTime,
}

/// A clinical note.
#[derive(Debug, Clone)]
pub struct NoteView {
    /// Identifier.
    pub id: ClinicalNoteId,
    /// The visit.
    pub visit_id: EncounterId,
    /// What it is for.
    pub kind: NoteKind,
    /// How it was written.
    pub source: NoteSource,
    /// Where it is in its life.
    pub status: NoteStatus,
    /// Its sections.
    pub body: NoteBody,
    /// Who wrote it.
    pub author: Member,
    /// When it was signed.
    pub signed_at: Option<OffsetDateTime>,
    /// The note it collided with during sync.
    pub conflicts_with_id: Option<ClinicalNoteId>,
    /// Why it was marked entered in error.
    pub error_reason: Option<String>,
    /// When it was written.
    pub created_at: OffsetDateTime,
    /// When it last changed.
    pub updated_at: OffsetDateTime,
    /// Goes up when the note changes; send it back as `If-Match` when editing a draft.
    pub row_version: i64,
    /// Addenda, oldest first.
    pub addenda: Vec<AddendumView>,
}

fn note_view(
    row: visits::NoteRow,
    addenda: Vec<AddendumView>,
    names: &Names,
) -> Result<NoteView, AppError> {
    Ok(NoteView {
        id: ClinicalNoteId::from_uuid(row.id),
        visit_id: EncounterId::from_uuid(row.encounter_id),
        kind: NoteKind::parse(&row.kind).map_err(invalid("kind"))?,
        source: NoteSource::parse(&row.source).map_err(invalid("source"))?,
        status: NoteStatus::parse(&row.status).map_err(invalid("status"))?,
        body: serde_json::from_value(row.body).unwrap_or_default(),
        author: names.member(row.author_id),
        signed_at: row.signed_at,
        conflicts_with_id: row.conflicts_with_id.map(ClinicalNoteId::from_uuid),
        error_reason: row.error_reason,
        created_at: row.created_at,
        updated_at: row.updated_at,
        row_version: row.row_version,
        addenda,
    })
}

/// Loads a visit's notes with their addenda and authors' names.
pub(crate) async fn notes_of(
    tx: &mut ScopedTx,
    encounter_id: Uuid,
) -> Result<Vec<NoteView>, AppError> {
    let notes = visits::list_notes(tx.conn(), encounter_id).await?;
    let ids: Vec<Uuid> = notes.iter().map(|note| note.id).collect();
    let addenda = visits::list_addenda(tx.conn(), &ids).await?;
    let names = Names::load(
        tx,
        notes
            .iter()
            .map(|n| n.author_id)
            .chain(addenda.iter().map(|a| a.author_id)),
    )
    .await?;
    let mut by_note: HashMap<Uuid, Vec<AddendumView>> = HashMap::new();
    for addendum in addenda {
        by_note
            .entry(addendum.note_id)
            .or_default()
            .push(AddendumView {
                id: NoteAddendumId::from_uuid(addendum.id),
                author: names.member(addendum.author_id),
                body: addendum.body,
                created_at: addendum.created_at,
            });
    }
    notes
        .into_iter()
        .map(|note| {
            let addenda = by_note.remove(&note.id).unwrap_or_default();
            note_view(note, addenda, &names)
        })
        .collect()
}

/// Input for starting a visit.
#[derive(Debug, Clone, Default)]
pub struct StartVisit {
    /// An identifier the client made (version 7), so a retry returns this visit instead of
    /// starting another; the server makes one when absent.
    pub id: Option<EncounterId>,
    /// The appointment the patient came for, if any.
    pub appointment_id: Option<Uuid>,
    /// Why the patient came.
    pub chief_complaint: Option<String>,
}

/// Starts a visit for a patient, with the member as the clinician responsible. A retry with the
/// same client-chosen id and the same content returns the visit that exists.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Conflict`] when
/// the appointment already has a visit; [`AppError::IdConflict`] when the id belongs to a
/// different visit; [`AppError::Invalid`] for bad input.
pub async fn start(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: StartVisit,
    now: OffsetDateTime,
) -> Result<VisitView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let chief_complaint = optional_text(input.chief_complaint.as_deref(), 1000)
        .map_err(invalid("chief_complaint"))?;
    let reach = actor.reach(Permission::ClinicalWrite);
    db.scoped(&scope(actor, request_id), async |tx| {
        // Starting a visit makes the patient the member's own, so it needs them in reach first.
        let patient = require_patient(tx, patient_id, reach).await?;
        if let Some(id) = input.id {
            visits::lock_client_id(tx.conn(), id.uuid()).await?;
            if let Some(row) =
                visits::get_encounter(tx.conn(), id.uuid(), false, reach.member()).await?
            {
                let same = row.patient_id == patient.id
                    && row.clinician_id == actor.membership_id.uuid()
                    && row.appointment_id == input.appointment_id
                    && row.chief_complaint == chief_complaint;
                if !same {
                    return Err(AppError::IdConflict);
                }
                let names = Names::load(tx, [row.clinician_id]).await?;
                return visit_view(row, &names);
            }
        }
        let branch_id = visits::default_branch(tx.conn())
            .await?
            .ok_or(AppError::NotFound("branch"))?;
        let value = patients::next_number(tx.conn(), "visit").await?;
        let number = format!("V-{value}");
        let row = visits::insert_encounter(
            tx.conn(),
            &visits::NewEncounter {
                id: input.id.unwrap_or_else(EncounterId::new_v7).uuid(),
                number: &number,
                patient_id: patient.id,
                clinician_id: actor.membership_id.uuid(),
                branch_id,
                appointment_id: input.appointment_id,
                chief_complaint: chief_complaint.as_deref(),
                started_at: now,
                queue_token_id: None,
            },
        )
        .await
        .map_err(|error| match error.kind() {
            sakalya_db::DbErrorKind::Conflict => {
                AppError::Conflict("that appointment already has a visit")
            }
            _ => AppError::Db(error),
        })?;
        let names = Names::load(tx, [row.clinician_id]).await?;
        visit_view(row, &names)
    })
    .await
}

/// A patient's visits, newest first.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic.
pub async fn list(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
) -> Result<Vec<VisitView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let reach = actor.reach(Permission::ClinicalRead);
        let patient = require_patient(tx, patient_id, reach).await?;
        let rows =
            visits::list_encounters(tx.conn(), patient.id, MAX_VISITS, reach.member()).await?;
        let names = Names::load(tx, rows.iter().map(|r| r.clinician_id)).await?;
        rows.into_iter()
            .map(|row| visit_view(row, &names))
            .collect()
    })
    .await
}

/// A visit with its notes. Other parts of the record (vitals, procedures, chart entries,
/// files) are loaded by their own modules and added by [`crate::record::open_visit`].
#[derive(Debug, Clone)]
pub struct VisitWithNotes {
    /// The visit.
    pub visit: VisitView,
    /// Its notes, oldest first.
    pub notes: Vec<NoteView>,
}

/// Loads a visit and its notes, and writes the access record.
pub(crate) async fn open_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
) -> Result<VisitWithNotes, AppError> {
    let reach = actor.reach(Permission::ClinicalRead).member();
    let row = visits::get_encounter(tx.conn(), visit_id.uuid(), false, reach)
        .await?
        .ok_or(AppError::NotFound("visit"))?;
    record_access(
        tx,
        actor,
        request_id,
        row.patient_id,
        "visit",
        Some(row.id),
        "view",
    )
    .await?;
    let notes = notes_of(tx, row.id).await?;
    let names = Names::load(tx, [row.clinician_id]).await?;
    Ok(VisitWithNotes {
        visit: visit_view(row, &names)?,
        notes,
    })
}

/// Closes a visit. Addenda and corrections still work afterwards.
///
/// # Errors
/// [`AppError::NotFound`] when the visit isn't in this clinic; [`AppError::Conflict`] when it
/// is already closed.
pub async fn close(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    now: OffsetDateTime,
) -> Result<VisitView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let visit =
            require_open_visit(tx, visit_id, actor.reach(Permission::ClinicalWrite)).await?;
        let row = visits::close_encounter(tx.conn(), visit.id, now).await?;
        // A visit started from the queue finishes its token (and the token's appointment).
        if let Some(token_id) = visits::token_of(tx.conn(), row.id).await?
            && let Some(token) = aarogyam_dal::queue::lock(tx.conn(), token_id).await?
            && matches!(token.status.as_str(), "waiting" | "in_chair")
        {
            crate::queue::move_token(tx, &actor.timezone, &token, QueueStatus::Done, now).await?;
        }
        let names = Names::load(tx, [row.clinician_id]).await?;
        visit_view(row, &names)
    })
    .await
}

/// A note's content, as received.
#[derive(Debug, Clone, Default)]
pub struct NoteInput {
    /// `soap` (default), `progress`, `procedure`, `intake` or `front_desk`.
    pub kind: Option<String>,
    /// What the patient reports.
    pub subjective: Option<String>,
    /// What the clinician found.
    pub objective: Option<String>,
    /// The assessment.
    pub assessment: Option<String>,
    /// What happens next.
    pub plan: Option<String>,
}

impl NoteInput {
    fn body(&self) -> Result<NoteBody, AppError> {
        NoteBody::new(
            self.subjective.as_deref(),
            self.objective.as_deref(),
            self.assessment.as_deref(),
            self.plan.as_deref(),
        )
        .map_err(invalid("body"))
    }
}

fn body_json(body: &NoteBody) -> Result<serde_json::Value, AppError> {
    serde_json::to_value(body).map_err(|_| AppError::Internal("note body did not serialise"))
}

async fn one_note(tx: &mut ScopedTx, row: visits::NoteRow) -> Result<NoteView, AppError> {
    let addenda = visits::list_addenda(tx.conn(), &[row.id]).await?;
    let names = Names::load(
        tx,
        std::iter::once(row.author_id).chain(addenda.iter().map(|a| a.author_id)),
    )
    .await?;
    let addenda = addenda
        .into_iter()
        .map(|a| AddendumView {
            id: NoteAddendumId::from_uuid(a.id),
            author: names.member(a.author_id),
            body: a.body,
            created_at: a.created_at,
        })
        .collect();
    note_view(row, addenda, &names)
}

/// Starts a draft note in an open visit, written by the member. A retry with the same
/// client-chosen `id` and the same content returns the note that exists, even if its visit has
/// closed since.
///
/// # Errors
/// [`AppError::NotFound`] when the visit isn't in this clinic; [`AppError::Conflict`] when it
/// is closed; [`AppError::IdConflict`] when the id belongs to a different note;
/// [`AppError::Invalid`] for bad input.
pub async fn create_note(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    visit_id: EncounterId,
    id: Option<ClinicalNoteId>,
    input: NoteInput,
) -> Result<NoteView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let kind = match input.kind.as_deref() {
        Some(text) => NoteKind::parse(text).map_err(invalid("kind"))?,
        None => NoteKind::Soap,
    };
    let body = body_json(&input.body()?)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        if let Some(id) = id {
            visits::lock_client_id(tx.conn(), id.uuid()).await?;
            let reach = actor.reach(Permission::ClinicalWrite).member();
            if let Some(row) = visits::get_note_for_update(tx.conn(), id.uuid(), reach).await? {
                let same = row.encounter_id == visit_id.uuid()
                    && row.author_id == actor.membership_id.uuid()
                    && row.kind == kind.as_str()
                    && row.body == body;
                return if same {
                    one_note(tx, row).await
                } else {
                    Err(AppError::IdConflict)
                };
            }
        }
        let visit =
            require_open_visit(tx, visit_id, actor.reach(Permission::ClinicalWrite)).await?;
        let row = visits::insert_note(
            tx.conn(),
            &visits::NewNote {
                id: id.unwrap_or_else(ClinicalNoteId::new_v7).uuid(),
                encounter_id: visit.id,
                patient_id: visit.patient_id,
                author_id: actor.membership_id.uuid(),
                kind: kind.as_str(),
                source: NoteSource::Typed.as_str(),
                body: &body,
            },
        )
        .await?;
        one_note(tx, row).await
    })
    .await
}

async fn note_for_change(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    note_id: ClinicalNoteId,
) -> Result<(visits::NoteRow, NoteState), AppError> {
    let reach = actor.reach(Permission::ClinicalWrite).member();
    let row = visits::get_note_for_update(tx.conn(), note_id.uuid(), reach)
        .await?
        .ok_or(AppError::NotFound("note"))?;
    let state = NoteState {
        status: NoteStatus::parse(&row.status).map_err(invalid("status"))?,
        author: MembershipId::from_uuid(row.author_id),
    };
    Ok((row, state))
}

/// Replaces a draft's sections (and kind, when given). Only the author may, and only while
/// it is a draft. With `expected_version` (the `row_version` the client last saw), an edit of a
/// note that has changed since is refused.
///
/// # Errors
/// [`AppError::NotFound`] when the note isn't in this clinic; [`AppError::Stale`] when
/// `expected_version` is out of date; [`AppError::Forbidden`] for someone else's note;
/// [`AppError::Conflict`] once signed.
pub async fn edit_note(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    note_id: ClinicalNoteId,
    expected_version: Option<i64>,
    input: NoteInput,
) -> Result<NoteView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let body = body_json(&input.body()?)?;
    let kind = input
        .kind
        .as_deref()
        .map(NoteKind::parse)
        .transpose()
        .map_err(invalid("kind"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let (row, state) = note_for_change(tx, actor, note_id).await?;
        AppError::check_version(expected_version, row.row_version)?;
        state.check_edit(actor.membership_id).map_err(refused)?;
        let kind = kind.map_or(row.kind.clone(), |k| k.as_str().to_owned());
        let row = visits::update_note_body(tx.conn(), row.id, &kind, &body).await?;
        one_note(tx, row).await
    })
    .await
}

/// Signs a draft. Only its author may; from then on the note never changes. The author signing
/// it again changes nothing and gets the signed note back; a note that can't be signed (entered
/// in error, empty) is refused with the note as it is.
///
/// # Errors
/// [`AppError::NotFound`] when the note isn't in this clinic; [`AppError::Forbidden`] for
/// someone else's draft.
pub async fn sign_note(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    note_id: ClinicalNoteId,
    now: OffsetDateTime,
) -> Result<Moved<NoteView>, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        // A retry of a signature that landed is answered from one read, without a lock.
        let reach = actor.reach(Permission::ClinicalWrite).member();
        if let Some(bundle) = visits::get_note_bundle(tx.conn(), note_id.uuid(), reach).await?
            && NoteStatus::parse(&bundle.note.status).is_ok_and(|s| s == NoteStatus::Signed)
            && bundle.note.author_id == actor.membership_id.uuid()
        {
            let names = Names(bundle.names.into_iter().collect());
            let addenda = bundle
                .addenda
                .into_iter()
                .map(|a| AddendumView {
                    id: NoteAddendumId::from_uuid(a.id),
                    author: names.member(a.author_id),
                    body: a.body,
                    created_at: a.created_at,
                })
                .collect();
            return Ok(Moved::AlreadyDone(note_view(bundle.note, addenda, &names)?));
        }
        let (row, state) = note_for_change(tx, actor, note_id).await?;
        let body: NoteBody = serde_json::from_value(row.body.clone()).unwrap_or_default();
        match state.check_sign(actor.membership_id, &body) {
            Ok(Signing::Sign) => {
                let row =
                    visits::sign_note(tx.conn(), row.id, actor.membership_id.uuid(), now).await?;
                Ok(Moved::Done(one_note(tx, row).await?))
            }
            Ok(Signing::AlreadySigned) => Ok(Moved::AlreadyDone(one_note(tx, row).await?)),
            Err(NoteRefusal::NotAuthor) => Err(refused(NoteRefusal::NotAuthor)),
            Err(refusal) => Ok(Moved::Refused {
                reason: refusal.message().to_owned(),
                current: one_note(tx, row).await?,
            }),
        }
    })
    .await
}

/// Adds an addendum to a signed note. Addenda are never edited or removed. A retry with the same
/// client-chosen `id` and text returns the note as it is.
///
/// # Errors
/// [`AppError::NotFound`] when the note isn't in this clinic; [`AppError::Conflict`] unless
/// it is signed; [`AppError::IdConflict`] when the id belongs to a different addendum;
/// [`AppError::Invalid`] for an empty or too long text.
pub async fn add_addendum(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    note_id: ClinicalNoteId,
    id: Option<NoteAddendumId>,
    body: &str,
) -> Result<NoteView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let body = clinical_text(body, 1, 10_000).map_err(invalid("body"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let (row, state) = note_for_change(tx, actor, note_id).await?;
        if let Some(id) = id {
            visits::lock_client_id(tx.conn(), id.uuid()).await?;
            if let Some(existing) = visits::get_addendum(tx.conn(), id.uuid()).await? {
                let same = existing.note_id == row.id
                    && existing.author_id == actor.membership_id.uuid()
                    && existing.body == body;
                return if same {
                    one_note(tx, row).await
                } else {
                    Err(AppError::IdConflict)
                };
            }
        }
        state.check_addendum().map_err(refused)?;
        visits::insert_addendum(
            tx.conn(),
            id.unwrap_or_else(NoteAddendumId::new_v7).uuid(),
            row.id,
            actor.membership_id.uuid(),
            &body,
        )
        .await?;
        one_note(tx, row).await
    })
    .await
}

/// Marks a note entered in error with a reason. The note stays in the record, marked.
///
/// # Errors
/// [`AppError::NotFound`] when the note isn't in this clinic; [`AppError::Conflict`] when
/// already marked; [`AppError::Invalid`] for a missing reason.
pub async fn mark_note_in_error(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    note_id: ClinicalNoteId,
    reason: &str,
    now: OffsetDateTime,
) -> Result<NoteView, AppError> {
    actor.require(Permission::ClinicalWrite)?;
    let reason = error_reason(reason).map_err(invalid("reason"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let (row, state) = note_for_change(tx, actor, note_id).await?;
        state
            .check_entered_in_error(actor.membership_id)
            .map_err(refused)?;
        let row =
            visits::mark_note_in_error(tx.conn(), row.id, actor.membership_id.uuid(), &reason, now)
                .await?;
        one_note(tx, row).await
    })
    .await
}
