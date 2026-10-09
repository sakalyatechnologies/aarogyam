//! What the front desk records when a patient arrives: allergies the patient reports (or "No
//! known allergies") and the consents they give at the desk. Shared by the walk-in and by
//! check-in for a booked patient. Allergies recorded here are patient-reported until a
//! clinician confirms them (docs/decisions.md, "Walk-in fast path").

use aarogyam_dal::consents::NoticeChoice;
use aarogyam_dal::{consents, facts};
use aarogyam_domain::clinical::clinical_text;
use aarogyam_domain::consent::{self, DEFAULT_NOTICE_VERSION, Method, Purpose};
use sakalya_db::ScopedTx;
use uuid::Uuid;

use crate::error::AppError;
use crate::notices;
use crate::visits::invalid;

/// Most allergies one arrival may report.
pub const MAX_ALLERGIES: usize = 20;

/// A consent given at the desk.
#[derive(Debug, Clone, Copy)]
pub struct DeskConsent {
    /// What the patient agreed to.
    pub purpose: Purpose,
    /// How: usually verbal at the desk.
    pub method: Method,
}

/// What the desk records, as received.
#[derive(Debug, Clone, Default)]
pub struct Intake {
    /// Substances the patient says they are allergic to.
    pub allergies: Vec<String>,
    /// The patient knows of no allergies. Not with `allergies`.
    pub no_known_allergies: bool,
    /// Consents given at the desk.
    pub consents: Vec<DeskConsent>,
    /// The published notice shown; the clinic's current notice when neither this nor
    /// `notice_version` is given.
    pub notice_id: Option<Uuid>,
    /// A notice label, for a notice that isn't published here.
    pub notice_version: Option<String>,
}

/// An intake checked without the database.
#[derive(Debug, Clone)]
pub(crate) struct Checked {
    allergies: Vec<String>,
    no_known_allergies: bool,
    consents: Vec<DeskConsent>,
    notice_id: Option<Uuid>,
    pub(crate) notice_version: Option<String>,
}

/// Checks the allergy list, the consents and the notice version.
///
/// # Errors
/// [`AppError::Invalid`] naming the bad field.
pub(crate) fn check(input: &Intake) -> Result<Checked, AppError> {
    if input.no_known_allergies && !input.allergies.is_empty() {
        return Err(AppError::invalid(
            "no_known_allergies",
            "can't be given together with allergies",
        ));
    }
    if input.allergies.len() > MAX_ALLERGIES {
        return Err(AppError::invalid(
            "allergies",
            format!("at most {MAX_ALLERGIES}"),
        ));
    }
    let allergies = input
        .allergies
        .iter()
        .map(|text| clinical_text(text, 1, 200).map_err(invalid("allergies")))
        .collect::<Result<Vec<_>, _>>()?;
    let mut purposes: Vec<Purpose> = input.consents.iter().map(|c| c.purpose).collect();
    purposes.sort_by_key(|p| p.as_str());
    purposes.dedup();
    if purposes.len() != input.consents.len() {
        return Err(AppError::invalid("consents", "name each purpose once"));
    }
    let version = input
        .notice_version
        .as_deref()
        .map(|text| consent::version(text).map(str::to_owned))
        .transpose()
        .map_err(|error| AppError::invalid("notice_version", error))?;
    Ok(Checked {
        allergies,
        no_known_allergies: input.no_known_allergies,
        consents: input.consents.clone(),
        notice_id: input.notice_id,
        notice_version: version,
    })
}

/// Records a checked intake for the patient inside an open transaction: returns how many
/// allergies were recorded (ones on record are not repeated) and the purposes consented
/// (ones already in force are left as they are).
///
/// # Errors
/// [`AppError::Conflict`] for "No known allergies" when an allergy is on record.
pub(crate) async fn record(
    tx: &mut ScopedTx,
    patient_id: Uuid,
    intake: &Checked,
    recorded_by: Uuid,
) -> Result<(u64, Vec<Purpose>), AppError> {
    let allergies = if intake.allergies.is_empty() {
        0
    } else {
        facts::insert_reported(tx.conn(), patient_id, &intake.allergies).await?
    };
    if intake.no_known_allergies && !facts::mark_none_known(tx.conn(), patient_id).await? {
        return Err(AppError::Conflict(
            "this patient has an allergy on record; a doctor must review it first",
        ));
    }
    if intake.consents.is_empty() {
        return Ok((allergies, Vec::new()));
    }
    let purposes: Vec<String> = intake
        .consents
        .iter()
        .map(|c| c.purpose.as_str().to_owned())
        .collect();
    let methods: Vec<String> = intake
        .consents
        .iter()
        .map(|c| c.method.as_str().to_owned())
        .collect();
    // Naming a notice costs a lookup; the usual case (the current notice) is in the insert.
    let named = match (intake.notice_id, &intake.notice_version) {
        (None, None) => None,
        _ => Some(notices::resolve(tx, intake.notice_id, intake.notice_version.as_deref()).await?),
    };
    let notice = match &named {
        Some((label, id)) => NoticeChoice::Named(label, *id),
        None => NoticeChoice::Current(DEFAULT_NOTICE_VERSION),
    };
    let recorded = consents::insert_many(
        tx.conn(),
        patient_id,
        &purposes,
        &methods,
        notice,
        recorded_by,
    )
    .await?
    .iter()
    .map(|key| Purpose::parse(key).map_err(|_| AppError::Internal("unknown purpose")))
    .collect::<Result<Vec<_>, _>>()?;
    Ok((allergies, recorded))
}
