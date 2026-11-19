//! The console's Insights: database history, journeys, active staff and onboarding
//! (`/api/v1/console/insights/*`), and the 30-day range and source on `/console/metrics`.
//! Sakalya staff only; numbers and dates only.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use support::people::{ALPHA_OWNER, STAFF, STRANGER};
use support::{ALPHA, CONSOLE, TestApp};

const ROUTES: [&str; 2] = [
    "/api/v1/console/insights/db?range=24h",
    "/api/v1/console/insights/usage?range=7d",
];

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn insights_are_for_sakalya_staff_only() {
    let app = TestApp::start().await;
    for path in ROUTES {
        for person in [ALPHA_OWNER, STRANGER] {
            let (status, body) = app
                .send(Method::GET, CONSOLE, path, Some(&app.token(person)), None)
                .await;
            assert_eq!(status, StatusCode::FORBIDDEN, "{path}: {body}");
        }
        // Not on a clinic's host, even for staff.
        let (status, _) = app
            .send(Method::GET, ALPHA, path, Some(&app.token(STAFF)), None)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
        let (status, body) = app
            .send(Method::GET, CONSOLE, path, Some(&app.token(STAFF)), None)
            .await;
        assert_eq!(status, StatusCode::OK, "{path}: {body}");
    }
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/insights/db?range=2h",
            Some(&app.token(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn metrics_take_thirty_days_and_say_where_they_come_from() {
    let app = TestApp::start().await;
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/metrics?range=30d",
            Some(&app.token(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["range"], "30d");
    // No metadata server in tests: the answering instance's own numbers.
    assert_eq!(body["source"], "instance");
    assert!(body["cloud"].is_null());
    assert!(body["cloud_error"].is_null());
    assert_eq!(body["api"]["timeline"].as_array().unwrap().len(), 120);
    assert_eq!(body["api"]["timeline_interval_seconds"], 21_600);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn database_samples_are_taken_at_most_every_five_minutes() {
    let app = TestApp::start().await;
    let db = app.api_db();
    assert!(aarogyam_app::insights::record_db_sample(&db).await.unwrap());
    assert!(!aarogyam_app::insights::record_db_sample(&db).await.unwrap());
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/insights/db?range=1h",
            Some(&app.token(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["interval_seconds"], 300);
    assert_eq!(body["size_limit_bytes"], 500 * 1024 * 1024);
    let samples = body["samples"].as_array().unwrap();
    assert_eq!(samples.len(), 1, "{body}");
    assert!(samples[0]["db_bytes"].as_i64().unwrap() > 0);
    assert!(samples[0]["connections"].as_i64().unwrap() >= 1);
    // One sample has no earlier one to make a rate from.
    assert!(samples[0]["commits_per_min"].is_null());
    assert!(body["current"]["size_bytes"].as_i64().unwrap() > 0);
    app.finish().await;
}

/// The last 7 days of usage, as Sakalya staff see them.
async fn usage_week(app: &TestApp) -> serde_json::Value {
    let (status, body) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/insights/usage?range=7d",
            Some(&app.token(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn journeys_are_recorded_once_a_day_and_roles_need_three_people() {
    let app = TestApp::start().await;
    let owner = app.owner_db();
    // The seeded clinics were created just now; give them a yesterday. The row trigger keeps
    // created_at as inserted, so it is paused for this one change.
    let mut tx = owner.pool().begin().await.unwrap();
    for statement in [
        "alter table aarogyam.organizations disable trigger set_row_times",
        "update aarogyam.organizations set created_at = now() - interval '3 days'",
        "alter table aarogyam.organizations enable trigger set_row_times",
    ] {
        sqlx::query(statement).execute(&mut *tx).await.unwrap();
    }
    tx.commit().await.unwrap();
    let db = app.api_db();
    let first = aarogyam_app::insights::record_journeys(&db).await.unwrap();
    assert!(first.due >= 2, "{first:?}");
    assert_eq!((first.written, first.failed), (first.due, 0));
    // Every clinic has its row now, idle ones included: nobody is picked again.
    let again = aarogyam_app::insights::record_journeys(&db).await.unwrap();
    assert_eq!(again.due, 0);

    // Alpha had three doctors and two front-desk people signed in.
    let alpha = app.clinic_id("alpha").await;
    sqlx::query(
        "with d as (select day from private.journey_daily where org_id = $1)
         insert into private.active_daily (org_id, day, role_key, members)
         select $1, d.day, r.role_key, r.members from d,
                (values ('doctor', 3), ('front_desk', 2)) as r (role_key, members)
         on conflict (org_id, day, role_key) do update set members = excluded.members",
    )
    .bind(alpha)
    .execute(owner.pool())
    .await
    .unwrap();
    sqlx::query("delete from private.active_daily where org_id = $1 and role_key not in ('doctor', 'front_desk')")
        .bind(alpha)
        .execute(owner.pool())
        .await
        .unwrap();

    let body = usage_week(&app).await;
    let clinics = body["clinics"].as_array().unwrap();
    let alpha_row = clinics.iter().find(|row| row["slug"] == "alpha").unwrap();
    assert_eq!(alpha_row["visits"], 0);
    assert_eq!(alpha_row["active_staff"], 5);
    // Per clinic, a role shows only with 3 or more people.
    assert_eq!(
        alpha_row["roles"],
        serde_json::json!([{ "role_key": "doctor", "members": 3 }])
    );
    assert!(alpha_row["timings"]["visit_minutes"].is_null());
    // With fewer than 3 clinics signed in, roles "across clinics" would be theirs: none shown.
    assert_eq!(body["roles"], serde_json::json!([]));

    // A third clinic, and someone signed in at each: now the breakdown shows.
    let (status, created) = app
        .send(
            Method::POST,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&app.token(STAFF)),
            Some(serde_json::json!({ "name": "Gamma Dental", "owner_email": "owner@gamma.test" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    sqlx::query(
        "insert into private.active_daily (org_id, day, role_key, members)
         select o.id, d.day, 'doctor', 1
         from aarogyam.organizations o,
              (select day from private.journey_daily where org_id = $1) d
         where o.id <> $1
         on conflict (org_id, day, role_key) do nothing",
    )
    .bind(alpha)
    .execute(owner.pool())
    .await
    .unwrap();
    let body = usage_week(&app).await;
    // Across clinics every role shows, without naming a clinic.
    let roles = body["roles"].as_array().unwrap();
    let front_desk = roles.iter().find(|row| row["role_key"] == "front_desk");
    assert_eq!(front_desk.unwrap()["members"], 2);
    assert!(roles.iter().all(|row| row.get("org_id").is_none()));
    let days = body["days"].as_array().unwrap();
    assert_eq!(days.len(), 1, "{body}");
    assert!(days[0]["clinics"].as_i64().unwrap() >= 2);

    let onboarding = body["onboarding"].as_array().unwrap();
    let alpha_onboarding = onboarding
        .iter()
        .find(|row| row["slug"] == "alpha")
        .unwrap();
    assert!(alpha_onboarding["created_at"].is_string());
    assert!(alpha_onboarding["setup_steps_done"].is_number());
    app.finish().await;
}
