//! Settings, letterhead, price list and roles answer with an `ETag` and `Cache-Control: private`,
//! and a repeat request with `If-None-Match` gets `304 Not Modified`.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use support::people::*;
use support::{ALPHA, TestApp};
use tower::ServiceExt;

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn rarely_changing_reads_support_etag_and_304() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    for path in [
        "/api/v1/settings/clinic",
        "/api/v1/price-items",
        "/api/v1/roles",
    ] {
        let get = |etag: Option<String>| {
            let mut request = Request::get(path)
                .header("host", ALPHA)
                .header("authorization", format!("Bearer {owner}"));
            if let Some(etag) = etag {
                request = request.header("if-none-match", etag);
            }
            request.body(Body::empty()).unwrap()
        };
        let first = app.router.clone().oneshot(get(None)).await.unwrap();
        assert_eq!(first.status(), StatusCode::OK, "{path}");
        assert_eq!(
            first.headers()["cache-control"],
            "private, no-cache",
            "{path}"
        );
        let etag = first.headers()["etag"].to_str().unwrap().to_owned();
        let again = app
            .router
            .clone()
            .oneshot(get(Some(etag.clone())))
            .await
            .unwrap();
        assert_eq!(again.status(), StatusCode::NOT_MODIFIED, "{path}");
        assert_eq!(again.headers()["etag"].to_str().unwrap(), etag);
        assert!(to_bytes(again.into_body(), 1024).await.unwrap().is_empty());
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_forbidden_read_is_not_cached() {
    let app = TestApp::start().await;
    let token = app.token(ALPHA_NOTHING);
    let request = Request::get("/api/v1/roles")
        .header("host", ALPHA)
        .header("authorization", format!("Bearer {token}"))
        .header("if-none-match", "*")
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(response.headers().get("etag").is_none());
}
