//! Clinic portal addresses: a new clinic's host is pending until the outbox job makes it work,
//! the console shows the status, and the workers.dev job (against a stand-in for Cloudflare's
//! API) uploads one forwarding Worker per clinic, retries outages and records each clinic's
//! outcome on its own row.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use std::sync::{Arc, Mutex};

use aarogyam_notify::cloudflare::{AccountId, WorkersApi};
use aarogyam_notify::{PortalAddresses, WorkersDev};
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::routing::any;
use secrecy::SecretString;
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, CONSOLE, TestApp};
use time::OffsetDateTime;

const ACCOUNT: &str = "0123456789abcdef0123456789abcdef";
const TOKEN: &str = "cf-test-token-not-real";
const SUBDOMAIN: &str = "test-sub";

/// One request Cloudflare's stand-in received.
#[derive(Debug, Clone)]
struct Call {
    method: Method,
    path: String,
    authorization: String,
    body: String,
}

#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<Call>>,
    /// Script names whose upload answers 500 (an outage).
    down: Mutex<Vec<String>>,
}

async fn handle(
    State(fake): State<Arc<Fake>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, axum::Json<Value>) {
    let path = uri.path().to_owned();
    fake.calls.lock().unwrap().push(Call {
        method,
        path: path.clone(),
        authorization: headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_owned(),
        body: String::from_utf8_lossy(&body).into_owned(),
    });
    let down = fake
        .down
        .lock()
        .unwrap()
        .iter()
        .any(|name| path.ends_with(&format!("/scripts/{name}")));
    if down {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "success": false, "errors": [{ "code": 10013, "message": "x" }] })),
        );
    }
    (
        StatusCode::OK,
        axum::Json(json!({ "success": true, "errors": [], "result": {} })),
    )
}

async fn serve(fake: Arc<Fake>) -> String {
    let app = Router::new().fallback(any(handle)).with_state(fake);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await });
    format!("http://{address}/client/v4")
}

fn workers_dev(base: &str) -> PortalAddresses {
    let api = WorkersApi::new(
        base,
        AccountId::parse(ACCOUNT).unwrap(),
        SecretString::from(TOKEN),
    )
    .unwrap();
    PortalAddresses::WorkersDev(
        WorkersDev::new(api, SUBDOMAIN, "{slug}-aarogyam", "aarogyam-portal").unwrap(),
    )
}

/// The portal host's address status and last error for a clinic, by slug.
async fn address(app: &TestApp, slug: &str) -> (String, Option<String>, i32) {
    sqlx::query_as(
        "select d.edge_status, d.edge_error, d.edge_attempts from aarogyam.org_domains d
         join aarogyam.organizations o on o.id = d.org_id
         where o.slug = $1 and d.kind = 'portal' and d.is_primary",
    )
    .bind(slug)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn console_clinic(app: &TestApp, staff: &str, slug: &str) -> Value {
    let id = app.clinic_id(slug).await;
    let (status, clinic) = app
        .send(
            Method::GET,
            CONSOLE,
            &format!("/api/v1/console/clinics/{id}"),
            Some(staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{clinic}");
    clinic
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_new_clinic_is_pending_until_the_outbox_drain_makes_its_address_work() {
    let app = TestApp::start().await;
    let staff = app.token(STAFF);
    let (status, created) = app
        .send(
            Method::POST,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&staff),
            Some(json!({ "name": "Gamma Dental Care", "owner_email": "owner@gamma.test" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");

    let listed = |list: &Value, slug: &str| -> Value {
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["slug"] == slug)
            .unwrap()["address_status"]
            .clone()
    };
    let (_, list) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(listed(&list, "gamma-dental-care"), "pending");
    let gamma = console_clinic(&app, &staff, "gamma-dental-care").await;
    assert_eq!(gamma["address_status"], "pending");
    assert_eq!(gamma["address_error"], Value::Null);

    // Locally every *.localtest.me host is already served: the drain marks it ready, first.
    let (status, report) = app
        .send(
            Method::POST,
            "localhost",
            "/api/v1/internal/outbox/drain",
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["address_provider"], "wildcard");
    assert!(report["addresses_ready"].as_u64().unwrap() >= 1, "{report}");
    let (_, list) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(listed(&list, "gamma-dental-care"), "ready");
    assert_eq!(
        console_clinic(&app, &staff, "gamma-dental-care").await["address_status"],
        "ready"
    );

    // The status is console-only: a clinic owner can't read it, on either host.
    let gamma_id = app.clinic_id("gamma-dental-care").await;
    let path = format!("/api/v1/console/clinics/{gamma_id}");
    let owner = app.token(ALPHA_OWNER);
    let (status, _) = app
        .send(Method::GET, CONSOLE, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_workers_dev_job_uploads_one_forwarder_per_clinic_and_settles_each_on_its_own() {
    let app = TestApp::start().await;
    // Give the two seeded clinics workers.dev hosts, and leave every other one on a host this
    // job must not serve.
    sqlx::query(
        "update aarogyam.org_domains d set hostname = o.slug || '-aarogyam.test-sub.workers.dev'
         from aarogyam.organizations o where o.id = d.org_id and o.slug in ('alpha', 'beta')
           and d.kind = 'portal'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let db = app.api_db();
    let queued = aarogyam_dal::edge::requeue(db.pool(), None).await.unwrap();
    assert!(queued >= 2);

    let fake = Arc::new(Fake::default());
    fake.down.lock().unwrap().push("beta-aarogyam".into());
    let base = serve(Arc::clone(&fake)).await;
    let job = workers_dev(&base);

    let report = job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!(report.ready, 1, "{report:?}");
    assert_eq!(report.retrying, 1, "{report:?}");
    assert_eq!(report.failed, report.claimed - 2, "{report:?}");

    // Alpha: its own Worker, bound to the portal, then its workers.dev address.
    let calls = fake.calls.lock().unwrap().clone();
    let alpha: Vec<&Call> = calls
        .iter()
        .filter(|c| c.path.contains("/alpha-aarogyam"))
        .collect();
    assert_eq!(alpha.len(), 2, "{calls:?}");
    let script = format!("/client/v4/accounts/{ACCOUNT}/workers/scripts/alpha-aarogyam");
    assert_eq!(
        (&alpha[0].method, alpha[0].path.as_str()),
        (&Method::PUT, script.as_str())
    );
    assert!(alpha[0].body.contains(r#""main_module":"worker.js""#));
    for part in [
        r#""type":"service""#,
        r#""name":"PORTAL""#,
        r#""service":"aarogyam-portal""#,
    ] {
        assert!(alpha[0].body.contains(part), "{}", alpha[0].body);
    }
    assert!(alpha[0].body.contains("env.PORTAL.fetch(request)"));
    assert!(
        !alpha[0].body.contains(TOKEN),
        "the token is never uploaded"
    );
    assert_eq!(alpha[1].method, Method::POST);
    assert_eq!(alpha[1].path, format!("{script}/subdomain"));
    assert_eq!(
        serde_json::from_str::<Value>(&alpha[1].body).unwrap(),
        json!({ "enabled": true, "previews_enabled": false })
    );
    assert!(
        calls
            .iter()
            .all(|c| c.authorization == format!("Bearer {TOKEN}"))
    );
    // Only the two workers.dev clinics reached Cloudflare.
    assert!(
        calls
            .iter()
            .all(|c| c.path.contains("/alpha-aarogyam") || c.path.contains("/beta-aarogyam"))
    );

    // Each clinic's outcome is its own: alpha ready, beta waiting to retry, the rest failed
    // for good without a call.
    assert_eq!(address(&app, "alpha").await, ("ready".into(), None, 1));
    let (status, error, attempts) = address(&app, "beta").await;
    assert_eq!((status.as_str(), attempts), ("pending", 1));
    assert_eq!(
        error.as_deref(),
        Some("cloudflare answered 500 (code 10013)")
    );
    let staff = app.token(STAFF);
    assert_eq!(
        console_clinic(&app, &staff, "alpha").await["address_status"],
        "ready"
    );
    let beta = console_clinic(&app, &staff, "beta").await;
    assert_eq!(beta["address_status"], "pending");
    assert_eq!(
        beta["address_error"],
        "cloudflare answered 500 (code 10013)"
    );

    // Beta's retry is not due yet: running again calls nothing.
    let before = fake.calls.lock().unwrap().len();
    let again = job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!(again.claimed, 0);
    assert_eq!(fake.calls.lock().unwrap().len(), before);

    // Cloudflare is back; the backfill queues beta alone, and it is ready. Alpha is untouched.
    fake.down.lock().unwrap().clear();
    assert_eq!(
        aarogyam_dal::edge::requeue(db.pool(), Some("beta"))
            .await
            .unwrap(),
        1
    );
    let retried = job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!((retried.claimed, retried.ready), (1, 1));
    assert_eq!(address(&app, "beta").await, ("ready".into(), None, 1));
    assert_eq!(address(&app, "alpha").await, ("ready".into(), None, 1));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn refused_uploads_fail_for_good_and_the_api_role_cannot_touch_domains_directly() {
    let app = TestApp::start().await;
    sqlx::query(
        "update aarogyam.org_domains d set hostname = 'alpha-aarogyam.test-sub.workers.dev'
         from aarogyam.organizations o where o.id = d.org_id and o.slug = 'alpha' and d.kind = 'portal'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let db = app.api_db();
    aarogyam_dal::edge::requeue(db.pool(), Some("alpha"))
        .await
        .unwrap();
    // Cloudflare refuses (a wrong or narrowed token): no retry, the reason is kept.
    let refusing = Router::new().fallback(any(|| async {
        (
            StatusCode::FORBIDDEN,
            axum::Json(json!({ "success": false, "errors": [{ "code": 10000 }] })),
        )
    }));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address_ = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, refusing).await });
    let job = workers_dev(&format!("http://{address_}"));
    let report = job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    // Beta, still on its localtest.me host, fails for good too, without a call.
    assert_eq!((report.claimed, report.failed), (2, 2));
    assert_eq!(
        address(&app, "alpha").await,
        (
            "failed".into(),
            Some("cloudflare answered 403 (code 10000)".into()),
            1
        )
    );

    // The API's role changes addresses only through the job's functions.
    let denied = sqlx::query("update aarogyam.org_domains set edge_status = 'ready'")
        .execute(db.pool())
        .await;
    assert!(denied.is_err());
    app.finish().await;
}
