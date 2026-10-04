//! Why a use case failed, in terms the API can turn into a response.

use aarogyam_domain::access::Denied;
use aarogyam_domain::clinic::SettingsError;
use aarogyam_domain::patient::PatientError;
use sakalya_db::DbError;

/// A use case's failure. Messages never contain patient data.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// The caller may not do this.
    #[error("access denied: {0}")]
    Denied(Denied),
    /// The record doesn't exist in this clinic (or the caller may not know it exists).
    #[error("{0} not found")]
    NotFound(&'static str),
    /// The input failed validation.
    #[error("{field}: {message}")]
    Invalid {
        /// The field at fault, as the API names it.
        field: &'static str,
        /// What is wrong, without echoing the value.
        message: String,
    },
    /// The request conflicts with existing data (for example a taken subdomain).
    #[error("{0}")]
    Conflict(&'static str),
    /// A rule beyond the permission forbids it (only owners may make owners).
    #[error("forbidden: {0}")]
    Forbidden(&'static str),
    /// The database failed or refused.
    #[error(transparent)]
    Db(#[from] DbError),
    /// Something that should be impossible happened, such as a random number generator failure.
    #[error("internal error: {0}")]
    Internal(&'static str),
}

impl AppError {
    /// A validation failure on `field`.
    pub fn invalid(field: &'static str, error: impl std::fmt::Display) -> Self {
        Self::Invalid {
            field,
            message: error.to_string(),
        }
    }

    /// A patient-value validation failure, attributed to the field it concerns.
    #[must_use]
    pub fn patient(error: PatientError) -> Self {
        let field = match error {
            PatientError::Name => "full_name",
            PatientError::Prefix | PatientError::Number => "number",
            PatientError::BirthDate | PatientError::BirthDateAndAge => "date_of_birth",
            PatientError::Age => "age_years",
            PatientError::Email => "email",
            PatientError::Language => "preferred_language",
            PatientError::UnknownValue => "sex",
        };
        Self::invalid(field, error)
    }
}

impl AppError {
    /// A clinic-setting validation failure, attributed to the field it concerns.
    #[must_use]
    pub fn settings(error: SettingsError) -> Self {
        let field = match error {
            SettingsError::Name => "name",
            SettingsError::LegalName => "legal_name",
            SettingsError::Gstin => "gstin",
            SettingsError::Timezone => "timezone",
            SettingsError::BrandColor => "branding.brand",
            SettingsError::ThemeMode => "branding.mode",
            SettingsError::Footer => "prescription_footer",
            SettingsError::AddressLine => "address",
            SettingsError::Pincode => "address.pincode",
            SettingsError::Phone => "phone",
            SettingsError::UpiId => "upi_id",
        };
        Self::invalid(field, error)
    }
}

impl From<Denied> for AppError {
    fn from(denied: Denied) -> Self {
        Self::Denied(denied)
    }
}
