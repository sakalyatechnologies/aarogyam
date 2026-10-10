//! A person's own profile: their name and phone, edited by themselves. The data is the person's
//! across every clinic they belong to, so it needs a sign-in and no clinic; the database
//! function behind it only ever touches the caller's own row and the change history records
//! them as the actor.

use aarogyam_dal::lookups::{self as dal, MyProfile};
use aarogyam_domain::patient::PersonName;
use sakalya_db::Db;
use sakalya_types::{CallingCode, PhoneE164};
use uuid::Uuid;

use crate::error::AppError;

/// The person's own name and phone.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Profile {
    /// Their name.
    pub display_name: String,
    /// Their phone in `E.164`, if recorded.
    pub phone: Option<String>,
}

impl From<MyProfile> for Profile {
    fn from(profile: MyProfile) -> Self {
        Self {
            display_name: profile.display_name,
            phone: profile.phone_e164,
        }
    }
}

/// What the person changes; what is left out stays.
#[derive(Debug, Clone, Default)]
pub struct ProfileChanges {
    /// Their name, 1 to 200 characters.
    pub display_name: Option<String>,
    /// Their phone; +91 is assumed without a country code, and an empty string clears it.
    pub phone: Option<String>,
}

/// The person's own profile.
///
/// # Errors
/// [`AppError::NotFound`] for an unknown or disabled person; [`AppError::Db`] on failures.
pub async fn get(db: &Db, auth_uid: Uuid) -> Result<Profile, AppError> {
    dal::my_profile(db.pool(), auth_uid)
        .await?
        .map(Profile::from)
        .ok_or(AppError::NotFound("profile"))
}

/// Changes the person's own name and/or phone, checking both first.
///
/// # Errors
/// [`AppError::Invalid`] naming `display_name` or `phone`; [`AppError::Conflict`] when another
/// account holds the phone; [`AppError::NotFound`] for an unknown or disabled person.
pub async fn update(db: &Db, auth_uid: Uuid, changes: ProfileChanges) -> Result<Profile, AppError> {
    let name = changes
        .display_name
        .as_deref()
        .map(PersonName::parse)
        .transpose()
        .map_err(|error| AppError::invalid("display_name", error))?;
    // `None`: leave the phone; `Some(None)`: clear it; `Some(Some(_))`: set it.
    let phone = changes
        .phone
        .as_deref()
        .map(|text| {
            if text.trim().is_empty() {
                Ok(None)
            } else {
                PhoneE164::parse_with_default(text, CallingCode::INDIA)
                    .map(|phone| Some(phone.as_e164().to_owned()))
                    .map_err(|_| AppError::invalid("phone", "is not a valid phone number"))
            }
        })
        .transpose()?;
    dal::update_my_profile(
        db.pool(),
        auth_uid,
        name.as_ref().map(PersonName::as_str),
        phone.is_some(),
        phone.as_ref().and_then(Option::as_deref),
    )
    .await
    .map_err(|error| {
        if error.constraint() == Some("users_phone_e164_key") {
            AppError::Conflict("that phone number belongs to another account")
        } else {
            AppError::Db(error)
        }
    })?
    .map(Profile::from)
    .ok_or(AppError::NotFound("profile"))
}
