//! Errors from the web apps, logged the way the API's own errors are. Public, because a page
//! that fails may not be signed in, so it is limited three ways: per IP by the throttle, per
//! process by a budget here, and by size (8 KB of JSON). Nothing is stored: the report is
//! scrubbed (see `crate::scrub`) and written to the log, where Error Reporting groups it.

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State;
use axum::http::StatusCode;
use sakalya_http::{ApiError, ApiJson};
use serde::Deserialize;
use utoipa::ToSchema;

use crate::AppState;
use crate::failure::ApiFailure;
use crate::scrub::{scrub_route, scrub_text};

/// Largest request body accepted.
pub(crate) const MAX_BODY: usize = 8 * 1024;
const MAX_MESSAGE: usize = 300;
const MAX_STACK: usize = 2000;
/// Reports logged per minute by one instance, whoever sends them.
const BUDGET_PER_MINUTE: u32 = 120;

/// What a page sends when something fails.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ClientError {
    /// Which app: `portal`, `console`, `website` or `mobile`.
    pub app: String,
    /// `error` (default), `unhandledrejection` or `console`.
    pub kind: Option<String>,
    /// The error's name, such as `TypeError`.
    pub name: Option<String>,
    /// The error's message; scrubbed and cut to 300 characters.
    pub message: String,
    /// The stack trace; scrubbed and cut to 2000 characters.
    pub stack: Option<String>,
    /// The page's path; reduced to a route shape.
    pub page: Option<String>,
    /// The app's release.
    pub release: Option<String>,
    /// The `x-request-id` of a failed API call, to join with the server's log lines.
    pub request_id: Option<String>,
}

/// A per-minute allowance shared by all callers, so a flood from many addresses still cannot
/// fill the log. Keeps no data from the reports.
#[derive(Debug, Default)]
pub(crate) struct Budget {
    window: Mutex<(u64, u32)>,
}

impl Budget {
    fn take(&self, now_seconds: u64) -> bool {
        let minute = now_seconds / 60;
        let Ok(mut window) = self.window.lock() else {
            return false;
        };
        if window.0 != minute {
            *window = (minute, 0);
        }
        if window.1 >= BUDGET_PER_MINUTE {
            return false;
        }
        window.1 += 1;
        true
    }
}

/// The report as it will be logged: every field cleaned.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Cleaned {
    pub(crate) service: String,
    pub(crate) message: String,
    pub(crate) release: Option<String>,
    pub(crate) page: String,
    pub(crate) request_id: Option<String>,
}

pub(crate) fn clean(report: &ClientError) -> Cleaned {
    let app = report
        .app
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .take(24)
        .collect::<String>()
        .to_ascii_lowercase();
    let app = if app.is_empty() {
        "unknown".to_owned()
    } else {
        app
    };
    let kind = report
        .kind
        .as_deref()
        .filter(|kind| matches!(*kind, "unhandledrejection" | "console"))
        .unwrap_or("error");
    let name = scrub_text(report.name.as_deref().unwrap_or("Error"), 60);
    let mut message = format!(
        "{name}: {} [{kind}]",
        scrub_text(&report.message, MAX_MESSAGE)
    );
    if let Some(stack) = &report.stack {
        // Frames start with "at ", which Error Reporting reads as a stack trace.
        message.push('\n');
        message.push_str(&scrub_text(stack, MAX_STACK));
    }
    let request_id = report
        .request_id
        .as_deref()
        .filter(|id| id.len() <= 64 && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-'))
        .map(str::to_owned);
    Cleaned {
        service: format!("aarogyam-web-{app}"),
        message,
        release: report
            .release
            .as_deref()
            .filter(|v| {
                v.len() <= 32
                    && v.chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
            })
            .map(str::to_owned),
        page: scrub_route(report.page.as_deref().unwrap_or("/")),
        request_id,
    }
}

/// Logs an error from a web app (public, throttled, nothing stored).
#[utoipa::path(
    post,
    path = "/api/v1/client-errors",
    operation_id = "reportClientError",
    tag = "meta",
    request_body = ClientError,
    responses(
        (status = 204, description = "Logged, or dropped when over the allowance"),
        (status = 429, description = "Too many reports from this address")
    )
)]
pub(crate) async fn report(
    State(state): State<AppState>,
    ApiJson(body): ApiJson<ClientError>,
) -> Result<StatusCode, ApiFailure> {
    if body.message.is_empty() {
        return Err(ApiError::bad_request("invalid_input", "message is required").into());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    // Over the allowance is not the page's problem: answer the same and drop the report.
    if state.client_error_budget().take(now) {
        let cleaned = clean(&body);
        if let Some(reporting) = state.error_reporting() {
            reporting.client_error(
                &cleaned.service,
                cleaned.release.as_deref(),
                &cleaned.message,
                &cleaned.page,
                cleaned.request_id.as_deref(),
            );
        } else {
            tracing::warn!(
                service = %cleaned.service,
                page = %cleaned.page,
                client_message = %cleaned.message,
                "client error"
            );
        }
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report(message: &str) -> ClientError {
        ClientError {
            app: "Portal".into(),
            kind: None,
            name: Some("TypeError".into()),
            message: message.into(),
            stack: Some("TypeError\n    at show (https://p.example/assets/a.js?v=2:10:5)".into()),
            page: Some("/patients/SC-1042?name=Asha".into()),
            release: Some("web-1.2".into()),
            request_id: Some("0192abcd-0000-7000-8000-000000000000".into()),
        }
    }

    #[test]
    fn a_report_is_cleaned_before_it_is_logged() {
        let cleaned = clean(&report("no record for 'Asha Rao' asha@x.in"));
        assert_eq!(cleaned.service, "aarogyam-web-portal");
        assert!(
            cleaned
                .message
                .starts_with("TypeError: no record for '[q]' [email] [error]")
        );
        assert!(cleaned.message.contains("at show"));
        assert!(!cleaned.message.contains("v=2"));
        assert_eq!(cleaned.release.as_deref(), Some("web-1.2"));
        assert_eq!(cleaned.page, "/patients/:id");
        assert!(cleaned.request_id.is_some());
    }

    #[test]
    fn a_bad_request_id_and_app_are_dropped() {
        let mut bad = report("x");
        bad.app = "../../etc".into();
        bad.request_id = Some("asha@x.in".into());
        let cleaned = clean(&bad);
        assert_eq!(cleaned.service, "aarogyam-web-etc");
        assert_eq!(cleaned.request_id, None);
    }

    #[test]
    fn the_budget_allows_a_fixed_number_a_minute() {
        let budget = Budget::default();
        assert!((0..BUDGET_PER_MINUTE).all(|_| budget.take(600)));
        assert!(!budget.take(601));
        assert!(budget.take(660));
    }
}
