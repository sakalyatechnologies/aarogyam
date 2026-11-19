//! `POST /api/v1/telemetry`: page views, visible time, page speed and error classes from the
//! portal and the console (docs/plans/console-insights-design.md, 2b).
//!
//! Signed-in staff only: a member of the clinic on its host, or Sakalya staff on the console
//! host ([`TelemetrySender`]). The app comes from the host, never the body. The batch is checked
//! by [`Batch::build`] (route allow-list, fixed vital and error names, 50 entries) and capped at
//! 8 KB; a throttle rule limits each IP, a clinic's batches past
//! [`aarogyam_app::telemetry::DAILY_CAP`] a day are dropped, and so are the console's past
//! [`CONSOLE_DAILY_CAP`]. Requests with the end-to-end suites' throttle bypass header are
//! dropped, so test runs never count. Only counters are kept: per clinic without a role, per
//! role without a clinic, and page speed and errors with neither.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use aarogyam_app::telemetry::{self as app, Sender};
use aarogyam_domain::telemetry::{Batch, ErrorInput, PageInput, UiApp, VitalInput};
use axum::Router;
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use sakalya_http::{ApiError, ApiJson};
use serde::Deserialize;
use utoipa::{OpenApi, ToSchema};

use crate::AppState;
use crate::extract::TelemetrySender;
use crate::failure::ApiFailure;

/// The routes of this module.
pub(crate) fn routes() -> Router<AppState> {
    Router::new().route(
        "/telemetry",
        post(record).layer(DefaultBodyLimit::max(MAX_BODY)),
    )
}

/// This module's part of the OpenAPI document, merged in `crate::openapi::openapi`.
#[derive(OpenApi)]
#[openapi(paths(record))]
pub(crate) struct Doc;

/// Largest request body accepted.
pub(crate) const MAX_BODY: usize = 8 * 1024;
/// Most batches the console's own pages may add in a day, across all staff.
pub const CONSOLE_DAILY_CAP: u32 = 5_000;

/// Views and visible time for one page.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TelemetryPage {
    /// The router's route template, such as `/patients/:id`; anything not in the app's list is
    /// counted as `other`.
    pub route: String,
    /// Times the page was opened.
    pub views: u32,
    /// Milliseconds the page was visible.
    pub visible_ms: u64,
}

/// One page-speed reading.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TelemetryVital {
    /// The route template.
    pub route: String,
    /// `lcp`, `inp`, `cls` or `ttfb`; anything else is dropped.
    pub name: String,
    /// Milliseconds, or the layout-shift score for `cls`.
    pub value: f64,
}

/// Front-end errors of one class on one page.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TelemetryError {
    /// The route template.
    pub route: String,
    /// `type_error`, `reference_error`, `range_error`, `syntax_error`, `chunk_load`, `network`,
    /// `unhandled_rejection` or `other`; anything else counts as `other`.
    pub class: String,
    /// How many.
    pub count: u32,
}

/// What a page sends when its tab is hidden or 50 entries have queued: at most 50 entries in all.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TelemetryBatch {
    /// Views and visible time per page.
    #[serde(default)]
    pub pages: Vec<TelemetryPage>,
    /// Page-speed readings.
    #[serde(default)]
    pub vitals: Vec<TelemetryVital>,
    /// Error counts per page and class.
    #[serde(default)]
    pub errors: Vec<TelemetryError>,
}

/// The console's daily allowance, kept in memory: the console is Sakalya staff only, so a cap
/// per instance is enough.
#[derive(Debug, Default)]
pub(crate) struct ConsoleQuota {
    day: Mutex<(u64, u32)>,
}

impl ConsoleQuota {
    fn take(&self, now_seconds: u64) -> bool {
        let day = now_seconds / 86_400;
        let Ok(mut window) = self.day.lock() else {
            return false;
        };
        if window.0 != day {
            *window = (day, 0);
        }
        if window.1 >= CONSOLE_DAILY_CAP {
            return false;
        }
        window.1 += 1;
        true
    }
}

/// Adds page counters, page speed and error classes (staff only, counts only).
#[utoipa::path(
    post,
    path = "/api/v1/telemetry",
    operation_id = "sendTelemetry",
    tag = "meta",
    request_body = TelemetryBatch,
    security(("bearer" = [])),
    responses(
        (status = 204, description = "Added, or dropped when over the day's allowance"),
        (status = 400, description = "More than 50 entries"),
        (status = 401, description = "Not signed in"),
        (status = 403, description = "On the console host: not Sakalya staff"),
        (status = 404, description = "Not a member of the clinic named by the host"),
        (status = 413, description = "Larger than 8 KB"),
        (status = 429, description = "Too many batches from this address")
    )
)]
pub(crate) async fn record(
    State(state): State<AppState>,
    sender: TelemetrySender,
    headers: HeaderMap,
    ApiJson(body): ApiJson<TelemetryBatch>,
) -> Result<StatusCode, ApiFailure> {
    // End-to-end suites and canaries carry the throttle bypass: their clicks are not usage.
    if headers.contains_key(sakalya_throttle::BYPASS_HEADER) {
        return Ok(StatusCode::NO_CONTENT);
    }
    let app = match sender {
        TelemetrySender::Clinic(_) => UiApp::Portal,
        TelemetrySender::Console(_) => UiApp::Console,
    };
    let pages: Vec<_> = body
        .pages
        .iter()
        .map(|page| PageInput {
            route: &page.route,
            views: page.views,
            visible_ms: page.visible_ms,
        })
        .collect();
    let vitals: Vec<_> = body
        .vitals
        .iter()
        .map(|reading| VitalInput {
            route: &reading.route,
            name: &reading.name,
            value: reading.value,
        })
        .collect();
    let errors: Vec<_> = body
        .errors
        .iter()
        .map(|error| ErrorInput {
            route: &error.route,
            class: &error.class,
            count: error.count,
        })
        .collect();
    let batch = Batch::build(app, &pages, &vitals, &errors)
        .map_err(|error| ApiError::bad_request("invalid_input", error.to_string()))?;
    if batch.is_empty() {
        return Ok(StatusCode::NO_CONTENT);
    }
    let added = match &sender {
        TelemetrySender::Clinic(actor) => {
            let sender = Sender::Clinic {
                org_id: actor.clinic_id.uuid(),
                role_key: &actor.role_key,
            };
            app::record(state.db(), sender, app, &batch).await?
        }
        TelemetrySender::Console(staff) => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |elapsed| elapsed.as_secs());
            if state.console_telemetry().take(now) {
                let role = staff.role.map_or("staff", |role| role.as_str());
                app::record(state.db(), Sender::Console { role }, app, &batch).await?
            } else {
                false
            }
        }
    };
    if !added {
        tracing::debug!(app = %app, "telemetry batch over the day's allowance; dropped");
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_console_allowance_resets_each_day() {
        let quota = ConsoleQuota::default();
        assert!((0..CONSOLE_DAILY_CAP).all(|_| quota.take(86_400)));
        assert!(!quota.take(86_401));
        assert!(quota.take(2 * 86_400));
    }
}
