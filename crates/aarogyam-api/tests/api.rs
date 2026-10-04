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
                Method::POST,
                BETA,
                "/api/v1/patients/search",
                Some(&beta),
                Some(json!({ "q": query })),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["items"].as_array().unwrap().len(), 0, "{query}");
        // Alpha's own search does find it.
        let (_, own) = app
            .send(
                Method::POST,
                ALPHA,
                "/api/v1/patients/search",
                Some(&alpha),
                Some(json!({ "q": query })),
            )
            .await;
        assert_eq!(own["items"].as_array().unwrap().len(), 1, "{query}");
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
async fn editing_a_patient_follows_the_registration_rules() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let patient = register(&app, ALPHA, &desk, "Kavya Rao", "98100 00011").await;
    let path = format!("/api/v1/patients/{}", patient["id"].as_str().unwrap());

    let (status, edited) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "full_name": " Kavya  Rao Iyer ", "phone": "98100 00012", "date_of_birth": "1990-05-01" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["full_name"], "Kavya Rao Iyer");
    assert_eq!(edited["phone"], "+919810000012");
    assert_eq!(edited["date_of_birth"], "1990-05-01");
    assert_eq!(edited["birth_date_estimated"], false);
    assert_eq!(edited["number"], patient["number"]);
    // The change history holds the changed columns only.
    let (history,): (Value,) = sqlx::query_as(
        "select changes from audit.audit_events
         where table_name = 'aarogyam.patients' and row_id = $1::uuid and action = 'update'",
    )
    .bind(patient["id"].as_str().unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let mut changed: Vec<&str> = history
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    changed.sort_unstable();
    assert_eq!(
        changed,
        [
            "birth_date_estimated",
            "date_of_birth",
            "full_name",
            "phone_e164",
            "search_name"
        ]
    );

    // Invalid input names the field; giving both a date of birth and an age is refused.
    for (body, field) in [
        (json!({ "full_name": "" }), "full_name"),
        (
            json!({ "date_of_birth": "1990-01-01", "age_years": 30 }),
            "date_of_birth",
        ),
        (json!({ "email": "not-an-email" }), "email"),
    ] {
        let (status, error) = app
            .send(Method::PATCH, ALPHA, &path, Some(&desk), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn editing_contact_details_needs_patients_contact() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let patient = register(&app, ALPHA, &desk, "Kavya Rao", "98100 00011").await;
    let path = format!("/api/v1/patients/{}", patient["id"].as_str().unwrap());

    // Without patients.write: 403. With it but without patients.contact: names yes, phone no.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&assistant),
            Some(json!({ "sex": "male" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    sqlx::raw_sql(
        "insert into aarogyam.role_permissions (org_id, role_id, permission)
         select org_id, id, p from aarogyam.roles, unnest(array['patients.read', 'patients.write']) p
         where key = 'nothing'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let writer = app.token(ALPHA_NOTHING);
    let (status, body) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&writer),
            Some(json!({ "preferred_language": "kn-IN" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["phone"].as_str().unwrap().contains('*'));
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&writer),
            Some(json!({ "phone": "+919810000012" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic can't edit it, on its own host or on Alpha's.
    let beta = app.token(BETA_OWNER);
    for host in [BETA, ALPHA] {
        let (status, _) = app
            .send(
                Method::PATCH,
                host,
                &path,
                Some(&beta),
                Some(json!({ "sex": "male" })),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{host}");
    }
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

/// `path` with every `{parameter}` replaced by a UUID that names nothing.
fn concrete_path(path: &str) -> String {
    let mut concrete = String::with_capacity(path.len());
    let mut rest = path;
    while let Some(start) = rest.find('{') {
        concrete.push_str(&rest[..start]);
        concrete.push_str("0192f1c4-0000-7000-8000-000000000000");
        rest = rest[start..].split_once('}').map_or("", |(_, after)| after);
    }
    concrete.push_str(rest);
    concrete
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
        // Development sign-in and internal jobs exist only locally; internal jobs will check
        // Cloud Scheduler's signed token instead of a member's.
        // Public by design, listed one by one: a patient opens a link with its token and the
        // PIN on the paper, and anyone may check a prescription's QR code. Both are on the
        // clinic's host and reveal nothing about a patient without the token and PIN.
        let public = [
            "/api/v1/shared/{token}",
            "/api/v1/shared/{token}/open",
            "/api/v1/verify/prescriptions/{verify_token}",
        ];
        if !path.starts_with("/api/v1/")
            || path.starts_with("/api/v1/dev/")
            || path.starts_with("/api/v1/internal/")
            || public.contains(&path.as_str())
        {
            continue;
        }
        let concrete = concrete_path(path);
        for method in operations.as_object().unwrap().keys() {
            let method: Method = method.to_uppercase().parse().unwrap();
            let host = if path.starts_with("/api/v1/console/") {
                CONSOLE
            } else {
                ALPHA
            };
            let body = matches!(method, Method::POST | Method::PATCH).then(|| json!({}));
            let (status, _) = app
                .send(method.clone(), host, &concrete, None, body.clone())
                .await;
            assert_eq!(
                status,
                StatusCode::UNAUTHORIZED,
                "{method} {path} without a token"
            );
            let signed_in_only = [
                "/api/v1/me",
                "/api/v1/me/sessions",
                "/api/v1/me/sessions/{id}/revoke",
                "/api/v1/session",
                "/api/v1/invitations/accept",
            ];
            let clinic_route = host == ALPHA && !signed_in_only.contains(&path.as_str());
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

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_invited_owner_joins_with_the_verified_email() {
    let app = TestApp::start().await;
    let staff = app.token(STAFF);
    let (status, created) = app
        .send(
            Method::POST,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(&staff),
            Some(json!({ "name": "Gamma Dental", "owner_email": "Owner@Gamma.test" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let invite = json!({ "token": created["invite_token"], "display_name": "Gita Owner" });
    let host = created["portal_host"].as_str().unwrap().to_owned();

    // Someone else, signed in with another address, can't use it.
    let intruder = app
        .tokens
        .mint_with_email(uuid::Uuid::now_v7(), Some("intruder@example.test"))
        .unwrap();
    let (status, _) = app
        .send(
            Method::POST,
            "app.localtest.me",
            "/api/v1/invitations/accept",
            Some(&intruder),
            Some(invite.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The owner, signed in with the invited address, joins and can use the clinic.
    let owner = app
        .tokens
        .mint_with_email(uuid::Uuid::now_v7(), Some("owner@gamma.test"))
        .unwrap();
    let (status, _) = app
        .send(Method::GET, &host, "/api/v1/session", Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, joined) = app
        .send(
            Method::POST,
            "app.localtest.me",
            "/api/v1/invitations/accept",
            Some(&owner),
            Some(invite.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{joined}");
    assert_eq!(joined["org_id"], created["id"]);
    let (status, session) = app
        .send(Method::GET, &host, "/api/v1/session", Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session["membership"]["role_key"], "owner");
    assert_eq!(session["user"]["display_name"], "Gita Owner");

    // An invitation works once.
    let (status, _) = app
        .send(
            Method::POST,
            "app.localtest.me",
            "/api/v1/invitations/accept",
            Some(&owner),
            Some(invite),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
