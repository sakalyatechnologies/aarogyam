//! The API end to end on a real database: isolation between clinics, sign-in, permissions,
//! masking, the access record, the console, and a route audit.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, CONSOLE, TestApp};

async fn register(app: &TestApp, host: &str, token: &str, name: &str, phone: &str) -> Value {
    let (status, body) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name, "sex": "female", "age_years": 36, "phone": phone })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn clinics_never_see_each_other() {
    let app = TestApp::start().await;
    let alpha = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);

    let patient = register(&app, ALPHA, &alpha, "Priya Sharma", "98765 43210").await;
    assert_eq!(patient["number"], "AD-1");
    assert_eq!(patient["age_years"], 36);
    let id = patient["id"].as_str().unwrap().to_owned();
    let path = format!("/api/v1/patients/{id}");

    let (status, _) = app
        .send(Method::GET, ALPHA, &path, Some(&alpha), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    // Beta's owner can't open it on Beta's host, nor on Alpha's (not a member there).
    let (status, _) = app.send(Method::GET, BETA, &path, Some(&beta), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app.send(Method::GET, ALPHA, &path, Some(&beta), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Beta's search doesn't find Alpha's patient by name or phone.
    for query in ["priya", "9876543210", "AD-1"] {
        let (status, body) = app
            .send(
                Method::GET,
                BETA,
                &format!("/api/v1/patients?q={query}"),
                Some(&beta),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["items"].as_array().unwrap().len(), 0, "{query}");
    }
    // Numbers are per clinic.
    let beta_patient = register(&app, BETA, &beta, "Priya Sharma", "98765 43210").await;
    assert_eq!(beta_patient["number"], "BD-1");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn sign_in_and_hosts_are_checked() {
    let app = TestApp::start().await;
    let alpha = app.token(ALPHA_OWNER);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/patients",
            Some("not-a-token"),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(
            Method::GET,
            "nope.localtest.me",
            "/api/v1/patients",
            Some(&alpha),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::GET, CONSOLE, "/api/v1/patients", Some(&alpha), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let stranger = app.token(STRANGER);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&stranger), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, session) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&alpha), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session["clinic"]["slug"], "alpha");
    assert_eq!(session["membership"]["role_key"], "owner");
    assert_eq!(session["user"]["display_name"], "Asha Owner");

    let (status, me) = app
        .send(
            Method::GET,
            "app.localtest.me",
            "/api/v1/me",
            Some(&alpha),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["clinics"][0]["host"], ALPHA);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn permissions_and_masking_follow_the_role() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    let patient = register(&app, ALPHA, &desk, "Meera Pillai", "+91 98100 00007").await;
    assert_eq!(patient["phone"], "+919810000007");
    let path = format!("/api/v1/patients/{}", patient["id"].as_str().unwrap());

    // The assistant may read but not register, and sees the phone masked.
    let (status, body) = app
        .send(Method::GET, ALPHA, &path, Some(&assistant), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let masked = body["phone"].as_str().unwrap();
    assert!(masked.contains('*') && masked.ends_with("0007"), "{masked}");
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&assistant),
            Some(json!({ "full_name": "X Y" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");

    // Invalid input names the field and never echoes the value.
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&desk),
            Some(json!({ "full_name": "A B", "email": "secret-value" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let message = body["error"]["message"].as_str().unwrap();
    assert!(
        message.starts_with("email") && !message.contains("secret-value"),
        "{message}"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn opening_a_record_writes_the_access_record() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let patient = register(&app, ALPHA, &desk, "Rahul Verma", "98100 00002").await;
    let id = patient["id"].as_str().unwrap();
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{id}"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (count, purpose): (i64, String) = sqlx::query_as(
        "select count(*), max(purpose) from audit.access_log where patient_id = $1::uuid and action = 'view'",
    )
    .bind(id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((count, purpose.as_str()), (1, "front_desk"));
    // The change history recorded the insert with who and when only.
    let (changes,): (Option<Value>,) = sqlx::query_as(
        "select changes from audit.audit_events where table_name = 'aarogyam.patients' and row_id = $1::uuid",
    )
    .bind(id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(changes, None);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_console_is_for_staff_only() {
    let app = TestApp::start().await;
    let staff = app.token(STAFF);
    let owner = app.token(ALPHA_OWNER);
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/console/clinics",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, created) = app
        .send(
            Method::POST,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&staff),
            Some(json!({ "name": "Gamma Dental Care", "owner_email": "Owner@Gamma.test" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["slug"], "gamma-dental-care");
    assert_eq!(created["portal_host"], "gamma-dental-care.localtest.me");
    assert_eq!(created["invite_token"].as_str().unwrap().len(), 43);
    let (status, _) = app
        .send(
            Method::POST,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&staff),
            Some(json!({ "name": "Gamma Dental Care", "owner_email": "x@gamma.test" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, list) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 3);
    let (status, metrics) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/metrics?range=24h",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(metrics["db"]["size_bytes"].as_i64().unwrap() > 0);
    app.finish().await;
}

/// Every route under /api/v1 refuses a request without a token, and every clinic route except
/// the session checks a permission: a member whose role has none gets 403.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn every_route_requires_sign_in_and_a_permission() {
    let app = TestApp::start().await;
    let nothing = app.token(ALPHA_NOTHING);
    let document = serde_json::to_value(aarogyam_api::openapi()).unwrap();
    let mut checked = 0;
    for (path, operations) in document["paths"].as_object().unwrap() {
        if !path.starts_with("/api/v1/") || path.starts_with("/api/v1/dev/") {
            continue;
        }
        let concrete = path.replace("{id}", "0192f1c4-0000-7000-8000-000000000000");
        for method in operations.as_object().unwrap().keys() {
            let method: Method = method.to_uppercase().parse().unwrap();
            let host = if path.starts_with("/api/v1/console/") {
                CONSOLE
            } else {
                ALPHA
            };
            let body = (method == Method::POST).then(|| json!({}));
            let (status, _) = app
                .send(method.clone(), host, &concrete, None, body.clone())
                .await;
            assert_eq!(
                status,
                StatusCode::UNAUTHORIZED,
                "{method} {path} without a token"
            );
            let clinic_route = host == ALPHA && path != "/api/v1/me" && path != "/api/v1/session";
            if clinic_route {
                let (status, _) = app
                    .send(method.clone(), host, &concrete, Some(&nothing), body)
                    .await;
                assert_eq!(
                    status,
                    StatusCode::FORBIDDEN,
                    "{method} {path} without a permission"
                );
            }
            checked += 1;
        }
    }
    assert!(checked >= 7, "only {checked} routes checked");
    app.finish().await;
}
