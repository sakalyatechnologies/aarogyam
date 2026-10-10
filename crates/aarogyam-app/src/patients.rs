//! Registering, finding and opening patients. Every function runs in one clinic transaction,
//! so row-level security limits it to the caller's clinic.

use aarogyam_dal::{clinic, patients};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::patient::{
    BirthDate, Email, Language, NewPatient, NumberPrefix, PatientError, PatientNumber, PersonName,
    Sex,
};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::search::PatientQuery;
use sakalya_db::{Db, ScopedTx};
use sakalya_types::{CallingCode, PhoneE164};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::{clinic_today, day_bounds};
use crate::error::AppError;
use crate::scope::staff_scope as scope;

/// Most results a search returns.
pub const MAX_RESULTS: i64 = 50;

/// A patient as the API shows it. Contact details are masked unless the member's role has
/// `patients.contact`.
#[derive(Debug, Clone)]
pub struct PatientView {
    /// Identifier.
    pub id: PatientId,
    /// Readable number, such as `SD-1042`.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Date of birth, exact or estimated.
    pub date_of_birth: Option<Date>,
    /// Whether the date of birth was estimated from an age.
    pub birth_date_estimated: bool,
    /// Age in whole years today, in the clinic's time zone.
    pub age_years: Option<u16>,
    /// Phone, masked (`+91******3210`) without `patients.contact`.
    pub phone: Option<String>,
    /// Email, masked (`p***@example.in`) without `patients.contact`.
    pub email: Option<String>,
    /// Language tag.
    pub preferred_language: String,
    /// `active`, `inactive`, `deceased` or `merged`.
    pub status: String,
    /// When the record was created.
    pub created_at: OffsetDateTime,
    /// The last visit, once visits exist.
    pub last_visit_at: Option<OffsetDateTime>,
    /// Goes up when the details change; send it back as `If-Match` when editing.
    pub row_version: i64,
    /// The next booked or confirmed appointment, when summaries were loaded.
    pub next_appointment: Option<NextAppointment>,
    /// Owed on issued bills; only with `billing.read`.
    pub balance_paise: Option<i64>,
    /// Received in total; only with `billing.read`.
    pub lifetime_paid_paise: Option<i64>,
    /// Whether an open recall is due.
    pub recall_due: bool,
}

/// A patient's next booking.
#[derive(Debug, Clone)]
pub struct NextAppointment {
    /// When it starts.
    pub starts_at: OffsetDateTime,
    /// The practitioner's display name.
    pub practitioner: String,
}

/// Which patients the list shows; see [`aarogyam_dal::patients::ListFilter`].
#[derive(Debug, Clone, Copy, Default)]
pub struct PatientFilter {
    /// Only patients with a balance (needs `billing.read`).
    pub with_balance: bool,
    /// Only patients with an open recall due on or before today.
    pub recalls_due: bool,
    /// Only patients registered this month, in the clinic's time zone.
    pub new_this_month: bool,
}

impl PatientFilter {
    const fn is_empty(self) -> bool {
        !(self.with_balance || self.recalls_due || self.new_this_month)
    }
}

/// Input for registering a patient, as received; validated here.
#[derive(Debug, Clone, Default)]
pub struct RegisterPatient {
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`; `unknown` when absent.
    pub sex: Option<String>,
    /// Date of birth, when known.
    pub date_of_birth: Option<Date>,
    /// Age in years, when the date of birth is unknown.
    pub age_years: Option<u16>,
    /// Phone in any common Indian format; +91 is assumed when there's no country code.
    pub phone: Option<String>,
    /// Email.
    pub email: Option<String>,
    /// Language tag such as `hi-IN`; `en-IN` when absent.
    pub preferred_language: Option<String>,
}

fn parse_birth_date(
    date_of_birth: Option<Date>,
    age_years: Option<u16>,
    today: Date,
) -> Result<Option<BirthDate>, AppError> {
    match (date_of_birth, age_years) {
        (Some(_), Some(_)) => Err(AppError::patient(PatientError::BirthDateAndAge)),
        (Some(date), None) => Ok(Some(
            BirthDate::exact(date, today).map_err(AppError::patient)?,
        )),
        (None, Some(age)) => Ok(Some(
            BirthDate::from_age(age, today).map_err(AppError::patient)?,
        )),
        (None, None) => Ok(None),
    }
}

/// A phone in any common Indian format; empty means none.
pub(crate) fn parse_phone(text: &str) -> Result<Option<PhoneE164>, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    PhoneE164::parse_with_default(text, CallingCode::INDIA)
        .map(Some)
        .map_err(|error| AppError::invalid("phone", error))
}

/// An email; empty means none.
fn parse_email(text: &str) -> Result<Option<Email>, AppError> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(None);
    }
    Email::parse(text).map(Some).map_err(AppError::patient)
}

pub(crate) fn validate(input: &RegisterPatient, today: Date) -> Result<NewPatient, AppError> {
    let full_name = PersonName::parse(&input.full_name).map_err(AppError::patient)?;
    let sex = match &input.sex {
        Some(text) => Sex::parse(text).map_err(AppError::patient)?,
        None => Sex::Unknown,
    };
    let birth_date = parse_birth_date(input.date_of_birth, input.age_years, today)?;
    let phone = input
        .phone
        .as_deref()
        .map(parse_phone)
        .transpose()?
        .flatten();
    let email = input
        .email
        .as_deref()
        .map(parse_email)
        .transpose()?
        .flatten();
    let preferred_language = match &input.preferred_language {
        Some(text) => Language::parse(text).map_err(AppError::patient)?,
        None => Language::english_india(),
    };
    Ok(NewPatient {
        full_name,
        sex,
        birth_date,
        phone,
        email,
        preferred_language,
    })
}

/// Changes to a patient's details, as received. `None` leaves a field as it is. An empty phone
/// or email clears it; `Some(None)` clears the date of birth.
#[derive(Debug, Clone, Default)]
pub struct EditPatient {
    /// Full name.
    pub full_name: Option<String>,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: Option<String>,
    /// Date of birth; `Some(None)` clears it.
    pub date_of_birth: Option<Option<Date>>,
    /// Age in years, when the date of birth is unknown.
    pub age_years: Option<u16>,
    /// Phone; needs `patients.contact`.
    pub phone: Option<String>,
    /// Email; needs `patients.contact`.
    pub email: Option<String>,
    /// Language tag such as `hi-IN`.
    pub preferred_language: Option<String>,
}

impl EditPatient {
    /// Whether the edit touches contact details, which needs `patients.contact`. Presence is
    /// what counts, not difference: otherwise a member who sees masked numbers could test
    /// guesses against the stored value.
    #[must_use]
    pub const fn touches_contact(&self) -> bool {
        self.phone.is_some() || self.email.is_some()
    }
}

/// A patient's details after an edit, validated like a registration.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Edited {
    full_name: String,
    sex: String,
    date_of_birth: Option<Date>,
    birth_date_estimated: bool,
    phone_e164: Option<String>,
    email: Option<String>,
    preferred_language: String,
}

fn apply_edit(
    current: &patients::PatientRow,
    edit: &EditPatient,
    today: Date,
) -> Result<Edited, AppError> {
    let full_name = match &edit.full_name {
        Some(text) => PersonName::parse(text)
            .map_err(AppError::patient)?
            .as_str()
            .to_owned(),
        None => current.full_name.clone(),
    };
    let sex = match &edit.sex {
        Some(text) => Sex::parse(text)
            .map_err(AppError::patient)?
            .as_str()
            .to_owned(),
        None => current.sex.clone(),
    };
    let (date_of_birth, birth_date_estimated) = match (edit.date_of_birth, edit.age_years) {
        (None, None) => (current.date_of_birth, current.birth_date_estimated),
        (Some(None), None) => (None, false),
        (date, age) => {
            let birth_date = parse_birth_date(date.flatten(), age, today)?;
            (
                birth_date.map(BirthDate::date),
                birth_date.is_some_and(BirthDate::is_estimated),
            )
        }
    };
    let phone_e164 = match &edit.phone {
        Some(text) => parse_phone(text)?.map(|phone| phone.as_e164().to_owned()),
        None => current.phone_e164.clone(),
    };
    let email = match &edit.email {
        Some(text) => parse_email(text)?.map(|email| email.as_str().to_owned()),
        None => current.email.clone(),
    };
    let preferred_language = match &edit.preferred_language {
        Some(text) => Language::parse(text)
            .map_err(AppError::patient)?
            .as_str()
            .to_owned(),
        None => current.preferred_language.clone(),
    };
    Ok(Edited {
        full_name,
        sex,
        date_of_birth,
        birth_date_estimated,
        phone_e164,
        email,
        preferred_language,
    })
}

pub(crate) fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let first: String = local.chars().take(1).collect();
            format!("{first}***@{domain}")
        }
        None => "***".to_owned(),
    }
}

/// Age in whole years on `today`, from an exact or estimated date of birth.
pub(crate) fn age_on(date_of_birth: Option<Date>, estimated: bool, today: Date) -> Option<u16> {
    date_of_birth.map(|date| {
        if estimated {
            BirthDate::Estimated(date).age_on(today)
        } else {
            BirthDate::Exact(date).age_on(today)
        }
    })
}

fn view(row: patients::PatientRow, actor: &ClinicActor, today: Date) -> PatientView {
    let contact = actor.permissions.allows(Permission::PatientsContact);
    let phone = row.phone_e164.map(|raw| {
        if contact {
            raw
        } else {
            PhoneE164::parse(&raw).map_or_else(|_| "***".to_owned(), |phone| phone.masked())
        }
    });
    let email = row
        .email
        .map(|raw| if contact { raw } else { mask_email(&raw) });
    let age_years = age_on(row.date_of_birth, row.birth_date_estimated, today);
    PatientView {
        id: PatientId::from_uuid(row.id),
        number: row.number,
        full_name: row.full_name,
        sex: row.sex,
        date_of_birth: row.date_of_birth,
        birth_date_estimated: row.birth_date_estimated,
        age_years,
        phone,
        email,
        preferred_language: row.preferred_language,
        status: row.status,
        created_at: row.created_at,
        last_visit_at: row.last_visit_at,
        row_version: row.row_version,
        next_appointment: None,
        balance_paise: None,
        lifetime_paid_paise: None,
        recall_due: false,
    }
}

/// The patient as the API shows it, with the summary read beside it. Money shows only with
/// `billing.read`.
fn listed(row: patients::ListedPatient, actor: &ClinicActor, today: Date) -> PatientView {
    let (row, summary) = row.into_parts();
    let money = actor.permissions.allows(Permission::BillingRead);
    let mut view = view(row, actor, today);
    view.next_appointment =
        summary
            .next_starts_at
            .zip(summary.next_practitioner)
            .map(|(starts_at, practitioner)| NextAppointment {
                starts_at,
                practitioner,
            });
    view.recall_due = summary.recall_due;
    if money {
        view.balance_paise = Some(summary.balance_paise);
        view.lifetime_paid_paise = Some(summary.lifetime_paid_paise);
    }
    view
}

/// Registers a patient: validates, issues the clinic's next number, saves.
///
/// # Errors
/// [`AppError::Invalid`] for bad input; [`AppError::Db`] on database failures.
pub async fn register(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    input: RegisterPatient,
    now: OffsetDateTime,
) -> Result<PatientView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let today = clinic_today(&profile.timezone, now);
        let patient = validate(&input, today)?;
        insert_new(tx, &profile.number_prefix, &patient, actor, today).await
    })
    .await
}

/// A registered patient within the member's `patients.read` reach, inside an open transaction.
pub(crate) async fn existing(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    patient_id: PatientId,
    today: Date,
) -> Result<PatientView, AppError> {
    let reach = actor.reach(Permission::PatientsRead).member();
    let row = patients::get(tx.conn(), patient_id.uuid(), reach)
        .await?
        .ok_or(AppError::NotFound("patient"))?;
    Ok(view(row, actor, today))
}

/// Issues the clinic's next number and saves a validated patient, inside an open transaction.
pub(crate) async fn insert_new(
    tx: &mut ScopedTx,
    number_prefix: &str,
    patient: &NewPatient,
    actor: &ClinicActor,
    today: Date,
) -> Result<PatientView, AppError> {
    let prefix = NumberPrefix::parse(number_prefix).map_err(AppError::patient)?;
    let value = patients::next_number(tx.conn(), "patient").await?;
    let value = u64::try_from(value).map_err(|_| AppError::Internal("negative patient number"))?;
    let number = PatientNumber::new(&prefix, value);
    let row = patients::insert(
        tx.conn(),
        &patients::NewPatientRow {
            id: PatientId::new_v7().uuid(),
            number: number.as_str(),
            full_name: patient.full_name.as_str(),
            sex: patient.sex.as_str(),
            date_of_birth: patient.birth_date.map(BirthDate::date),
            birth_date_estimated: patient.birth_date.is_some_and(BirthDate::is_estimated),
            phone_e164: patient.phone.as_ref().map(PhoneE164::as_e164),
            email: patient.email.as_ref().map(Email::as_str),
            preferred_language: patient.preferred_language.as_str(),
        },
    )
    .await?;
    Ok(view(row, actor, today))
}

/// Edits a patient's details with the same rules as registration. Changing the phone or email
/// also needs `patients.contact`. The change history records what changed. With
/// `expected_version` (the `row_version` the client last saw), an edit of a record that has
/// changed since is refused.
///
/// # Errors
/// [`AppError::Denied`] without the permissions; [`AppError::NotFound`] when the patient isn't
/// in this clinic; [`AppError::Stale`] when `expected_version` is out of date;
/// [`AppError::Invalid`] for bad input; [`AppError::Db`] on database failures.
pub async fn edit(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    input: EditPatient,
    expected_version: Option<i64>,
    now: OffsetDateTime,
) -> Result<PatientView, AppError> {
    actor.require(Permission::PatientsWrite)?;
    if input.touches_contact() {
        actor.require(Permission::PatientsContact)?;
    }
    db.scoped(&scope(actor, request_id), async |tx| {
        let today = clinic_today(&actor.timezone, now);
        edit_in(tx, actor, patient_id, &input, expected_version, today).await
    })
    .await
}

/// Applies [`edit`] inside an open transaction; the caller has checked the permissions.
pub(crate) async fn edit_in(
    tx: &mut ScopedTx,
    actor: &ClinicActor,
    patient_id: PatientId,
    input: &EditPatient,
    expected_version: Option<i64>,
    today: Date,
) -> Result<PatientView, AppError> {
    // The edit answers with the record, so it reaches only patients the member can read.
    let reach = actor.reach(Permission::PatientsRead).member();
    let current = patients::get_for_update(tx.conn(), patient_id.uuid(), reach)
        .await?
        .ok_or(AppError::NotFound("patient"))?;
    AppError::check_version(expected_version, current.row_version)?;
    let edited = apply_edit(&current, input, today)?;
    let row = patients::update(
        tx.conn(),
        current.id,
        &patients::PatientDetails {
            full_name: &edited.full_name,
            sex: &edited.sex,
            date_of_birth: edited.date_of_birth,
            birth_date_estimated: edited.birth_date_estimated,
            phone_e164: edited.phone_e164.as_deref(),
            email: edited.email.as_deref(),
            preferred_language: &edited.preferred_language,
        },
    )
    .await?;
    Ok(view(row, actor, today))
}

/// Finds patients by what the front desk typed: a number (`SD-1042` or `1042`), a phone
/// number or its last four or more digits, or a name: its start, the start of any of its
/// words, then (from three letters) any part of it, falling back to a fuzzy match. An empty query lists
/// the most recently registered patients.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn search(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    query: &str,
    filter: PatientFilter,
    limit: i64,
    now: OffsetDateTime,
) -> Result<Vec<PatientView>, AppError> {
    actor.require(Permission::PatientsRead)?;
    if filter.with_balance {
        actor.require(Permission::BillingRead)?;
    }
    let limit = limit.clamp(1, MAX_RESULTS);
    let today = clinic_today(&actor.timezone, now);
    let at = patients::SummaryAt { now, today };
    let created_since = filter
        .new_this_month
        .then(|| day_bounds(&actor.timezone, today.replace_day(1).unwrap_or(today)).0);
    let list_filter = patients::ListFilter {
        with_balance: filter.with_balance,
        recalls_due: filter.recalls_due,
        created_since,
    };
    let reach = actor.reach(Permission::PatientsRead).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows = match PatientQuery::classify(query, CallingCode::INDIA) {
            None if filter.is_empty() => patients::recent(tx.conn(), limit, at, reach).await?,
            None => patients::recent_filtered(tx.conn(), &list_filter, limit, at, reach).await?,
            Some(PatientQuery::Number(number)) => {
                patients::find_by_number(tx.conn(), number.as_str(), at, reach)
                    .await?
                    .into_iter()
                    .collect()
            }
            Some(PatientQuery::Digits { number, phone_tail }) => {
                // The patient with that number first, then phones ending in the digits.
                let mut rows = match number {
                    Some(digits) => {
                        let number = format!("{}-{digits}", actor.number_prefix);
                        patients::find_by_number(tx.conn(), &number, at, reach)
                            .await?
                            .into_iter()
                            .collect()
                    }
                    None => Vec::new(),
                };
                if let Some(tail) = phone_tail {
                    let by_phone =
                        patients::search_phone_tail(tx.conn(), tail.as_str(), limit, at, reach)
                            .await?;
                    rows.extend(
                        by_phone
                            .into_iter()
                            .filter(|row| rows.iter().all(|r| r.id != row.id))
                            .collect::<Vec<_>>(),
                    );
                    rows.truncate(usize::try_from(limit).unwrap_or(usize::MAX));
                }
                rows
            }
            Some(PatientQuery::Phone(phone)) => {
                patients::search_phone(tx.conn(), phone.as_e164(), limit, at, reach).await?
            }
            Some(PatientQuery::NamePrefix(prefix)) => {
                // Substrings and close spellings only from three letters; two match too much.
                let loose = prefix.chars().count() >= 3;
                patients::search_name(tx.conn(), &prefix, limit, loose, at, reach).await?
            }
        };
        let mut views: Vec<PatientView> = rows
            .into_iter()
            .filter(|row| created_since.is_none_or(|since| row.created_at >= since))
            .map(|row| listed(row, actor, today))
            .collect();
        if !query.trim().is_empty() {
            views.retain(|view| {
                (!filter.with_balance || view.balance_paise.is_some_and(|b| b > 0))
                    && (!filter.recalls_due || view.recall_due)
            });
        }
        Ok(views)
    })
    .await
}

/// Opens a patient's record and writes the access record in the same transaction.
///
/// # Errors
/// [`AppError::NotFound`] when the patient isn't in this clinic; [`AppError::Db`] on failures.
pub async fn open(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    patient_id: PatientId,
    now: OffsetDateTime,
) -> Result<PatientView, AppError> {
    actor.require(Permission::PatientsRead)?;
    let today = clinic_today(&actor.timezone, now);
    db.scoped(&scope(actor, request_id), async |tx| {
        let request_text = request_id.map(|id| id.to_string());
        let row = patients::open(
            tx.conn(),
            patient_id.uuid(),
            &patients::AccessEntry {
                actor_user_id: actor.user_id.uuid(),
                actor_kind: crate::scope::actor_kind(actor).as_str(),
                patient_id: patient_id.uuid(),
                resource: "chart",
                action: "view",
                purpose: actor.access_purpose(),
                request_id: request_text.as_deref(),
            },
            patients::SummaryAt { now, today },
            actor.reach(Permission::PatientsRead).member(),
        )
        .await?
        .ok_or(AppError::NotFound("patient"))?;
        Ok(listed(row, actor, today))
    })
    .await
}

/// The clinic, member and permissions for the portal's session screen.
#[derive(Debug, Clone)]
pub struct Session {
    /// The clinic's profile.
    pub clinic: clinic::ClinicProfile,
    /// The member's display name.
    pub display_name: String,
    /// The member's avatar at this clinic.
    pub avatar: aarogyam_dal::avatars::AvatarRow,
}

/// Loads what the portal shows about the current clinic and member.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn session(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
) -> Result<Session, AppError> {
    db.scoped(&scope(actor, request_id), async |tx| {
        let (clinic, display_name, avatar) = clinic::session(tx.conn(), actor.user_id.uuid())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let display_name = display_name.unwrap_or_default();
        Ok(Session {
            clinic,
            display_name,
            avatar,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn validation_names_the_field() {
        let today = date!(2026 - 10 - 03);
        let input = RegisterPatient {
            full_name: "  Priya Sharma ".into(),
            age_years: Some(36),
            phone: Some("98765 43210".into()),
            ..RegisterPatient::default()
        };
        let patient = validate(&input, today).unwrap();
        assert_eq!(patient.full_name.as_str(), "Priya Sharma");
        assert_eq!(patient.phone.unwrap().as_e164(), "+919876543210");
        assert!(patient.birth_date.unwrap().is_estimated());

        let both = RegisterPatient {
            full_name: "A B".into(),
            date_of_birth: Some(date!(1990 - 01 - 01)),
            age_years: Some(36),
            ..RegisterPatient::default()
        };
        assert!(matches!(
            validate(&both, today),
            Err(AppError::Invalid {
                field: "date_of_birth",
                ..
            })
        ));
        let bad_phone = RegisterPatient {
            full_name: "A B".into(),
            phone: Some("12".into()),
            ..RegisterPatient::default()
        };
        assert!(matches!(
            validate(&bad_phone, today),
            Err(AppError::Invalid { field: "phone", .. })
        ));
    }

    fn stored() -> patients::PatientRow {
        patients::PatientRow {
            id: Uuid::nil(),
            number: "AD-1".into(),
            full_name: "Priya Sharma".into(),
            sex: "female".into(),
            date_of_birth: Some(date!(1990 - 05 - 01)),
            birth_date_estimated: false,
            phone_e164: Some("+919876543210".into()),
            email: Some("priya@example.in".into()),
            preferred_language: "en-IN".into(),
            status: "active".into(),
            created_at: OffsetDateTime::UNIX_EPOCH,
            last_visit_at: None,
            row_version: 1,
        }
    }

    #[test]
    fn edits_change_only_what_was_given() {
        let today = date!(2026 - 10 - 03);
        let current = stored();
        let unchanged = apply_edit(&current, &EditPatient::default(), today).unwrap();
        assert_eq!(unchanged.full_name, "Priya Sharma");
        assert_eq!(unchanged.phone_e164.as_deref(), Some("+919876543210"));
        assert_eq!(unchanged.date_of_birth, Some(date!(1990 - 05 - 01)));

        let edit = EditPatient {
            full_name: Some(" Priya  S ".into()),
            age_years: Some(40),
            phone: Some(String::new()),
            email: Some("P@Example.in".into()),
            preferred_language: Some("hi-IN".into()),
            ..EditPatient::default()
        };
        assert!(edit.touches_contact());
        let edited = apply_edit(&current, &edit, today).unwrap();
        assert_eq!(edited.full_name, "Priya S");
        assert!(edited.birth_date_estimated);
        assert_eq!(edited.phone_e164, None);
        assert_eq!(edited.email.as_deref(), Some("p@example.in"));
        assert_eq!(edited.preferred_language, "hi-IN");
        assert_eq!(edited.sex, "female");

        let cleared = EditPatient {
            date_of_birth: Some(None),
            ..EditPatient::default()
        };
        assert!(!cleared.touches_contact());
        let edited = apply_edit(&current, &cleared, today).unwrap();
        assert_eq!(
            (edited.date_of_birth, edited.birth_date_estimated),
            (None, false)
        );
    }

    #[test]
    fn edits_are_validated_like_registrations() {
        let today = date!(2026 - 10 - 03);
        let current = stored();
        let cases = [
            (
                EditPatient {
                    full_name: Some("  ".into()),
                    ..EditPatient::default()
                },
                "full_name",
            ),
            (
                EditPatient {
                    sex: Some("robot".into()),
                    ..EditPatient::default()
                },
                "sex",
            ),
            (
                EditPatient {
                    date_of_birth: Some(Some(date!(2030 - 01 - 01))),
                    ..EditPatient::default()
                },
                "date_of_birth",
            ),
            (
                EditPatient {
                    date_of_birth: Some(Some(date!(1990 - 01 - 01))),
                    age_years: Some(30),
                    ..EditPatient::default()
                },
                "date_of_birth",
            ),
            (
                EditPatient {
                    phone: Some("12".into()),
                    ..EditPatient::default()
                },
                "phone",
            ),
            (
                EditPatient {
                    preferred_language: Some("english".into()),
                    ..EditPatient::default()
                },
                "preferred_language",
            ),
        ];
        for (edit, field) in cases {
            match apply_edit(&current, &edit, today) {
                Err(AppError::Invalid { field: got, .. }) => assert_eq!(got, field),
                other => panic!("{field}: {other:?}"),
            }
        }
    }

    #[test]
    fn emails_are_masked() {
        assert_eq!(mask_email("priya@example.in"), "p***@example.in");
        assert_eq!(mask_email("nonsense"), "***");
    }
}

/// Most matches a phone lookup returns.
pub const MAX_PHONE_MATCHES: i64 = 10;

/// A patient whose phone matches, with only what the desk needs to recognise them.
#[derive(Debug, Clone)]
pub struct PhoneMatch {
    /// Identifier.
    pub id: PatientId,
    /// Readable number, such as `SD-1042`.
    pub number: String,
    /// Full name.
    pub full_name: String,
    /// `female`, `male`, `other` or `unknown`.
    pub sex: String,
    /// Age in whole years today.
    pub age_years: Option<u16>,
}

/// Patients already registered with this phone (main or second number), so the desk can pick
/// "this is them" before registering someone new. Families share numbers: there may be several.
///
/// # Errors
/// [`AppError::Invalid`] for a phone that isn't one; [`AppError::Db`] on database failures.
pub async fn lookup_phone(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    phone: &str,
    now: OffsetDateTime,
) -> Result<Vec<PhoneMatch>, AppError> {
    actor.require(Permission::PatientsRead)?;
    let phone = parse_phone(phone)?.ok_or(AppError::invalid("phone", "is required"))?;
    let today = clinic_today(&actor.timezone, now);
    let reach = actor.reach(Permission::PatientsRead).member();
    db.scoped(&scope(actor, request_id), async |tx| {
        let rows =
            patients::lookup_phone(tx.conn(), phone.as_e164(), MAX_PHONE_MATCHES, reach).await?;
        Ok(rows
            .into_iter()
            .map(|row| PhoneMatch {
                id: PatientId::from_uuid(row.id),
                number: row.number,
                full_name: row.full_name,
                sex: row.sex,
                age_years: age_on(row.date_of_birth, row.birth_date_estimated, today),
            })
            .collect())
    })
    .await
}
