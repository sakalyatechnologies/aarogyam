//! Registering, finding and opening patients. Every function runs in one clinic transaction,
//! so row-level security limits it to the caller's clinic.

use aarogyam_dal::{clinic, patients};
use aarogyam_domain::access::ClinicActor;
use aarogyam_domain::ids::PatientId;
use aarogyam_domain::patient::{
    BirthDate, Email, Language, NewPatient, NumberPrefix, PatientNumber, PersonName, Sex,
};
use aarogyam_domain::permission::Permission;
use aarogyam_domain::search::PatientQuery;
use sakalya_db::{ActorKind, Db, Scope};
use sakalya_types::{CallingCode, PhoneE164};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::clock::clinic_today;
use crate::error::AppError;

// Evaluated at compile time: a bad literal fails the build, never a request.
const STAFF: ActorKind = match ActorKind::new("staff") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

/// Most results a search returns.
pub const MAX_RESULTS: i64 = 50;

/// The clinic transaction scope for a member's request.
fn scope(actor: &ClinicActor, request_id: Option<Uuid>) -> Scope {
    let scope = Scope::tenant(actor.clinic_id.uuid())
        .with_user(actor.user_id.uuid())
        .with_actor_kind(STAFF);
    match request_id {
        Some(id) => scope.with_request_id(id),
        None => scope,
    }
}

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

fn validate(input: &RegisterPatient, today: Date) -> Result<NewPatient, AppError> {
    let full_name = PersonName::parse(&input.full_name).map_err(AppError::patient)?;
    let sex = match &input.sex {
        Some(text) => Sex::parse(text).map_err(AppError::patient)?,
        None => Sex::Unknown,
    };
    let birth_date = match (input.date_of_birth, input.age_years) {
        (Some(_), Some(_)) => {
            return Err(AppError::patient(
                aarogyam_domain::patient::PatientError::BirthDateAndAge,
            ));
        }
        (Some(date), None) => Some(BirthDate::exact(date, today).map_err(AppError::patient)?),
        (None, Some(age)) => Some(BirthDate::from_age(age, today).map_err(AppError::patient)?),
        (None, None) => None,
    };
    let phone = input
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| PhoneE164::parse_with_default(text, CallingCode::INDIA))
        .transpose()
        .map_err(|error| AppError::invalid("phone", error))?;
    let email = input
        .email
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(Email::parse)
        .transpose()
        .map_err(AppError::patient)?;
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

fn mask_email(email: &str) -> String {
    match email.split_once('@') {
        Some((local, domain)) => {
            let first: String = local.chars().take(1).collect();
            format!("{first}***@{domain}")
        }
        None => "***".to_owned(),
    }
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
    let age_years = row.date_of_birth.map(|date| {
        if row.birth_date_estimated {
            BirthDate::Estimated(date).age_on(today)
        } else {
            BirthDate::Exact(date).age_on(today)
        }
    });
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
    }
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
        let prefix = NumberPrefix::parse(&profile.number_prefix).map_err(AppError::patient)?;
        let value = patients::next_number(tx.conn(), "patient").await?;
        let value =
            u64::try_from(value).map_err(|_| AppError::Internal("negative patient number"))?;
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
    })
    .await
}

/// Finds patients by what the front desk typed: a number (`SD-1042` or `1042`), a phone
/// number, or the start of a name, falling back to a fuzzy name match. An empty query lists
/// the most recently registered patients.
///
/// # Errors
/// [`AppError::Db`] on database failures.
pub async fn search(
    db: &Db,
    actor: &ClinicActor,
    request_id: Option<Uuid>,
    query: &str,
    limit: i64,
    now: OffsetDateTime,
) -> Result<Vec<PatientView>, AppError> {
    actor.require(Permission::PatientsRead)?;
    let limit = limit.clamp(1, MAX_RESULTS);
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let today = clinic_today(&profile.timezone, now);
        let rows = match PatientQuery::classify(query, CallingCode::INDIA) {
            None => patients::recent(tx.conn(), limit).await?,
            Some(PatientQuery::Number(number)) => {
                patients::find_by_number(tx.conn(), number.as_str())
                    .await?
                    .into_iter()
                    .collect()
            }
            Some(PatientQuery::NumberDigits(digits)) => {
                let number = format!("{}-{digits}", profile.number_prefix);
                patients::find_by_number(tx.conn(), &number)
                    .await?
                    .into_iter()
                    .collect()
            }
            Some(PatientQuery::Phone(phone)) => {
                patients::search_phone(tx.conn(), phone.as_e164(), limit).await?
            }
            Some(PatientQuery::NamePrefix(prefix)) => {
                let mut rows = patients::search_name_prefix(tx.conn(), &prefix, limit).await?;
                if rows.len() < 3 && prefix.chars().count() >= 3 {
                    let fuzzy_limit = i32::try_from(limit).unwrap_or(20);
                    let ids = patients::search_fuzzy(tx.conn(), &prefix, fuzzy_limit).await?;
                    let more: Vec<Uuid> = ids
                        .into_iter()
                        .filter(|id| !rows.iter().any(|row| row.id == *id))
                        .collect();
                    rows.extend(patients::get_many(tx.conn(), &more).await?);
                }
                rows
            }
        };
        Ok(rows
            .into_iter()
            .map(|row| view(row, actor, today))
            .collect())
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
    db.scoped(&scope(actor, request_id), async |tx| {
        let profile = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let row = patients::get(tx.conn(), patient_id.uuid())
            .await?
            .ok_or(AppError::NotFound("patient"))?;
        let request_text = request_id.map(|id| id.to_string());
        patients::record_access(
            tx.conn(),
            &patients::AccessEntry {
                actor_user_id: actor.user_id.uuid(),
                actor_kind: STAFF.as_str(),
                patient_id: row.id,
                resource: "chart",
                action: "view",
                purpose: actor.access_purpose(),
                request_id: request_text.as_deref(),
            },
        )
        .await?;
        Ok(view(row, actor, clinic_today(&profile.timezone, now)))
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
        let clinic = clinic::profile(tx.conn())
            .await?
            .ok_or(AppError::NotFound("clinic"))?;
        let display_name = clinic::display_name(tx.conn(), actor.user_id.uuid())
            .await?
            .unwrap_or_default();
        Ok(Session {
            clinic,
            display_name,
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

    #[test]
    fn emails_are_masked() {
        assert_eq!(mask_email("priya@example.in"), "p***@example.in");
        assert_eq!(mask_email("nonsense"), "***");
    }
}
