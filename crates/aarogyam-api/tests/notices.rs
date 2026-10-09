//! The clinic's privacy notice versions on a real database: publishing, listing, consents
//! recording the current version (walk-ins too), the old label still accepted, roles, other
//! clinics, and versions that can't be edited.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one journey end to end, step by step"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), Some(body))
        .await
}

async fn publish(app: &TestApp, token: &str, label: &str) -> (StatusCode, Value) {
    let body =
        json!({ "label": label, "body": format!("Notice {label}.\nWe keep your record safe.") });
    post(app, ALPHA, token, "/api/v1/consent-notices", body).await
}

async fn patient(app: &TestApp, host: &str, token: &str) -> String {
    let (status, made) = post(
        app,
        host,
        token,
        "/api/v1/patients",
        json!({ "full_name": "Ravi K" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn consents_record_the_current_notice_version() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let ravi = patient(&app, ALPHA, &owner).await;
    let consents = format!("/api/v1/patients/{ravi}/consents");

    // Before any notice: the template's label, no notice id.
    let (status, early) = post(
        &app,
        ALPHA,
        &owner,
        &consents,
        json!({ "purpose": "research", "method": "paper" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{early}");
    assert_eq!(
        (
            early["notice_version"].as_str(),
            early["notice_id"].is_null()
        ),
        (Some("v1 2026-10"), true)
    );

    let (status, v1) = publish(&app, &owner, "v1 2026-11").await;
    assert_eq!(status, StatusCode::CREATED, "{v1}");
    assert_eq!(v1["version"], 1);
    assert_eq!(v1["published_by"], "Asha Owner");
    let (_, v2) = publish(&app, &owner, "v2 2026-12").await;
    assert_eq!(v2["version"], 2);
    let (status, listed) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/consent-notices",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let labels: Vec<&str> = listed["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["label"].as_str().unwrap())
        .collect();
    assert_eq!(labels, ["v2 2026-12", "v1 2026-11"]);

    // No notice named: the current one. A named one: that one. The old label: kept as given.
    let (_, care) = post(
        &app,
        ALPHA,
        &owner,
        &consents,
        json!({ "purpose": "care", "method": "verbal" }),
    )
    .await;
    assert_eq!(
        (care["notice_id"].clone(), care["notice_version"].clone()),
        (v2["id"].clone(), json!("v2 2026-12"))
    );
    let (_, reminders) = post(
        &app,
        ALPHA,
        &owner,
        &consents,
        json!({ "purpose": "reminders", "method": "paper", "notice_id": v1["id"] }),
    )
    .await;
    assert_eq!(reminders["notice_version"], "v1 2026-11");
    let (_, legacy) = post(
        &app,
        ALPHA,
        &owner,
        &consents,
        json!({ "purpose": "sharing", "method": "paper", "notice_version": "paper form 3" }),
    )
    .await;
    assert_eq!(
        (
            legacy["notice_version"].as_str(),
            legacy["notice_id"].is_null()
        ),
        (Some("paper form 3"), true)
    );
    let (status, _) = post(&app, ALPHA, &owner, &consents,
        json!({ "purpose": "promotional", "method": "paper", "notice_id": "01900000-0000-7000-8000-000000000999" })).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // A walk-in's desk consent records the current notice too.
    let other = patient(&app, ALPHA, &owner).await;
    let walk_in =
        json!({ "patient_id": other, "consents": [{ "purpose": "care", "method": "verbal" }] });
    let (status, done) = post(&app, ALPHA, &owner, "/api/v1/walk-ins", walk_in).await;
    assert_eq!(status, StatusCode::CREATED, "{done}");
    let (_, theirs) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{other}/consents"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(theirs["items"][0]["notice_id"], v2["id"]);

    for body in [
        json!({ "label": "", "body": "x" }),
        json!({ "label": "v3", "body": "  " }),
    ] {
        let (status, _) = post(&app, ALPHA, &owner, "/api/v1/consent-notices", body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn roles_other_clinics_and_frozen_versions() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, v1) = publish(&app, &owner, "v1").await;

    // The desk reads notices but can't publish; a role with nothing can't read them.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/consent-notices",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = publish(&app, &desk, "v2").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/consent-notices",
            Some(&nothing),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic sees none of Alpha's notices, gets 404 on Alpha's host, and can't record
    // a consent against Alpha's notice.
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/consent-notices",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, home) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/consent-notices",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!((status, home["items"].clone()), (StatusCode::OK, json!([])));
    let theirs = patient(&app, BETA, &beta).await;
    let (status, _) = post(
        &app,
        BETA,
        &beta,
        &format!("/api/v1/patients/{theirs}/consents"),
        json!({ "purpose": "care", "method": "paper", "notice_id": v1["id"] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // A published version can't be changed or removed, even directly.
    let alpha = app.clinic_id("alpha").await;
    let changed = app
        .api_db()
        .scoped(&Scope::tenant(alpha), async |tx| {
            sqlx::query("update aarogyam.consent_notices set body = 'changed'")
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await;
    assert!(changed.is_err());
    let body: String = sqlx::query_scalar("select body from aarogyam.consent_notices")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert!(body.starts_with("Notice v1."));
    app.finish().await;
}
