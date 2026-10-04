//! Prescriptions: drafts, issue with the allergy check, cancel and reissue, Quick Rx, and the
//! print data (letterhead, doctor, footer, QR). Every function runs in one clinic transaction.

use std::future::Future;
use std::pin::Pin;

use aarogyam_dal::prescriptions::{self as dal, RxFilter, RxHeader, RxItemRow};
use aarogyam_dal::{access, patients, settings};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::{DrugId, PatientId, PrescriptionId};
use aarogyam_domain::patient::BirthDate;
use aarogyam_domain::permission::Permission;
use aarogyam_domain::prescription::{
    self as rules, CheckedDrug, DoseTiming, MAX_LINES, RecordedAllergy, RxError, RxStatus,
    printed_name,
};
use sakalya_db::{Db, ScopedTx};
use serde_json::{Value, json};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::billing::PatientRef;
use crate::clock::clinic_today;
use crate::error::AppError;
use crate::scope::{STAFF, staff_scope as scope};
use crate::tokens::new_token;

/// The line every printed prescription carries, with the QR.
pub const FOOTER_BRAND: &str = "Prescribed with Aarogyam";

fn rx(field: &'static str) -> impl Fn(RxError) -> AppError {
    move |error| AppError::invalid(field, error)
}

// ------------------------------------------------------------------ allergy port

/// A future returned by an [`AllergySource`].
pub type AllergyFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<RecordedAllergy>, AppError>> + Send + 'a>>;

/// Where the allergy check reads a patient's recorded allergies, inside the issuing
/// transaction. The visits package records allergies; until its `aarogyam.allergies` table is
/// merged and wired here, [`AllergiesNotWiredYet`] reports none.
pub trait AllergySource: Send + Sync + std::fmt::Debug {
    /// The patient's active allergies.
    fn allergies<'a>(&'a self, tx: &'a mut ScopedTx, patient_id: PatientId) -> AllergyFuture<'a>;
}

/// The stand-in until allergies are recorded: no patient has any. Replace it with a source
/// that reads `aarogyam.allergies` (status active) once the visits package merges.
#[derive(Debug, Clone, Copy, Default)]
pub struct AllergiesNotWiredYet;

impl AllergySource for AllergiesNotWiredYet {
    fn allergies<'a>(&'a self, _tx: &'a mut ScopedTx, _patient: PatientId) -> AllergyFuture<'a> {
        Box::pin(async { Ok(Vec::new()) })
    }
}

// ------------------------------------------------------------------ drugs

/// A medicine from the catalogue.
#[derive(Debug, Clone)]
pub struct DrugView {
    /// Identifier.
    pub id: DrugId,
    /// Generic name.
    pub generic_name: String,
    /// Brand, when listed.
    pub brand_name: Option<String>,
    /// Strength.
    pub strength: String,
    /// Form.
    pub form: String,
    /// Usual dose.
    pub default_dose: String,
    /// Usual frequency.
    pub default_frequency: String,
    /// Usual timing.
    pub default_timing: Option<String>,
    /// Usual days.
    pub default_duration_days: Option<i16>,
}

/// Finds medicines by name or strength.
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue`.
pub async fn search_drugs(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    query: &str,
    limit: i64,
) -> Result<Vec<DrugView>, AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    let needle: String = query
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(c, ' ' | '+' | '.' | '%' | '-' | '/'))
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if needle.is_empty() {
        return Ok(Vec::new());
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = dal::search_drugs(tx.conn(), &needle, limit.clamp(1, 50)).await?;
        Ok(rows
            .into_iter()
            .map(|row| DrugView {
                id: DrugId::from_uuid(row.id),
                generic_name: row.generic_name,
                brand_name: row.brand_name,
                strength: row.strength,
                form: row.form,
                default_dose: row.default_dose,
                default_frequency: row.default_frequency,
                default_timing: row.default_timing,
                default_duration_days: row.default_duration_days,
            })
            .collect())
    })
    .await
}

// ------------------------------------------------------------------ prescriptions

/// A medicine as received: from the catalogue (whose values fill what is left out) or free
/// text with a name.
#[derive(Debug, Clone, Default)]
pub struct RxItemInput {
    /// The catalogue entry.
    pub drug_id: Option<Uuid>,
    /// The name; the catalogue's generic name by default.
    pub drug_name: Option<String>,
    /// Strength.
    pub strength: Option<String>,
    /// Form.
    pub form: Option<String>,
    /// Dose, such as `1 tablet`.
    pub dose: Option<String>,
    /// Frequency, such as `1-0-1`.
    pub frequency: Option<String>,
    /// `before_food`, `after_food`, `empty_stomach`, `bedtime`, `sos` or `as_directed`.
    pub timing: Option<String>,
    /// Days.
    pub duration_days: Option<u16>,
    /// Instructions in the patient's language.
    pub instructions: Option<String>,
}

/// A draft's values. On an edit, `None` keeps a value, an empty string clears text, and
/// given items replace all medicines.
#[derive(Debug, Clone, Default)]
pub struct RxInput {
    /// The visit; on an edit `Some(None)` clears it.
    pub encounter_id: Option<Option<Uuid>>,
    /// Diagnosis.
    pub diagnosis_text: Option<String>,
    /// Advice: diet, care, warnings.
    pub advice: Option<String>,
    /// Follow-up date; on an edit `Some(None)` clears it.
    pub follow_up_on: Option<Option<Date>>,
    /// Language of the instructions, such as `hi-IN`.
    pub language: Option<String>,
    /// Medicines.
    pub items: Option<Vec<RxItemInput>>,
}

/// A medicine as the API shows it.
#[derive(Debug, Clone)]
pub struct RxItemView {
    /// Position.
    pub line_no: i16,
    /// Catalogue entry.
    pub drug_id: Option<Uuid>,
    /// As printed (generic name in capitals).
    pub drug_name: String,
    /// Strength.
    pub strength: Option<String>,
    /// Form.
    pub form: Option<String>,
    /// Dose.
    pub dose: String,
    /// Frequency.
    pub frequency: String,
    /// Timing.
    pub timing: Option<String>,
    /// Days.
    pub duration_days: Option<i16>,
    /// Instructions.
    pub instructions: Option<String>,
}

/// A safety alert.
#[derive(Debug, Clone)]
pub struct AlertView {
    /// The medicine's line.
    pub line_no: Option<i16>,
    /// `allergy`.
    pub kind: String,
    /// `info`, `caution` or `serious`.
    pub severity: String,
    /// What the doctor is told.
    pub message: String,
    /// What the doctor did, once issued: `overridden`.
    pub action: Option<String>,
    /// The doctor's reason.
    pub override_reason: Option<String>,
}

/// What the paper shows besides the medicines.
#[derive(Debug, Clone)]
pub struct PrintView {
    /// Clinic name, legal name, address, phone and brand colour.
    pub letterhead: Value,
    /// Doctor's name and registration number.
    pub doctor: Value,
    /// Patient's name, number, age and sex.
    pub recipient: Value,
    /// The clinic's footer text.
    pub footer: Option<String>,
    /// `Prescribed with Aarogyam`.
    pub brand_line: &'static str,
    /// The QR's token.
    pub verify_token: String,
}

/// A prescription as the API shows it.
#[derive(Debug, Clone)]
pub struct RxView {
    /// Identifier.
    pub id: PrescriptionId,
    /// Number, once issued.
    pub number: Option<String>,
    /// The patient.
    pub patient: PatientRef,
    /// The visit.
    pub encounter_id: Option<Uuid>,
    /// Draft, issued or cancelled.
    pub status: RxStatus,
    /// Diagnosis.
    pub diagnosis_text: Option<String>,
    /// Advice.
    pub advice: Option<String>,
    /// Follow-up date.
    pub follow_up_on: Option<Date>,
    /// Language.
    pub language: String,
    /// When issued.
    pub issued_at: Option<OffsetDateTime>,
    /// Why alerts were overridden.
    pub override_reason: Option<String>,
    /// Why it was cancelled.
    pub cancel_reason: Option<String>,
    /// When it was cancelled.
    pub cancelled_at: Option<OffsetDateTime>,
    /// The prescription it replaces.
    pub supersedes_id: Option<Uuid>,
    /// The prescription that replaces it.
    pub superseded_by: Option<Uuid>,
    /// When the draft was started.
    pub created_at: OffsetDateTime,
    /// Medicines.
    pub items: Vec<RxItemView>,
    /// Alerts recorded at issue.
    pub alerts: Vec<AlertView>,
    /// Print data, once issued.
    pub print: Option<PrintView>,
}

fn item_view(row: RxItemRow) -> RxItemView {
    RxItemView {
        line_no: row.line_no,
        drug_id: row.drug_id,
        drug_name: row.drug_name,
        strength: row.strength,
        form: row.form,
        dose: row.dose,
        frequency: row.frequency,
        timing: row.timing,
        duration_days: row.duration_days,
        instructions: row.instructions,
    }
}

pub(crate) async fn load(tx: &mut ScopedTx, id: Uuid) -> Result<RxView, AppError> {
    let row = dal::prescriptions(
        tx.conn(),
        &RxFilter {
            id: Some(id),
            limit: 1,
            ..RxFilter::default()
        },
    )
    .await?
    .into_iter()
    .next()
    .ok_or(AppError::NotFound("prescription"))?;
    let items = dal::items(tx.conn(), id).await?;
    let alerts = dal::alerts(tx.conn(), id).await?;
    let alerts = alerts
        .into_iter()
        .map(|alert| AlertView {
            line_no: alert
                .prescription_item_id
                .and_then(|item| items.iter().find(|i| i.id == item).map(|i| i.line_no)),
            kind: alert.kind,
            severity: alert.severity,
            message: alert.message,
            action: Some(alert.action),
            override_reason: alert.override_reason,
        })
        .collect();
    let print = match (row.letterhead, row.doctor, row.recipient, row.verify_token) {
        (Some(letterhead), Some(doctor), Some(recipient), Some(verify_token)) => Some(PrintView {
            letterhead,
            doctor,
            recipient,
            footer: row.footer,
            brand_line: FOOTER_BRAND,
            verify_token,
        }),
        _ => None,
    };
    Ok(RxView {
        id: PrescriptionId::from_uuid(row.id),
        number: row.number,
        patient: PatientRef {
            id: PatientId::from_uuid(row.patient_id),
            name: row.patient_name,
            number: row.patient_number,
        },
        encounter_id: row.encounter_id,
        status: RxStatus::parse(&row.status).unwrap_or(RxStatus::Draft),
        diagnosis_text: row.diagnosis_text,
        advice: row.advice,
        follow_up_on: row.follow_up_on,
        language: row.language,
        issued_at: row.issued_at,
        override_reason: row.override_reason,
        cancel_reason: row.cancel_reason,
        cancelled_at: row.cancelled_at,
        supersedes_id: row.supersedes_id,
        superseded_by: row.superseded_by,
        created_at: row.created_at,
        items: items.into_iter().map(item_view).collect(),
        alerts,
        print,
    })
}

/// Builds the medicines, filling defaults from the catalogue.
async fn build_items(
    tx: &mut ScopedTx,
    items: Vec<RxItemInput>,
) -> Result<Vec<RxItemRow>, AppError> {
    if items.len() > MAX_LINES {
        return Err(AppError::invalid("items", RxError::TooManyLines));
    }
    let ids: Vec<Uuid> = items.iter().filter_map(|item| item.drug_id).collect();
    let drugs = dal::drugs(tx.conn(), &ids).await?;
    let mut rows = Vec::with_capacity(items.len());
    for (index, item) in items.into_iter().enumerate() {
        let drug =
            match item.drug_id {
                Some(id) => Some(drugs.iter().find(|drug| drug.id == id).ok_or(
                    AppError::invalid("items.drug_id", "is not in the medicine list"),
                )?),
                None => None,
            };
        let pick = |given: Option<String>, default: Option<&str>| {
            given
                .or_else(|| default.map(str::to_owned))
                .unwrap_or_default()
        };
        let name = pick(item.drug_name, drug.map(|d| d.generic_name.as_str()));
        let drug_name =
            printed_name(&rules::required_text(&name, 200).map_err(rx("items.drug_name"))?);
        let dose =
            rules::required_text(&pick(item.dose, drug.map(|d| d.default_dose.as_str())), 60)
                .map_err(rx("items.dose"))?;
        let frequency = rules::required_text(
            &pick(item.frequency, drug.map(|d| d.default_frequency.as_str())),
            40,
        )
        .map_err(rx("items.frequency"))?;
        let timing = match item
            .timing
            .or_else(|| drug.and_then(|d| d.default_timing.clone()))
        {
            Some(text) if !text.trim().is_empty() => Some(
                DoseTiming::parse(&text)
                    .map_err(|e| AppError::invalid("items.timing", e))?
                    .as_str()
                    .to_owned(),
            ),
            _ => None,
        };
        let duration_days = match item.duration_days {
            Some(days) if !(1..=365).contains(&days) => {
                return Err(AppError::invalid("items.duration_days", RxError::Duration));
            }
            Some(days) => i16::try_from(days).ok(),
            None => drug.and_then(|d| d.default_duration_days),
        };
        rows.push(RxItemRow {
            id: Uuid::now_v7(),
            line_no: i16::try_from(index + 1).unwrap_or(i16::MAX),
            drug_id: drug.map(|d| d.id),
            drug_name,
            strength: rules::optional_text(
                item.strength
                    .as_deref()
                    .or(drug.map(|d| d.strength.as_str())),
                60,
            )
            .map_err(rx("items.strength"))?,
            form: rules::optional_text(item.form.as_deref().or(drug.map(|d| d.form.as_str())), 30)
                .map_err(rx("items.form"))?,
            dose,
            frequency,
            timing,
            duration_days,
            instructions: rules::optional_text(item.instructions.as_deref(), 500)
                .map_err(rx("items.instructions"))?,
        });
    }
    Ok(rows)
}

fn language(text: Option<&str>, current: &str) -> Result<String, AppError> {
    match text.map(str::trim) {
        None | Some("") => Ok(current.to_owned()),
        Some(text) => aarogyam_domain::patient::Language::parse(text)
            .map(|language| language.as_str().to_owned())
            .map_err(AppError::patient),
    }
}

async fn write_items(tx: &mut ScopedTx, id: Uuid, items: &[RxItemRow]) -> Result<(), AppError> {
    for item in items {
        dal::insert_item(tx.conn(), id, item).await?;
    }
    Ok(())
}

/// Starts a draft for a patient.
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue`; [`AppError::NotFound`] for an unknown
/// patient; [`AppError::Invalid`] for bad values.
pub async fn create(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: RxInput,
) -> Result<RxView, AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let patient = patients::get(tx.conn(), patient_id.uuid())
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let items = build_items(tx, input.items.unwrap_or_default()).await?;
        let diagnosis = rules::optional_text(input.diagnosis_text.as_deref(), 500)
            .map_err(rx("diagnosis_text"))?;
        let advice = rules::optional_text(input.advice.as_deref(), 2000).map_err(rx("advice"))?;
        let language = language(input.language.as_deref(), &patient.preferred_language)?;
        let id = PrescriptionId::new_v7().uuid();
        dal::insert(
            tx.conn(),
            id,
            patient.id,
            None,
            &RxHeader {
                encounter_id: input.encounter_id.flatten(),
                diagnosis_text: diagnosis.as_deref(),
                advice: advice.as_deref(),
                follow_up_on: input.follow_up_on.flatten(),
                language: &language,
            },
        )
        .await?;
        write_items(tx, id, &items).await?;
        load(tx, id).await
    })
    .await
}

/// Edits a draft.
///
/// # Errors
/// As [`create`], and [`AppError::Conflict`] once issued or cancelled.
pub async fn edit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PrescriptionId,
    input: RxInput,
) -> Result<RxView, AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        dal::lock(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("prescription"))?;
        let current = load(tx, id.uuid()).await?;
        if current.status != RxStatus::Draft {
            return Err(AppError::Conflict(
                "an issued prescription never changes; cancel it and reissue",
            ));
        }
        let keep = |given: Option<String>, old: Option<String>| given.or(old);
        let diagnosis = rules::optional_text(
            keep(input.diagnosis_text, current.diagnosis_text).as_deref(),
            500,
        )
        .map_err(rx("diagnosis_text"))?;
        let advice = rules::optional_text(keep(input.advice, current.advice).as_deref(), 2000)
            .map_err(rx("advice"))?;
        let language = language(input.language.as_deref(), &current.language)?;
        dal::update_draft(
            tx.conn(),
            id.uuid(),
            &RxHeader {
                encounter_id: input.encounter_id.unwrap_or(current.encounter_id),
                diagnosis_text: diagnosis.as_deref(),
                advice: advice.as_deref(),
                follow_up_on: input.follow_up_on.unwrap_or(current.follow_up_on),
                language: &language,
            },
        )
        .await?;
        if let Some(items) = input.items {
            let items = build_items(tx, items).await?;
            dal::clear_draft_lines(tx.conn(), id.uuid()).await?;
            write_items(tx, id.uuid(), &items).await?;
        }
        load(tx, id.uuid()).await
    })
    .await
}

/// What issuing did.
#[derive(Debug, Clone)]
pub enum IssueOutcome {
    /// Issued; the alerts the doctor overrode are recorded on it.
    Issued(Box<RxView>),
    /// Not issued: these alerts need the doctor's reason to go ahead.
    NeedsOverride(Vec<AlertView>),
}

fn letterhead(row: &settings::SettingsRow) -> Value {
    json!({
        "name": row.name,
        "legal_name": row.legal_name,
        "address": row.address,
        "phone": row.phone_e164,
        "brand": row.branding.get("brand"),
    })
}

/// What the paper shows besides the medicines, captured at issue.
struct PrintFacts {
    letterhead: Value,
    doctor: Value,
    recipient: Value,
    footer: Option<String>,
}

async fn print_facts(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    patient_id: Uuid,
    now: OffsetDateTime,
) -> Result<PrintFacts, AppError> {
    let clinic = settings::get(tx.conn())
        .await?
        .ok_or(AppError::NotFound("clinic"))?;
    let patient = patients::get(tx.conn(), patient_id)
        .await?
        .ok_or(AppError::NotFound("patient"))?;
    let today = clinic_today(&clinic.timezone, now);
    let age = patient.date_of_birth.map(|date| {
        let birth = if patient.birth_date_estimated {
            BirthDate::Estimated(date)
        } else {
            BirthDate::Exact(date)
        };
        birth.age_on(today)
    });
    let (doctor_name, registration_number) = dal::doctor(tx.conn(), actor.membership_id.uuid())
        .await?
        .unwrap_or_default();
    let footer = clinic
        .prescription
        .get("footer")
        .and_then(Value::as_str)
        .map(str::to_owned);
    Ok(PrintFacts {
        letterhead: letterhead(&clinic),
        doctor: json!({ "name": doctor_name, "registration_number": registration_number }),
        recipient: json!({ "name": patient.full_name, "number": patient.number,
                           "age_years": age, "sex": patient.sex }),
        footer,
    })
}

/// Issues a draft: checks the medicines against the patient's recorded allergies, numbers it
/// (`RX-412`), and freezes it with what the paper shows. With alerts and no override reason,
/// nothing changes and the alerts come back.
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue`; [`AppError::NotFound`];
/// [`AppError::Conflict`] when not a draft; [`AppError::Invalid`] with no medicines or a bad
/// reason.
pub async fn issue(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PrescriptionId,
    override_reason: Option<&str>,
    allergy_source: &dyn AllergySource,
    now: OffsetDateTime,
) -> Result<IssueOutcome, AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    let override_reason = match override_reason.map(str::trim) {
        None | Some("") => None,
        Some(text) => Some(rules::reason(text).map_err(rx("override_reason"))?),
    };
    db.scoped(&scope(actor, request_id), async |tx| {
        let (status, patient_id) = dal::lock(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("prescription"))?;
        if status != RxStatus::Draft.as_str() {
            return Err(AppError::Conflict(
                "this prescription is already issued or cancelled",
            ));
        }
        let items = dal::items(tx.conn(), id.uuid()).await?;
        if items.is_empty() {
            return Err(AppError::invalid("items", RxError::NoLines));
        }
        let ids: Vec<Uuid> = items.iter().filter_map(|item| item.drug_id).collect();
        let drugs = dal::drugs(tx.conn(), &ids).await?;
        let no_classes = Vec::new();
        let checked: Vec<CheckedDrug<'_>> = items
            .iter()
            .map(|item| CheckedDrug {
                line_no: u16::try_from(item.line_no).unwrap_or(0),
                name: &item.drug_name,
                classes: item
                    .drug_id
                    .and_then(|drug| drugs.iter().find(|d| d.id == drug))
                    .map_or(&no_classes, |d| &d.allergy_classes),
            })
            .collect();
        let allergies = allergy_source
            .allergies(tx, PatientId::from_uuid(patient_id))
            .await?;
        let alerts = rules::allergy_alerts(&checked, &allergies);
        if !alerts.is_empty() && override_reason.is_none() {
            return Ok(IssueOutcome::NeedsOverride(
                alerts
                    .into_iter()
                    .map(|alert| AlertView {
                        line_no: i16::try_from(alert.line_no).ok(),
                        kind: "allergy".into(),
                        severity: alert.severity.as_str().into(),
                        message: alert.message,
                        action: None,
                        override_reason: None,
                    })
                    .collect(),
            ));
        }
        for alert in &alerts {
            let item = items
                .iter()
                .find(|item| i32::from(item.line_no) == i32::from(alert.line_no));
            dal::insert_alert(
                tx.conn(),
                id.uuid(),
                &dal::AlertRow {
                    prescription_item_id: item.map(|item| item.id),
                    kind: "allergy".into(),
                    severity: alert.severity.as_str().into(),
                    message: alert.message.clone(),
                    action: "overridden".into(),
                    override_reason: override_reason.clone(),
                },
                actor.membership_id.uuid(),
            )
            .await?;
        }
        let facts = print_facts(tx, actor, patient_id, now).await?;
        let serial = patients::next_number(tx.conn(), "prescription").await?;
        let number = format!("RX-{serial}");
        let (verify_token, _) = new_token()?;
        dal::issue(
            tx.conn(),
            id.uuid(),
            &dal::IssuedRx {
                number: &number,
                issued_at: now,
                issued_by: actor.membership_id.uuid(),
                override_reason: if alerts.is_empty() {
                    None
                } else {
                    override_reason.as_deref()
                },
                verify_token: &verify_token,
                letterhead: facts.letterhead,
                doctor: facts.doctor,
                recipient: facts.recipient,
                footer: facts.footer.as_deref(),
            },
        )
        .await?;
        Ok(IssueOutcome::Issued(Box::new(load(tx, id.uuid()).await?)))
    })
    .await
}

/// Copies a prescription into a new draft that supersedes it.
async fn copy_as_draft(tx: &mut ScopedTx, from: &RxView) -> Result<RxView, AppError> {
    let id = PrescriptionId::new_v7().uuid();
    dal::insert(
        tx.conn(),
        id,
        from.patient.id.uuid(),
        Some(from.id.uuid()),
        &RxHeader {
            encounter_id: from.encounter_id,
            diagnosis_text: from.diagnosis_text.as_deref(),
            advice: from.advice.as_deref(),
            follow_up_on: from.follow_up_on,
            language: &from.language,
        },
    )
    .await
    .map_err(|error| match error.constraint() {
        Some("prescriptions_supersedes") => {
            AppError::Conflict("this prescription was already reissued")
        }
        _ => error.into(),
    })?;
    let items: Vec<RxItemRow> = from
        .items
        .iter()
        .map(|item| RxItemRow {
            id: Uuid::now_v7(),
            line_no: item.line_no,
            drug_id: item.drug_id,
            drug_name: item.drug_name.clone(),
            strength: item.strength.clone(),
            form: item.form.clone(),
            dose: item.dose.clone(),
            frequency: item.frequency.clone(),
            timing: item.timing.clone(),
            duration_days: item.duration_days,
            instructions: item.instructions.clone(),
        })
        .collect();
    write_items(tx, id, &items).await?;
    load(tx, id).await
}

/// Cancels an issued prescription with a reason and, when `reissue`, starts a corrected draft
/// copied from it that supersedes it.
///
/// # Errors
/// [`AppError::Denied`] without `prescriptions.issue`; [`AppError::NotFound`];
/// [`AppError::Conflict`] unless issued; [`AppError::Invalid`] without a reason.
pub async fn cancel(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PrescriptionId,
    reason: &str,
    reissue: bool,
    now: OffsetDateTime,
) -> Result<(RxView, Option<RxView>), AppError> {
    actor.require(Permission::PrescriptionsIssue)?;
    let reason = rules::reason(reason).map_err(rx("reason"))?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let (status, _) = dal::lock(tx.conn(), id.uuid())
            .await?
            .ok_or(AppError::NotFound("prescription"))?;
        if status != RxStatus::Issued.as_str() {
            return Err(AppError::Conflict(
                "only an issued prescription can be cancelled",
            ));
        }
        dal::cancel(
            tx.conn(),
            id.uuid(),
            &reason,
            now,
            actor.membership_id.uuid(),
        )
        .await?;
        let cancelled = load(tx, id.uuid()).await?;
        let draft = if reissue {
            Some(copy_as_draft(tx, &cancelled).await?)
        } else {
            None
        };
        let cancelled = load(tx, id.uuid()).await?;
        Ok((cancelled, draft))
    })
    .await
}

async fn record_view(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    view: &RxView,
    action: &str,
) -> Result<(), AppError> {
    let request_text = request_id.map(|id| id.to_string());
    access::record(
        tx.conn(),
        &access::DocumentAccess {
            actor_user_id: Some(actor.user_id.uuid()),
            actor_kind: STAFF.as_str(),
            patient_id: view.patient.id.uuid(),
            share_link_id: None,
            resource: "prescription",
            resource_id: view.id.uuid(),
            action,
            purpose: actor.access_purpose(),
            request_id: request_text.as_deref(),
        },
    )
    .await?;
    Ok(())
}

/// Opens a prescription with its print data, and writes the access record.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`; [`AppError::NotFound`].
pub async fn get(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    id: PrescriptionId,
) -> Result<RxView, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let view = load(tx, id.uuid()).await?;
        record_view(tx, actor, request_id, &view, "view").await?;
        Ok(view)
    })
    .await
}

/// The patient's prescriptions, newest first, without print data reads.
///
/// # Errors
/// [`AppError::Denied`] without `clinical.read`; [`AppError::NotFound`] for an unknown patient.
pub async fn for_patient(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    last_issued_only: bool,
) -> Result<Vec<RxView>, AppError> {
    actor.require(Permission::ClinicalRead)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        patients::get(tx.conn(), patient_id.uuid())
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let rows = dal::prescriptions(
            tx.conn(),
            &RxFilter {
                patient_id: Some(patient_id.uuid()),
                issued_only: last_issued_only,
                limit: if last_issued_only { 1 } else { 100 },
                ..RxFilter::default()
            },
        )
        .await?;
        let mut views = Vec::with_capacity(rows.len());
        for row in rows {
            views.push(load(tx, row.id).await?);
        }
        if let Some(view) = views.first().filter(|_| last_issued_only) {
            record_view(tx, actor, request_id, view, "view").await?;
        }
        Ok(views)
    })
    .await
}
