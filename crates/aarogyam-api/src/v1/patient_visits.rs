//! The patient app's visits: the same summary a clinic's visit link shows (treatments done, no
//! fees; the advice, the Plan of signed notes only; the prescription; the next follow-up and five
//! earlier visits by date and title), listed across the clinics the account is linked to.

use aarogyam_app::patient_visits::{self as app, VisitSummary as Summary};
use aarogyam_domain::ids::EncounterId;
use axum::Json;
use axum::extract::State;
use sakalya_http::ApiPath;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;
use crate::extract::PatientRequest;
use crate::failure::{ApiFailure, not_found};

/// A treatment done in the visit. No fee.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitTreatment {
    /// What was done.
    pub name: String,
    /// FDI tooth number.
    pub tooth: Option<i16>,
    /// Surfaces, such as `O`.
    pub surfaces: Vec<String>,
}

/// A medicine of the visit's prescription.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitRxItem {
    /// As printed.
    pub drug_name: String,
    /// Strength, such as `500 mg`.
    pub strength: Option<String>,
    /// Form, such as `tablet`.
    pub form: Option<String>,
    /// How much per dose.
    pub dose: String,
    /// `1-0-1`.
    pub frequency: String,
    /// `after_food`, and so on.
    pub timing: Option<String>,
    /// For how many days.
    pub duration_days: Option<i16>,
    /// In the prescription's language.
    pub instructions: Option<String>,
}

/// The prescription issued in the visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitPrescription {
    /// `RX-…`.
    pub number: String,
    /// The clinic day it was issued (`YYYY-MM-DD`).
    pub issued_on: String,
    /// The medicines in order.
    pub items: Vec<VisitRxItem>,
}

/// The next follow-up.
#[derive(Debug, Serialize, ToSchema)]
pub struct VisitFollowUp {
    /// The day it is due (`YYYY-MM-DD`).
    pub due_on: String,
    /// `follow_up`, `cleaning`, and so on.
    pub kind: String,
}

/// An earlier visit: the date and a title, nothing clinical.
#[derive(Debug, Serialize, ToSchema)]
pub struct EarlierVisit {
    /// The clinic day (`YYYY-MM-DD`).
    pub visited_on: String,
    /// The treatments done, or `Consultation`.
    pub title: String,
}

/// What a patient sees of one visit.
#[derive(Debug, Serialize, ToSchema)]
pub struct PatientVisitSummary {
    /// The visit.
    #[schema(value_type = String)]
    pub id: Uuid,
    /// The clinic the visit was at.
    #[schema(value_type = Option<String>)]
    pub clinic_id: Option<Uuid>,
    /// Readable number, such as `V-318`.
    pub number: String,
    /// The clinic's name.
    pub clinic_name: String,
    /// The clinic day (`YYYY-MM-DD`).
    pub visited_on: String,
    /// The doctor's name.
    pub doctor_name: Option<String>,
    /// What was done.
    pub treatments: Vec<VisitTreatment>,
    /// The Plan section of the visit's signed notes.
    pub advice: Option<String>,
    /// The issued prescription.
    pub prescription: Option<VisitPrescription>,
    /// The next follow-up.
    pub next_follow_up: Option<VisitFollowUp>,
    /// The last five visits before this one, newest first.
    pub earlier_visits: Vec<EarlierVisit>,
    /// Where a patient books again, on the clinic's host.
    pub booking_path: String,
}

fn summary(clinic_id: Option<Uuid>, value: Summary) -> PatientVisitSummary {
    PatientVisitSummary {
        id: value.id,
        clinic_id,
        number: value.number,
        clinic_name: value.clinic_name,
        visited_on: value.visited_on.to_string(),
        doctor_name: value.doctor_name,
        treatments: value
            .treatments
            .into_iter()
            .map(|row| VisitTreatment {
                name: row.name,
                tooth: row.tooth,
                surfaces: row.surfaces,
            })
            .collect(),
        advice: value.advice,
        prescription: value.prescription.map(|rx| VisitPrescription {
            number: rx.number,
            issued_on: rx.issued_on.to_string(),
            items: rx
                .items
                .into_iter()
                .map(|line| VisitRxItem {
                    drug_name: line.drug_name,
                    strength: line.strength,
                    form: line.form,
                    dose: line.dose,
                    frequency: line.frequency,
                    timing: line.timing,
                    duration_days: line.duration_days,
                    instructions: line.instructions,
                })
                .collect(),
        }),
        next_follow_up: value.next_follow_up.map(|row| VisitFollowUp {
            due_on: row.due_on.to_string(),
            kind: row.kind,
        }),
        earlier_visits: value
            .earlier_visits
            .into_iter()
            .map(|row| EarlierVisit {
                visited_on: row.visited_on.to_string(),
                title: row.title,
            })
            .collect(),
        booking_path: "/book".to_owned(),
    }
}

/// The patient's visits.
#[derive(Debug, Serialize, ToSchema)]
pub struct MyVisits {
    /// Newest first within each clinic, at most 25 per clinic.
    pub items: Vec<PatientVisitSummary>,
}

/// The patient's visits at every linked clinic, with the same summary as a link.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/visits",
    operation_id = "listMyVisits",
    tag = "patient",
    security(("bearer" = [])),
    responses(
        (status = 200, body = MyVisits),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "Not the app host")
    )
)]
pub(crate) async fn mine(
    State(state): State<AppState>,
    request: PatientRequest,
) -> Result<Json<MyVisits>, ApiFailure> {
    let access = &request.access;
    let found = app::list(
        state.db(),
        access,
        request.request_id,
        OffsetDateTime::now_utc(),
    )
    .await?;
    Ok(Json(MyVisits {
        items: found
            .into_iter()
            .map(|(index, value)| summary(Some(access.clinics[index].place.id.uuid()), value))
            .collect(),
    }))
}

/// One of the patient's visits.
#[utoipa::path(
    get,
    path = "/api/v1/me/patient/visits/{id}",
    operation_id = "getMyVisit",
    tag = "patient",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = PatientVisitSummary),
        (status = 401, description = "Not signed in"),
        (status = 404, description = "No such visit of this patient")
    )
)]
pub(crate) async fn mine_one(
    State(state): State<AppState>,
    request: PatientRequest,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Json<PatientVisitSummary>, ApiFailure> {
    let access = &request.access;
    let now = OffsetDateTime::now_utc();
    for clinic in &access.clinics {
        let found = app::get(
            state.db(),
            access,
            clinic,
            request.request_id,
            EncounterId::from_uuid(id),
            now,
        )
        .await?;
        if let Some(value) = found {
            return Ok(Json(summary(Some(clinic.place.id.uuid()), value)));
        }
    }
    Err(ApiFailure::Error(not_found()))
}
