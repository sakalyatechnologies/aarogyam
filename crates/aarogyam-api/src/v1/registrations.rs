//! Clinic registration from the public landing page. No sign-in: anyone may apply, so the
//! route is throttled hard per IP and answers the same `202` whatever happened to the
//! application, never revealing whether the address applied before or already uses Aarogyam.

use aarogyam_app::onboarding::{self as app, Registration};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::ApiJson;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::AppState;
use crate::failure::ApiFailure;

/// A clinic asking to join.
#[derive(Debug, Deserialize, ToSchema)]
pub struct NewRegistration {
    /// The clinic's name.
    pub clinic_name: String,
    /// Its city.
    pub city: String,
    /// `dental` (default) or `general`.
    pub specialty: Option<String>,
    /// Who we should contact.
    pub contact_name: String,
    /// Their email; the owner's invitation goes there once approved.
    pub email: String,
    /// Their phone number.
    pub phone: Option<String>,
    /// Anything they want to tell us.
    pub message: Option<String>,
}

/// The one answer to a valid application.
#[derive(Debug, Serialize, ToSchema)]
pub struct RegistrationReceived {
    /// Always `received`.
    pub status: &'static str,
    /// What happens next.
    pub message: &'static str,
}

/// Applies to join Aarogyam (public, throttled per IP).
#[utoipa::path(
    post,
    path = "/api/v1/registrations",
    operation_id = "submitRegistration",
    tag = "registration",
    request_body = NewRegistration,
    responses(
        (status = 202, body = RegistrationReceived, description = "Received; the same answer every time"),
        (status = 400, description = "Invalid input; the message names the field"),
        (status = 429, description = "Too many applications from this address")
    )
)]
pub(crate) async fn register(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<NewRegistration>,
) -> Result<(StatusCode, Json<RegistrationReceived>), ApiFailure> {
    app::register(
        state.db(),
        Registration {
            clinic_name: body.clinic_name,
            city: body.city,
            specialty: body.specialty,
            contact_name: body.contact_name,
            email: body.email,
            phone: body.phone,
            message: body.message,
        },
    )
    .await?;
    tracing::info!("clinic application received");
    Ok((
        StatusCode::ACCEPTED,
        Json(RegistrationReceived {
            status: "received",
            message: "Thank you. We will email you within two working days.",
        }),
    ))
}
