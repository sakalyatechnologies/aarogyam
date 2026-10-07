//! Clinic websites going live: publishing queues the clinic's free site address, the outbox job
//! (against a stand-in for Cloudflare's API) uploads one forwarding Worker to the site Worker and
//! records the status Settings shows, taking the site down removes the Worker and the host, and
//! the public API serves a clinic's site only on its own published site host.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use std::sync::{Arc, Mutex};

use aarogyam_api::WebsiteLinks;
use aarogyam_notify::cloudflare::{AccountId, WorkersApi};
use aarogyam_notify::{PortalAddresses, WorkersDev};
use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, Method, StatusCode, Uri};
use axum::routing::any;
use sakalya_http::HttpConfig;
use secrecy::SecretString;
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::OffsetDateTime;

const ACCOUNT: &str = "0123456789abcdef0123456789abcdef";
const SUBDOMAIN: &str = "test-sub";
const ALPHA_SITE: &str = "alpha-site.test-sub.workers.dev";
const BETA_SITE: &str = "beta-site.test-sub.workers.dev";
const SETTINGS: &str = "/api/v1/settings/website";
const SITE: &str = "/api/v1/public/site";

#[derive(Debug, Clone)]
struct Call {
    method: Method,
    path: String,
    body: String,
}

#[derive(Default)]
struct Fake {
    calls: Mutex<Vec<Call>>,
    /// Script names whose calls answer 500 (an outage).
    down: Mutex<Vec<String>>,
}

impl Fake {
    fn calls(&self) -> Vec<Call> {
        self.calls.lock().unwrap().clone()
    }
}

async fn handle(
    State(fake): State<Arc<Fake>>,
    method: Method,
    uri: Uri,
    _headers: HeaderMap,
    body: Bytes,
) -> (StatusCode, axum::Json<Value>) {
    let path = uri.path().to_owned();
    fake.calls.lock().unwrap().push(Call {
        method,
        path: path.clone(),
        body: String::from_utf8_lossy(&body).into_owned(),
    });
    let down = fake
        .down
        .lock()
        .unwrap()
        .iter()
        .any(|name| path.contains(&format!("/scripts/{name}")));
    if down {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(json!({ "success": false, "errors": [{ "code": 10013 }] })),
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

fn job(base: &str, with_site: bool) -> PortalAddresses {
    let api = WorkersApi::new(
        base,
        AccountId::parse(ACCOUNT).unwrap(),
        SecretString::from("cf-test-token-not-real"),
    )
    .unwrap();
    let workers = WorkersDev::new(api, SUBDOMAIN, "{slug}-aarogyam", "aarogyam-portal").unwrap();
    PortalAddresses::WorkersDev(if with_site {
        workers.with_site("{slug}-site", "aarogyam-site").unwrap()
    } else {
        workers
    })
}

/// An app whose free site addresses are `<slug>-site.test-sub.workers.dev`, with every portal
/// host already served so the job's batches hold site hosts only.
async fn start() -> TestApp {
    let app = TestApp::start_custom(HttpConfig::default(), |state| {
        state.with_website(WebsiteLinks {
            sites_target: "aarogyam-site.test-sub.workers.dev".to_owned(),
            address_template: "{slug}-site.test-sub.workers.dev".to_owned(),
        })
    })
    .await;
    sqlx::query(
        "update aarogyam.org_domains set edge_status = 'ready', edge_next_attempt_at = null
         where kind = 'portal'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    app
}

async fn set_published(app: &TestApp, host: &str, token: &str, published: bool) -> Value {
    let (status, site) = app
        .send(
            Method::PATCH,
            host,
            SETTINGS,
            Some(token),
            Some(json!({ "published": published })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{site}");
    site
}

fn no_rows() -> Vec<(String, String, bool)> {
    Vec::new()
}

async fn site_rows(app: &TestApp, slug: &str) -> Vec<(String, String, bool)> {
    sqlx::query_as(
        "select d.hostname, d.edge_status, d.verified_at is not null from aarogyam.org_domains d
         join aarogyam.organizations o on o.id = d.org_id where o.slug = $1 and d.kind = 'site'",
    )
    .bind(slug)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn publishing_queues_the_address_and_the_job_makes_it_work_and_it_serves_only_that_clinic() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);

    // Nothing queued before a clinic publishes; Settings shows the address it will get.
    assert_eq!(site_rows(&app, "alpha").await, no_rows());
    let (_, before) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(before["domain"]["default_address"], ALPHA_SITE);
    assert_eq!(before["domain"]["address_status"], "none");

    let published = set_published(&app, ALPHA, &owner, true).await;
    assert_eq!(published["domain"]["default_address"], ALPHA_SITE);
    assert_eq!(published["domain"]["address_status"], "pending");
    assert_eq!(
        site_rows(&app, "alpha").await,
        vec![(ALPHA_SITE.into(), "pending".into(), true)]
    );

    // The job uploads alpha's forwarder to the site Worker (not the portal Worker), then turns
    // on its workers.dev address.
    let fake = Arc::new(Fake::default());
    let base = serve(Arc::clone(&fake)).await;
    let db = app.api_db();
    let report = job(&base, true)
        .provision(&db, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.ready, report.failed), (1, 1, 0));
    let calls = fake.calls();
    let script = format!("/client/v4/accounts/{ACCOUNT}/workers/scripts/alpha-site");
    assert_eq!(calls.len(), 2, "{calls:?}");
    assert_eq!(
        (&calls[0].method, calls[0].path.as_str()),
        (&Method::PUT, script.as_str())
    );
    for part in [
        r#""type":"service""#,
        r#""name":"SITE""#,
        r#""service":"aarogyam-site""#,
        "env.SITE.fetch(request)",
    ] {
        assert!(calls[0].body.contains(part), "{}", calls[0].body);
    }
    assert!(!calls[0].body.contains("aarogyam-portal"));
    assert_eq!(calls[1].path, format!("{script}/subdomain"));

    let (_, after) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(after["domain"]["address_status"], "ready");
    assert_eq!(after["domain"]["address_error"], Value::Null);

    // Saving again keeps the address as it is: nothing is queued or called.
    let again = set_published(&app, ALPHA, &owner, true).await;
    assert_eq!(again["domain"]["address_status"], "ready");
    let rerun = job(&base, true)
        .provision(&db, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(rerun.claimed, 0);

    // The public API serves alpha's site on alpha's site host, with no sign-in.
    let (status, page) = app.send(Method::GET, ALPHA_SITE, SITE, None, None).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(page["clinic"]["name"], "Alpha Dental");
    // Beta never published: its own hosts and a made-up site host answer 404, and alpha's
    // content never shows on them.
    for host in [BETA, BETA_SITE, "gamma-site.test-sub.workers.dev"] {
        let (status, body) = app.send(Method::GET, host, SITE, None, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{host}: {body}");
    }
    // A member of beta cannot use alpha's site host to read or change alpha's website.
    let beta_owner = app.token(BETA_OWNER);
    for method in [Method::GET, Method::PATCH] {
        let body = (method == Method::PATCH).then(|| json!({ "published": false }));
        let (status, _) = app
            .send(method, ALPHA_SITE, SETTINGS, Some(&beta_owner), body)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    let (_, still) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(still["published"], true);

    // Beta publishing gets beta's own address, and each host serves its own clinic.
    set_published(&app, BETA, &beta_owner, true).await;
    let (status, page) = app.send(Method::GET, BETA_SITE, SITE, None, None).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_ne!(page["clinic"]["name"], "Alpha Dental");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn taking_the_site_down_stops_it_at_once_and_the_job_removes_the_worker() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let fake = Arc::new(Fake::default());
    let base = serve(Arc::clone(&fake)).await;
    let db = app.api_db();
    let job = job(&base, true);

    set_published(&app, ALPHA, &owner, true).await;
    job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    let (status, _) = app.send(Method::GET, ALPHA_SITE, SITE, None, None).await;
    assert_eq!(status, StatusCode::OK);

    // Down: the public API stops serving at once, and Settings no longer shows an address in use.
    let down = set_published(&app, ALPHA, &owner, false).await;
    assert_eq!(down["published"], false);
    assert_eq!(down["domain"]["address_status"], "none");
    let (status, _) = app.send(Method::GET, ALPHA_SITE, SITE, None, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        site_rows(&app, "alpha").await,
        vec![(ALPHA_SITE.into(), "removing".into(), false)]
    );

    // Cloudflare is down: the removal is retried, not forgotten.
    fake.down.lock().unwrap().push("alpha-site".into());
    let failed = job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!((failed.claimed, failed.retrying), (1, 1));
    assert_eq!(site_rows(&app, "alpha").await[0].1, "removing");
    fake.down.lock().unwrap().clear();
    sqlx::query("update aarogyam.org_domains set edge_next_attempt_at = now() where kind = 'site'")
        .execute(&app.owner)
        .await
        .unwrap();
    let before = fake.calls().len();
    let removed = job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!((removed.claimed, removed.ready), (1, 1));
    let calls = fake.calls();
    let last = &calls[before..];
    assert_eq!(last.len(), 1, "{last:?}");
    assert_eq!(last[0].method, Method::DELETE);
    assert!(last[0].path.ends_with("/workers/scripts/alpha-site"));
    assert_eq!(site_rows(&app, "alpha").await, no_rows());

    // Publishing again brings it back: a new queued host, and the Worker is uploaded again.
    let back = set_published(&app, ALPHA, &owner, true).await;
    assert_eq!(back["domain"]["address_status"], "pending");
    let report = job.provision(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!((report.claimed, report.ready), (1, 1));
    let (status, _) = app.send(Method::GET, ALPHA_SITE, SITE, None, None).await;
    assert_eq!(status, StatusCode::OK);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_job_without_site_settings_fails_the_address_for_good_and_settings_say_why() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    set_published(&app, ALPHA, &owner, true).await;
    let fake = Arc::new(Fake::default());
    let base = serve(Arc::clone(&fake)).await;
    let db = app.api_db();
    let report = job(&base, false)
        .provision(&db, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.failed), (1, 1));
    assert!(fake.calls().is_empty(), "no Worker is touched");
    let (_, site) = app
        .send(Method::GET, ALPHA, SETTINGS, Some(&owner), None)
        .await;
    assert_eq!(site["domain"]["address_status"], "failed");
    assert_eq!(
        site["domain"]["address_error"],
        "site addresses are not configured"
    );
    // Publishing again (after the job is configured) queues it afresh.
    let retry = set_published(&app, ALPHA, &owner, true).await;
    assert_eq!(retry["domain"]["address_status"], "pending");
    let report = job(&base, true)
        .provision(&db, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.ready), (1, 1));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn with_a_wildcard_site_hosts_are_ready_and_removed_without_calling_cloudflare() {
    let app = start().await;
    let owner = app.token(ALPHA_OWNER);
    let db = app.api_db();
    set_published(&app, ALPHA, &owner, true).await;
    let ready = PortalAddresses::Wildcard
        .provision(&db, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((ready.claimed, ready.ready), (1, 1));
    assert_eq!(site_rows(&app, "alpha").await[0].1, "ready");
    set_published(&app, ALPHA, &owner, false).await;
    PortalAddresses::Wildcard
        .provision(&db, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(site_rows(&app, "alpha").await, no_rows());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_api_role_reaches_site_hosts_only_through_the_publish_functions() {
    let app = start().await;
    let db = app.api_db();
    let denied = sqlx::query("insert into aarogyam.org_domains (org_id, hostname, kind) select id, 'x-site.test-sub.workers.dev', 'site' from aarogyam.organizations limit 1")
        .execute(db.pool())
        .await;
    assert!(denied.is_err());
    // Outside a clinic transaction the functions refuse: there is no clinic to act for.
    let refused = sqlx::query("select app.site_host_publish('x-site.test-sub.workers.dev')")
        .execute(db.pool())
        .await;
    assert!(refused.is_err());
    app.finish().await;
}
