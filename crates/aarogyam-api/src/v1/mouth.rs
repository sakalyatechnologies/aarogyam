//! The mouth snapshot of a visit (docs/plans/visit-story-v2-offers-design.md, section 1.12): the
//! doctor's Present mode reads it here, and the patient's visit page gets the same JSON as its
//! `chart`. One server builder; clients only render it. An allowlist: no notes, no clinic-typed
//! labels, no names, and no clinic or dentist for work done elsewhere.

use aarogyam_app::mouth as app;
use aarogyam_domain::ids::EncounterId;
use aarogyam_domain::mouth as domain;
use aarogyam_domain::permission::require::ClinicalRead;
use axum::Json;
use axum::extract::State;
use axum::http::{HeaderValue, header};
use axum::response::{IntoResponse, Response};
use sakalya_http::ApiPath;
use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;
use crate::extract::Require;
use crate::failure::ApiFailure;

fn day(date: time::Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

/// The patient's mouth: every position to draw, the teeth with anything to show, and the next
/// booked visit. Sound teeth are implied.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthSnapshot {
    /// The story contract the page and video follow (an integer; bumped when scenes change).
    pub story_version: u32,
    /// `adult`, `child` or `mixed`. A plain string, never a strict enum: render unknown values
    /// as `adult`.
    pub dentition: String,
    /// Every tooth position to draw, in quadrant order.
    pub positions: Vec<MouthPosition>,
    /// The teeth with a finding, health level, detail, work, treatment, plan or something today.
    pub teeth: Vec<MouthTooth>,
    /// Up to three key teeth for the story: treated today, then planned and needing treatment,
    /// then found.
    pub focus: Vec<u8>,
    /// The patient's next booked visit (`YYYY-MM-DD`), shown once on the overview.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_visit: Option<String>,
}

/// One tooth position to draw.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthPosition {
    /// FDI quadrant of the drawn tooth (5 to 8 for a primary tooth).
    pub quadrant: u8,
    /// Position 1 to 8 from the midline.
    pub index: u8,
    /// The FDI tooth drawn there.
    pub tooth: u8,
    /// `tooth` (listed in `teeth`), `sound`, or `not_recorded` (mixed dentition, nothing
    /// charted: a neutral outline labelled "Not recorded", never sound).
    pub shown: String,
    /// The other tooth charted at this position (mixed dentition), for tooth detail ("Milk
    /// tooth 55: caries", "Permanent 15: missing").
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub other: Option<MouthOtherTooth>,
}

/// The tooth not drawn at a mixed position.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthOtherTooth {
    /// FDI tooth.
    pub tooth: u8,
    /// Its headline finding, or `sound`.
    pub finding: String,
}

/// One tooth with what is recorded on it.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthTooth {
    /// FDI tooth: 11-48, or 51-85 for primary teeth.
    pub tooth: u8,
    /// The headline finding (a chart finding value).
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finding: Option<String>,
    /// `M`, `O`, `D`, `B` or `L` of a caries or filled headline (`O` on a front tooth is the
    /// biting edge).
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub surfaces: Vec<String>,
    /// How the headline work looks: `composite`, `amalgam`, `porcelain`, `metal`, `zirconia` or
    /// `temporary`.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// The doctor's health level (`healthy`, `watch`, `needs_treatment`); absent without one.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<String>,
    /// Treat within this many months.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub treat_within_months: Option<u8>,
    /// `treated`, `in_progress` or `found` in this visit.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub today: Option<String>,
    /// Something is planned on it (accepted plan items and planned procedures only).
    #[schema(required = false)]
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub planned: bool,
    /// The sitting of a treatment in progress.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sitting: Option<u8>,
    /// Finished work: filling, crown, root canal, implant, bridge or missing.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub work: Vec<MouthWork>,
    /// Recorded problem findings: `caries`, `fractured`, `watch`, `missing`.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub problems: Vec<String>,
    /// Detail taps, only those recorded.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<MouthDetails>,
    /// Treatments in progress, done here, or planned, with their steps.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub treatments: Vec<MouthTreatment>,
}

/// Finished work on a tooth.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthWork {
    /// The work finding.
    pub finding: String,
    /// How it looks.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    /// `here` ("Done here"), `elsewhere` ("Done elsewhere") or `before` ("Done before"). Never
    /// a clinic or dentist name.
    pub origin: String,
    /// The visit day (`YYYY-MM-DD`), only for `here`.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub done_on: Option<String>,
    /// Recorded in this visit: Present mode labels it "Done here · today".
    #[schema(required = false)]
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub today: bool,
}

/// Detail taps recorded on the tooth's current rows; a field is absent unless recorded.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthDetails {
    /// `enamel`, `dentin` or `near_pulp`. Absent: draw a neutral cavity labelled
    /// "Illustration: depth not recorded".
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caries_depth: Option<String>,
    /// `infection` or `abscess`.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub infection: Option<String>,
    /// Gums bleed on probing.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bleeding: Option<bool>,
    /// Deepest pocket in mm (tooth detail only).
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pocket_mm: Option<u8>,
    /// Mobility grade 0 to 3.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mobility: Option<u8>,
    /// When the condition was recorded (`YYYY-MM-DD`): "Infection: recorded 12 Nov".
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub condition_on: Option<String>,
    /// `erupted`, `partial`, `impacted` or `unerupted`.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eruption: Option<String>,
    /// `vertical`, `mesioangular`, `distoangular` or `horizontal`.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub angulation: Option<String>,
}

/// A treatment with its steps, resolved on the server.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthTreatment {
    /// The model: `root_canal`, `filling`, `extraction`, `wisdom_extraction`, `crown`,
    /// `scaling` or `implant` (a plain string; more may come).
    pub model: String,
    /// `in_progress`, `done` or `planned`.
    pub state: String,
    /// Visits it usually takes.
    pub typical_visits: u8,
    /// The steps in order.
    pub steps: Vec<MouthStep>,
    /// Shown under "What to expect", never as patient-specific.
    pub recovery: Vec<String>,
}

/// One treatment step.
#[derive(Debug, Serialize, ToSchema)]
pub struct MouthStep {
    /// Step key, such as `dressing`.
    pub key: String,
    /// The stage art scene.
    pub scene: String,
    /// What happens.
    pub words: String,
    /// What usually follows; shown under "Usually".
    pub after_words: String,
    /// `done` or `current` (backed by a record here: "Visit {sitting}", else "Visit on {on}";
    /// "You are here" on current), `next` (the booked visit on `on`), or `usual` (under "Usual
    /// steps", with no visit number, date or price).
    pub state: String,
    /// The recorded sitting.
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sitting: Option<u8>,
    /// The visit day (`YYYY-MM-DD`).
    #[schema(required = false)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub on: Option<String>,
}

impl From<domain::MouthSnapshot> for MouthSnapshot {
    fn from(s: domain::MouthSnapshot) -> Self {
        Self {
            story_version: s.story_version,
            dentition: s.dentition,
            positions: s.positions.into_iter().map(MouthPosition::from).collect(),
            teeth: s.teeth.into_iter().map(MouthTooth::from).collect(),
            focus: s.focus,
            next_visit: s.next_visit.map(day),
        }
    }
}

impl From<domain::Position> for MouthPosition {
    fn from(p: domain::Position) -> Self {
        Self {
            quadrant: p.quadrant,
            index: p.index,
            tooth: p.tooth,
            shown: p.shown,
            other: p.other.map(|o| MouthOtherTooth {
                tooth: o.tooth,
                finding: o.finding,
            }),
        }
    }
}

impl From<domain::MouthTooth> for MouthTooth {
    fn from(t: domain::MouthTooth) -> Self {
        Self {
            tooth: t.tooth,
            finding: t.finding,
            surfaces: t.surfaces,
            material: t.material,
            health: t.health,
            treat_within_months: t.treat_within_months,
            today: t.today,
            planned: t.planned,
            sitting: t.sitting,
            work: t
                .work
                .into_iter()
                .map(|w| MouthWork {
                    finding: w.finding,
                    material: w.material,
                    origin: w.origin,
                    done_on: w.done_on.map(day),
                    today: w.today,
                })
                .collect(),
            problems: t.problems,
            details: t.details.map(|d| MouthDetails {
                caries_depth: d.caries_depth,
                infection: d.infection,
                bleeding: d.bleeding,
                pocket_mm: d.pocket_mm,
                mobility: d.mobility,
                condition_on: d.condition_on.map(day),
                eruption: d.eruption,
                angulation: d.angulation,
            }),
            treatments: t
                .treatments
                .into_iter()
                .map(|tr| MouthTreatment {
                    model: tr.model,
                    state: tr.state,
                    typical_visits: tr.typical_visits,
                    steps: tr
                        .steps
                        .into_iter()
                        .map(|s| MouthStep {
                            key: s.key,
                            scene: s.scene,
                            words: s.words,
                            after_words: s.after_words,
                            state: s.state,
                            sitting: s.sitting,
                            on: s.on.map(day),
                        })
                        .collect(),
                    recovery: tr.recovery,
                })
                .collect(),
        }
    }
}

/// The mouth snapshot of a visit for the doctor's Present mode: exactly the shape the patient's
/// page shows as `chart`, and nothing else. It works while the visit is open (no messaging
/// checks); refetch it after any chart, plan, procedure, tooth status or booking change.
#[utoipa::path(
    get,
    path = "/api/v1/visits/{id}/mouth",
    operation_id = "getVisitMouth",
    tag = "clinical",
    params(("id" = String, Path, description = "The visit")),
    security(("bearer" = [])),
    responses(
        (status = 200, body = MouthSnapshot, description = "The snapshot; `Cache-Control: no-store`"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "The role lacks clinical.read"),
        (status = 404, description = "No such visit in this clinic or the caller's reach")
    )
)]
pub(crate) async fn get(
    State(state): State<AppState>,
    Require { request, .. }: Require<ClinicalRead>,
    ApiPath(id): ApiPath<Uuid>,
) -> Result<Response, ApiFailure> {
    let snapshot = app::snapshot(
        state.db(),
        &request.actor,
        request.request_id,
        EncounterId::from_uuid(id),
        OffsetDateTime::now_utc(),
    )
    .await?;
    let mut response = Json(MouthSnapshot::from(snapshot)).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
