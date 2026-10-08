//! Error events in the shape Google Cloud Error Reporting reads from Cloud Logging.
//!
//! Cloud Run sends each stdout line to Cloud Logging, and Error Reporting turns a JSON line
//! with `"@type": "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"`
//! into a grouped, countable error (free with Cloud Logging). The shared log formatter flattens
//! fields and cannot nest objects, so these lines are written directly, one per error:
//!
//! ```json
//! {"severity":"ERROR","time":"…","@type":"type.googleapis.com/…ReportedErrorEvent",
//!  "serviceContext":{"service":"aarogyam-api","version":"0.1.0"},
//!  "message":"HTTP 500 GET /api/v1/patients/{id}",
//!  "context":{"httpRequest":{"method":"GET","url":"/api/v1/patients/{id}","responseStatusCode":500},
//!             "reportLocation":{"filePath":"/api/v1/patients/{id}","lineNumber":0,"functionName":"GET"}},
//!  "request_id":"0192…"}
//! ```
//!
//! Never patient data: the URL is the matched route template (never the raw path or query), a
//! panic reports only its source location (never the payload, which may hold user data), and
//! what browsers send goes through [`crate::scrub`] first. The request ID ties the event to the
//! request's other log lines (`jsonPayload.request_id`).

use std::io::Write as _;
use std::sync::Arc;

use axum::extract::{MatchedPath, Request, State};
use axum::http::Method;
use axum::middleware::Next;
use axum::response::Response;
use serde_json::{Value, json};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

/// The `@type` that makes Error Reporting treat a log line as an error event.
pub const EVENT_TYPE: &str =
    "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent";

type Sink = Arc<dyn Fn(&str) + Send + Sync>;

/// Where error events go and what they are labelled with.
#[derive(Clone)]
pub struct ErrorReporting {
    service: String,
    version: String,
    sink: Sink,
}

impl std::fmt::Debug for ErrorReporting {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ErrorReporting")
            .field("service", &self.service)
            .field("version", &self.version)
            .finish_non_exhaustive()
    }
}

impl ErrorReporting {
    /// Reports to standard output, where Cloud Run collects it.
    #[must_use]
    pub fn stdout(service: impl Into<String>, version: impl Into<String>) -> Self {
        Self::with_sink(service, version, |line| {
            // A closed stdout leaves nowhere to report to.
            let _ = writeln!(std::io::stdout().lock(), "{line}");
        })
    }

    /// Reports to `sink`, one JSON line per call. For tests.
    #[must_use]
    pub fn with_sink(
        service: impl Into<String>,
        version: impl Into<String>,
        sink: impl Fn(&str) + Send + Sync + 'static,
    ) -> Self {
        Self {
            service: service.into(),
            version: version.into(),
            sink: Arc::new(sink),
        }
    }

    /// Reports a `5xx` answer. `route` is the matched route template.
    pub fn server_error(
        &self,
        method: &Method,
        route: &str,
        status: u16,
        request_id: Option<&str>,
    ) {
        let event = Self::event(
            &self.service,
            &self.version,
            &format!("HTTP {status} {method} {route}"),
            Some((method.as_str(), route, status)),
            (route, 0, method.as_str()),
            request_id,
        );
        (self.sink)(&event.to_string());
    }

    /// Reports a panic by where it happened, never what it said.
    pub fn panic(&self, file: &str, line: u32) {
        let event = Self::event(
            &self.service,
            &self.version,
            &format!("panic at {file}:{line}"),
            None,
            (file, line, "panic"),
            None,
        );
        (self.sink)(&event.to_string());
    }

    /// Reports an error a browser or app sent, already scrubbed. `service` names the client,
    /// such as `aarogyam-web-portal`, so its errors group apart from the API's.
    pub fn client_error(
        &self,
        service: &str,
        release: Option<&str>,
        message: &str,
        page: &str,
        request_id: Option<&str>,
    ) {
        let event = Self::event(
            service,
            release.unwrap_or(&self.version),
            message,
            None,
            (page, 0, "client"),
            request_id,
        );
        (self.sink)(&event.to_string());
    }

    fn event(
        service: &str,
        version: &str,
        message: &str,
        http: Option<(&str, &str, u16)>,
        location: (&str, u32, &str),
        request_id: Option<&str>,
    ) -> Value {
        let time = OffsetDateTime::now_utc()
            .format(&Rfc3339)
            .unwrap_or_default();
        let mut context = serde_json::Map::new();
        if let Some((method, url, status)) = http {
            context.insert(
                "httpRequest".into(),
                json!({ "method": method, "url": url, "responseStatusCode": status }),
            );
        }
        context.insert(
            "reportLocation".into(),
            json!({ "filePath": location.0, "lineNumber": location.1, "functionName": location.2 }),
        );
        let mut event = json!({
            "severity": "ERROR",
            "time": time,
            "@type": EVENT_TYPE,
            "serviceContext": { "service": service, "version": version },
            "message": message,
            "context": context,
        });
        if let (Some(id), Some(map)) = (request_id, event.as_object_mut()) {
            map.insert("request_id".into(), Value::from(id));
        }
        event
    }

    /// Replaces the panic hook so a panic reports its location here instead of printing its
    /// payload (which may hold user data) to standard error. Call once, at startup.
    pub fn install_panic_hook(self: &Arc<Self>) {
        let reporting = Arc::clone(self);
        std::panic::set_hook(Box::new(move |info| {
            let (file, line) = info
                .location()
                .map_or(("unknown", 0), |at| (at.file(), at.line()));
            reporting.panic(file, line);
        }));
    }
}

/// Middleware that reports every `5xx` answer, including the ones the standard layers make from
/// panics and timeouts. Add it outermost, next to [`crate::metrics::track`], so the matched
/// route is known and the answer already carries its request ID.
pub async fn report_server_errors(
    State(reporting): State<Arc<ErrorReporting>>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map_or_else(|| "unmatched".to_owned(), |path| path.as_str().to_owned());
    let response = next.run(request).await;
    if response.status().is_server_error() {
        let request_id = response
            .headers()
            .get(sakalya_http::REQUEST_ID_HEADER)
            .and_then(|value| value.to_str().ok());
        reporting.server_error(&method, &route, response.status().as_u16(), request_id);
    }
    response
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    fn collecting() -> (ErrorReporting, Arc<Mutex<Vec<Value>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);
        let reporting = ErrorReporting::with_sink("aarogyam-api", "1.2.3", move |line| {
            if let Ok(mut lines) = sink.lock() {
                lines.push(serde_json::from_str(line).unwrap_or(Value::Null));
            }
        });
        (reporting, lines)
    }

    #[test]
    fn a_server_error_has_the_error_reporting_shape() {
        let (reporting, lines) = collecting();
        reporting.server_error(&Method::GET, "/api/v1/patients/{id}", 500, Some("0192-abc"));
        let lines = lines.lock().unwrap();
        let event = &lines[0];
        assert_eq!(event["severity"], "ERROR");
        assert_eq!(event["@type"], EVENT_TYPE);
        assert_eq!(event["serviceContext"]["service"], "aarogyam-api");
        assert_eq!(event["serviceContext"]["version"], "1.2.3");
        assert_eq!(event["message"], "HTTP 500 GET /api/v1/patients/{id}");
        assert_eq!(event["context"]["httpRequest"]["method"], "GET");
        assert_eq!(
            event["context"]["httpRequest"]["url"],
            "/api/v1/patients/{id}"
        );
        assert_eq!(event["context"]["httpRequest"]["responseStatusCode"], 500);
        assert_eq!(event["context"]["reportLocation"]["functionName"], "GET");
        assert_eq!(event["request_id"], "0192-abc");
        assert!(event["time"].as_str().is_some_and(|t| t.contains('T')));
    }

    #[test]
    fn a_panic_reports_only_where_it_happened() {
        let (reporting, lines) = collecting();
        reporting.panic("crates/aarogyam-app/src/patients.rs", 42);
        let lines = lines.lock().unwrap();
        assert_eq!(
            lines[0]["message"],
            "panic at crates/aarogyam-app/src/patients.rs:42"
        );
        assert_eq!(lines[0]["context"]["reportLocation"]["lineNumber"], 42);
        assert!(lines[0]["context"].get("httpRequest").is_none());
        assert!(lines[0].get("request_id").is_none());
    }

    #[test]
    fn a_client_error_is_grouped_under_its_own_service() {
        let (reporting, lines) = collecting();
        reporting.client_error(
            "aarogyam-web-portal",
            Some("web-9"),
            "TypeError: x is undefined",
            "/patients/:id",
            None,
        );
        let lines = lines.lock().unwrap();
        assert_eq!(lines[0]["serviceContext"]["service"], "aarogyam-web-portal");
        assert_eq!(lines[0]["serviceContext"]["version"], "web-9");
        assert_eq!(
            lines[0]["context"]["reportLocation"]["filePath"],
            "/patients/:id"
        );
    }
}
