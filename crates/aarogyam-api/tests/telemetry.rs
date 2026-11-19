//! Phase 2 of the console's Insights: `POST /api/v1/telemetry` (page counters, page speed and
//! error classes from staff) and the durable per-route API counters, read back through
//! `/api/v1/console/insights/{routes,frontend,pages}`. Counts only: per clinic without a role,
//! per role without a clinic.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use aarogyam_api::{router, standard_throttle};
use axum::http::{Method, StatusCode};
use sakalya_http::HttpConfig;
use serde_json::{Value, json};
use support::people::{ALPHA_NOTHING, ALPHA_OWNER, BETA_OWNER, STAFF, STRANGER};
use support::{ALPHA, BETA, CONSOLE, TestApp, offline_state, send};
use time::OffsetDateTime;

fn batch() -> Value {
    json!({
        "pages": [
            { "route": "/patients/:id", "views": 3, "visible_ms": 9000 },
            // A real path (an ID, a name in the query) is never stored: it counts as `other`.
            { "route": "/patients/0192f1c4-0000-7000-8000-000000000000?name=Asha", "views": 1, "visible_ms": 500 }
        ],
        "vitals": [
            { "route": "/patients/:id", "name": "lcp", "value": 1800.0 },
            { "route": "/patients/:id", "name": "fid", "value": 10.0 }
        ],
        "errors": [ { "route": "/patients/:id", "class": "TypeError: Asha Rao", "count": 2 } ]
    })
}

async fn rows(app: &TestApp, sql: &str) -> Vec<Value> {
    sqlx::query_scalar::<_, Value>(sqlx::AssertSqlSafe(format!(
        "select coalesce(jsonb_agg(to_jsonb(t)), '[]') from ({sql}) t"
    )))
    .fetch_one(&app.owner)
    .await
    .unwrap()
    .as_array()
    .unwrap()
    .clone()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_clinic_batch_counts_per_clinic_without_role_and_per_role_without_clinic() {
    let app = TestApp::start().await;
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            Some(&app.token(ALPHA_OWNER)),
            Some(batch()),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let alpha = app.clinic_id("alpha").await;

    let clinic = rows(
        &app,
        "select org_id, app, route, views, visible_ms from private.ui_daily order by route",
    )
    .await;
    assert_eq!(clinic.len(), 2, "{clinic:?}");
    assert_eq!(clinic[0]["org_id"], alpha.to_string());
    assert_eq!(clinic[0]["route"], "/patients/:id");
    assert_eq!(clinic[0]["views"], 3);
    assert_eq!(clinic[1]["route"], "other");
    // The per-clinic table has no role column at all.
    let columns = rows(
        &app,
        "select column_name from information_schema.columns
          where table_schema = 'private' and table_name = 'ui_daily' and column_name like '%role%'",
    )
    .await;
    assert_eq!(columns.len(), 0);

    let everyone = rows(
        &app,
        "select app, role_key, route, views from private.ui_daily_all",
    )
    .await;
    assert_eq!(everyone.len(), 2);
    assert!(everyone.iter().all(|row| row["role_key"] == "owner"));
    let vitals = rows(
        &app,
        "select app, route, vital, buckets from private.vitals_daily",
    )
    .await;
    assert_eq!(vitals.len(), 1, "unknown vitals are dropped: {vitals:?}");
    assert_eq!(vitals[0]["vital"], "lcp");
    let errors = rows(&app, "select route, class, count from private.errors_daily").await;
    assert_eq!(
        errors,
        [json!({ "route": "/patients/:id", "class": "other", "count": 2 })]
    );

    // Any member may send, whatever their role: counters are not a permission.
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            Some(&app.token(ALPHA_NOTHING)),
            Some(batch()),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let views = rows(
        &app,
        "select views from private.ui_daily where route = '/patients/:id'",
    )
    .await;
    assert_eq!(views[0]["views"], 6);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn telemetry_never_crosses_clinics() {
    let app = TestApp::start().await;
    // A member of Alpha on Beta's host, and a stranger on Alpha's: the same 404 as any clinic
    // route, and nothing is counted for Beta.
    for (host, person) in [(BETA, ALPHA_OWNER), (ALPHA, STRANGER), (ALPHA, STAFF)] {
        let (status, _) = app
            .send(
                Method::POST,
                host,
                "/api/v1/telemetry",
                Some(&app.token(person)),
                Some(batch()),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{host}");
    }
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            None,
            Some(batch()),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // Beta's owner on Beta counts for Beta only.
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            "/api/v1/telemetry",
            Some(&app.token(BETA_OWNER)),
            Some(batch()),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let beta = app.clinic_id("beta").await;
    let clinics = rows(&app, "select distinct org_id from private.ui_daily").await;
    assert_eq!(clinics, [json!({ "org_id": beta.to_string() })]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_console_counts_its_own_pages_without_a_clinic() {
    let app = TestApp::start().await;
    let console_batch = json!({
        "pages": [
            { "route": "/health", "views": 2, "visible_ms": 4000 },
            { "route": "/patients/:id", "views": 1, "visible_ms": 10 }
        ],
        "vitals": [ { "route": "/health", "name": "inp", "value": 120.0 } ]
    });
    let (status, body) = app
        .send(
            Method::POST,
            CONSOLE,
            "/api/v1/telemetry",
            Some(&app.token(STAFF)),
            Some(console_batch.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    assert_eq!(rows(&app, "select 1 from private.ui_daily").await.len(), 0);
    let pages = rows(
        &app,
        "select app, role_key, route from private.ui_daily_all order by route",
    )
    .await;
    assert_eq!(pages.len(), 2);
    assert!(pages.iter().all(|row| row["app"] == "console"));
    // A portal route is not a console page.
    assert_eq!(pages[1]["route"], "other");
    // Clinic staff are not Sakalya staff.
    let (status, _) = app
        .send(
            Method::POST,
            CONSOLE,
            "/api/v1/telemetry",
            Some(&app.token(ALPHA_OWNER)),
            Some(console_batch),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn batches_are_capped_in_entries_size_and_per_clinic_per_day() {
    let app = TestApp::start().await;
    let token = app.token(ALPHA_OWNER);
    let many: Vec<Value> = (0..51)
        .map(|_| json!({ "route": "/today", "views": 1, "visible_ms": 1 }))
        .collect();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            Some(&token),
            Some(json!({ "pages": many })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let huge = json!({ "pages": [{ "route": "x".repeat(9_000), "views": 1, "visible_ms": 1 }] });
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            Some(&token),
            Some(huge),
        )
        .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    // End-to-end runs carry the throttle bypass header: answered, never counted.
    let (status, _, _) = app
        .send_full(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            Some(&token),
            Some(batch()),
            &[(sakalya_throttle::BYPASS_HEADER, "e2e")],
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(rows(&app, "select 1 from private.ui_daily").await.len(), 0);

    // A clinic at its daily cap: answered the same, nothing added.
    let alpha = app.clinic_id("alpha").await;
    sqlx::query(
        "insert into private.telemetry_quota (org_id, day, batches)
         select id, (now() at time zone timezone)::date, $2 from aarogyam.organizations where id = $1",
    )
    .bind(alpha)
    .bind(aarogyam_app::telemetry::DAILY_CAP)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            Some(&token),
            Some(batch()),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(rows(&app, "select 1 from private.ui_daily").await.len(), 0);
    app.finish().await;
}

#[tokio::test]
async fn telemetry_is_throttled_per_ip() {
    let app =
        router(offline_state(HttpConfig::default()).with_throttle(standard_throttle().unwrap()));
    // The throttle runs before the token is checked (the console host needs no clinic lookup).
    for _ in 0..30 {
        let (status, _) = send(
            &app,
            Method::POST,
            CONSOLE,
            "/api/v1/telemetry",
            None,
            Some(json!({})),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }
    let (status, _) = send(
        &app,
        Method::POST,
        CONSOLE,
        "/api/v1/telemetry",
        None,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn route_counters_add_up_across_flushes_and_read_back_durably() {
    let app = TestApp::start().await;
    let db = app.api_db();
    let hour = OffsetDateTime::now_utc()
        .replace_minute(0)
        .unwrap()
        .replace_second(0)
        .unwrap()
        .replace_nanosecond(0)
        .unwrap();
    let flush = |requests: i32, slow: i32| aarogyam_app::telemetry::RouteHourColumns {
        hours: vec![hour, hour],
        methods: vec!["GET".into(), "POST".into()],
        routes: vec!["/api/v1/patients/{id}".into(), "/api/v1/visits".into()],
        requests: vec![requests, 1],
        err_4xx: vec![1, 0],
        err_5xx: vec![0, 1],
        err_429: vec![0, 0],
        buckets: [
            [requests - slow, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, slow],
            [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
        ]
        .concat(),
    };
    // Two instances flushing the same hour: counts and buckets add, nothing is replaced.
    assert_eq!(
        aarogyam_app::telemetry::add_route_hours(&db, &flush(10, 0))
            .await
            .unwrap(),
        2
    );
    aarogyam_app::telemetry::add_route_hours(&db, &flush(10, 10))
        .await
        .unwrap();
    let stored = rows(
        &app,
        "select route, requests, err_4xx, buckets from private.api_route_hours order by route",
    )
    .await;
    assert_eq!(stored[0]["requests"], 20);
    assert_eq!(stored[0]["err_4xx"], 2);
    assert_eq!(
        stored[0]["buckets"],
        json!([10, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10])
    );
    assert_eq!(stored[1]["requests"], 2);

    // Staff read them back; clinic people may not.
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/insights/routes?range=24h",
            Some(&app.token(ALPHA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/insights/routes?range=1h",
            Some(&app.token(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let routes = body["routes"].as_array().unwrap();
    let patient = routes
        .iter()
        .find(|r| r["route"] == "/api/v1/patients/{id}")
        .unwrap();
    assert_eq!(patient["requests"], 20);
    assert_eq!(patient["errors_4xx"], 2);
    // Half the requests in the open bucket: the 95th percentile is the last bound.
    assert_eq!(patient["p95_ms"], 10_000.0);
    let visits = routes
        .iter()
        .find(|r| r["route"] == "/api/v1/visits")
        .unwrap();
    assert_eq!(visits["error_rate"], 1.0);

    // The drain job's clean-up leaves recent hours alone.
    let report = aarogyam_app::telemetry::clean_up(&db).await.unwrap();
    assert_eq!(report.folded, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_console_reads_pages_vitals_and_errors_with_small_numbers_hidden() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let readings: Vec<Value> = [900.0, 1100.0, 1500.0, 2000.0, 3000.0, 5000.0]
        .iter()
        .map(|value| json!({ "route": "/today", "name": "lcp", "value": value }))
        .collect();
    let first = json!({
        "pages": [
            { "route": "/today", "views": 8, "visible_ms": 80000 },
            { "route": "/queue", "views": 2, "visible_ms": 3000 }
        ],
        "vitals": readings,
        "errors": [ { "route": "/today", "class": "chunk_load", "count": 1 } ]
    });
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/telemetry",
            Some(&owner),
            Some(first),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    for path in [
        "/api/v1/console/insights/frontend?range=7d",
        "/api/v1/console/insights/pages?range=7d",
    ] {
        let (status, _) = app
            .send(Method::GET, CONSOLE, path, Some(&owner), None)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        let (status, _) = app
            .send(Method::GET, ALPHA, path, Some(&app.token(STAFF)), None)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }

    let staff = app.token(STAFF);
    let (status, front) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/insights/frontend?range=7d",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{front}");
    let lcp = &front["vitals"][0];
    assert_eq!(
        (lcp["app"].as_str(), lcp["vital"].as_str()),
        (Some("portal"), Some("lcp"))
    );
    assert_eq!(lcp["samples"], 6);
    assert_eq!(
        (&lcp["good"], &lcp["needs_work"], &lcp["poor"]),
        (&json!(4), &json!(1), &json!(1))
    );
    let p75 = lcp["p75"].as_f64().unwrap();
    assert!((2500.0..=4000.0).contains(&p75), "{p75}");
    assert_eq!(lcp["rating"], "needs_work");
    assert_eq!(front["thresholds"].as_array().unwrap().len(), 4);
    assert_eq!(front["errors"][0]["class"], "chunk_load");

    let (status, pages) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/insights/pages?range=7d",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{pages}");
    let list = pages["pages"].as_array().unwrap();
    let today = list.iter().find(|p| p["route"] == "/today").unwrap();
    assert_eq!(today["avg_visible_ms"], 10_000.0);
    // Two views are too few to time.
    let queue = list.iter().find(|p| p["route"] == "/queue").unwrap();
    assert!(queue["visible_ms"].is_null() && queue["avg_visible_ms"].is_null());
    assert_eq!(pages["roles"][0]["role_key"], "owner");
    let clinic = &pages["clinics"][0];
    assert_eq!(clinic["slug"], "alpha");
    assert_eq!(clinic["views"], 10);
    // Per clinic: totals only, no role and no page.
    assert!(clinic.get("role_key").is_none() && clinic.get("route").is_none());
    app.finish().await;
}
