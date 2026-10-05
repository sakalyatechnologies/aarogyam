//! Conditional GET for answers that rarely change (clinic settings, letterhead, price list,
//! roles): a strong `ETag` over the body, `Cache-Control: private, no-cache`, and a bodiless
//! `304 Not Modified` when `If-None-Match` matches. The handler still runs, so permissions are
//! always checked; what is saved is the transfer and the browser's repeat requests.

use axum::body::{Body, to_bytes};
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::Response;

/// The browser keeps the answer but asks every time (a 304 costs no body), so a save shows up
/// at once instead of after a max-age.
const ALWAYS_REVALIDATE: &str = "private, no-cache";
/// Largest body hashed; bigger answers pass through untouched.
const MAX_BODY: usize = 2 * 1024 * 1024;

/// FNV-1a over the bytes, with the length mixed in. Not a security hash: it only has to tell two
/// bodies apart.
fn etag_of(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("\"{hash:016x}-{:x}\"", bytes.len())
}

/// True when one of the `If-None-Match` entries (or `*`) names `etag`.
fn matches(header_value: &str, etag: &str) -> bool {
    header_value
        .split(',')
        .map(|part| part.trim().trim_start_matches("W/"))
        .any(|part| part == "*" || part == etag)
}

/// Middleware for `GET` routes whose answer is a stable JSON document.
pub(crate) async fn revalidate(request: Request, next: Next) -> Response {
    let condition = request
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let response = next.run(request).await;
    if response.status() != StatusCode::OK {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = to_bytes(body, MAX_BODY).await else {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .body(Body::empty())
            .unwrap_or_default();
    };
    let etag = etag_of(&bytes);
    if let Ok(value) = HeaderValue::from_str(&etag) {
        parts.headers.insert(header::ETAG, value);
    }
    parts.headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(ALWAYS_REVALIDATE),
    );
    parts
        .headers
        .append(header::VARY, HeaderValue::from_static("Authorization"));
    if condition.is_some_and(|value| matches(&value, &etag)) {
        parts.status = StatusCode::NOT_MODIFIED;
        parts.headers.remove(header::CONTENT_LENGTH);
        parts.headers.remove(header::CONTENT_TYPE);
        return Response::from_parts(parts, Body::empty());
    }
    Response::from_parts(parts, Body::from(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::Router;
    use axum::middleware::from_fn;
    use axum::routing::get;
    use tower::ServiceExt;

    fn app() -> Router {
        Router::new()
            .route(
                "/doc",
                get(|| async { "{\"a\":1}" }).layer(from_fn(revalidate)),
            )
            .route(
                "/missing",
                get(|| async { StatusCode::NOT_FOUND }).layer(from_fn(revalidate)),
            )
    }

    async fn get_with(path: &str, if_none_match: Option<&str>) -> Response {
        let mut request = Request::get(path);
        if let Some(value) = if_none_match {
            request = request.header(header::IF_NONE_MATCH, value);
        }
        app()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn answers_carry_an_etag_and_always_revalidate() {
        let response = get_with("/doc", None).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CACHE_CONTROL],
            "private, no-cache"
        );
        assert!(
            response.headers()[header::ETAG]
                .to_str()
                .unwrap()
                .starts_with('"')
        );
        let body = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(&body[..], b"{\"a\":1}");
    }

    #[tokio::test]
    async fn a_matching_if_none_match_gets_304_without_a_body() {
        let first = get_with("/doc", None).await;
        let etag = first.headers()[header::ETAG].to_str().unwrap().to_owned();
        let again = get_with("/doc", Some(&etag)).await;
        assert_eq!(again.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(again.headers()[header::ETAG].to_str().unwrap(), etag);
        assert!(to_bytes(again.into_body(), 1024).await.unwrap().is_empty());
        let weak = get_with("/doc", Some(&format!("W/{etag}"))).await;
        assert_eq!(weak.status(), StatusCode::NOT_MODIFIED);
    }

    #[tokio::test]
    async fn a_different_etag_gets_the_full_answer() {
        let response = get_with("/doc", Some("\"stale\"")).await;
        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn errors_are_never_cached() {
        let response = get_with("/missing", None).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert!(response.headers().get(header::CACHE_CONTROL).is_none());
    }
}
