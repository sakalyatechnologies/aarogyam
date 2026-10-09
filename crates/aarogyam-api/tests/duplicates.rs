//! Online sign-ups that share a phone with a clinic's patient on a real database: flagged,
//! never merged by themselves, listed for the front desk, merged or dismissed, roles and other
//! clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

fn day(days: i64) -> Date {
    OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date()
        + Duration::days(days)
}

async fn send(
    app: &TestApp,
    host: &str,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

/// A doctor working 09:00-10:00 every day and a registered patient with phone 98765 43210 and
/// no email; returns the doctor, the patient and the owner's token.
async fn clinic(app: &TestApp) -> (String, String, String) {
    let owner = app.token(ALPHA_OWNER);
    let post = |path: &'static str, body: Value| {
        let owner = owner.clone();
        async move {
            let (status, value) = send(app, ALPHA, &owner, Method::POST, path, Some(body)).await;
            assert_eq!(status, StatusCode::CREATED, "{value}");
            value["id"].as_str().unwrap().to_owned()
        }
    };
    let doctor = post(
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha" }),
    )
    .await;
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "09:00", "ends": "10:00" }))
        .collect();
    let path = format!("/api/v1/practitioners/{doctor}/working-hours");
    let (status, _) = send(
        app,
        ALPHA,
        &owner,
        Method::PUT,
        &path,
        Some(json!({ "shifts": shifts })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let patient = post(
        "/api/v1/patients",
        json!({ "full_name": "Kavita Rao", "phone": "98765 43210", "sex": "female", "age_years": 33 }),
    )
    .await;
    (doctor, patient, owner)
}

/// Books 09:00 + `minutes` two days ahead online as `email`, phone 98765 43210; returns the
/// booked patient's id.
async fn book_online(app: &TestApp, doctor: &str, email: &str, minutes: i64) -> Uuid {
    let token = app
        .tokens
        .mint_with_email(Uuid::now_v7(), Some(email))
        .unwrap();
    let starts = format!("{}T09:{minutes:02}:00+05:30", day(2));
    let body = json!({ "starts_at": starts, "practitioner_id": doctor,
                       "full_name": "Kavita R", "phone": "98765 43210" });
    let (status, booked) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/public/bookings",
            Some(&token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{booked}");
    sqlx::query_scalar("select patient_id from aarogyam.appointments where id = $1")
        .bind(Uuid::parse_str(booked["id"].as_str().unwrap()).unwrap())
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

async fn flags(app: &TestApp, host: &str, token: &str) -> (StatusCode, Value) {
    send(
        app,
        host,
        token,
        Method::GET,
        "/api/v1/patient-duplicates",
        None,
    )
    .await
}

async fn merge(
    app: &TestApp,
    host: &str,
    token: &str,
    from: &str,
    into: &str,
) -> (StatusCode, Value) {
    let path = format!("/api/v1/patients/{from}/merge");
    send(
        app,
        host,
        token,
        Method::POST,
        &path,
        Some(json!({ "into_patient_id": into })),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_phone_match_is_flagged_never_merged_then_merged_by_the_desk() {
    let app = TestApp::start().await;
    let (doctor, known, _) = clinic(&app).await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let online = book_online(&app, &doctor, "kavita@example.test", 0).await;
    assert_ne!(
        online.to_string(),
        known,
        "a phone match is never used by itself"
    );

    let (status, listed) = flags(&app, ALPHA, &desk).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let items = listed["items"].as_array().unwrap();
    assert_eq!(items.len(), 1, "{listed}");
    assert_eq!(items[0]["reason"], "phone");
    assert_eq!(items[0]["patient"]["id"], online.to_string());
    assert_eq!(items[0]["candidate"]["id"], known);
    assert_eq!(items[0]["candidate"]["age_years"], 33);

    // The calendar says the online record still needs sex and age.
    let range = format!("/api/v1/appointments?from={0}&to={0}", day(2));
    let (_, calendar) = send(&app, ALPHA, &desk, Method::GET, &range, None).await;
    assert_eq!(
        calendar["items"][0]["patient"]["registration_incomplete"],
        true
    );

    let (status, merged) = merge(&app, ALPHA, &desk, &online.to_string(), &known).await;
    assert_eq!(status, StatusCode::OK, "{merged}");
    assert_eq!(merged["appointments_moved"], 1);
    let (_, calendar) = send(&app, ALPHA, &desk, Method::GET, &range, None).await;
    assert_eq!(calendar["items"][0]["patient"]["id"], known.as_str());
    assert_eq!(
        calendar["items"][0]["patient"]["registration_incomplete"],
        false
    );
    let (status, email, merged_into): (String, Option<String>, Option<Uuid>) = sqlx::query_as(
        "select s.status, t.email, s.merged_into_id from aarogyam.patients s, aarogyam.patients t
         where s.id = $1 and t.id = $2::uuid",
    )
    .bind(online)
    .bind(&known)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(status, "merged");
    assert_eq!(merged_into.unwrap().to_string(), known);
    assert_eq!(email.as_deref(), Some("kavita@example.test"));
    let (_, after) = flags(&app, ALPHA, &desk).await;
    assert_eq!(after["items"], json!([]));
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events where table_name = 'aarogyam.patients' and action = 'update'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(audited >= 2, "both records' changes are in the history");

    // The same person booking again is matched to the remaining record; nothing new is made.
    let again = book_online(&app, &doctor, "kavita@example.test", 15).await;
    assert_eq!(again.to_string(), known);
    let (status, _) = merge(&app, ALPHA, &desk, &online.to_string(), &known).await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn merges_are_refused_when_unsafe_and_follow_roles_and_clinics() {
    let app = TestApp::start().await;
    let (doctor, known, owner) = clinic(&app).await;
    let first = book_online(&app, &doctor, "one@example.test", 0)
        .await
        .to_string();
    let second = book_online(&app, &doctor, "two@example.test", 15)
        .await
        .to_string();

    // Only a self-registered record merges away, never into itself, and never once it holds
    // clinical records (here: "No known allergies" recorded).
    let (status, _) = merge(&app, ALPHA, &owner, &known, &first).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = merge(&app, ALPHA, &owner, &first, &first).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    sqlx::query("update aarogyam.patients set allergies_reviewed = 'none_known', allergies_reviewed_at = now() where id = $1::uuid")
        .bind(&second)
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, _) = merge(&app, ALPHA, &owner, &second, &known).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The assistant sees the flags but can't resolve them; a role with nothing can't see them.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, listed) = flags(&app, ALPHA, &assistant).await;
    assert_eq!(status, StatusCode::OK);
    let flag = listed["items"][0]["id"].as_str().unwrap().to_owned();
    let dismiss = format!("/api/v1/patient-duplicates/{flag}/dismiss");
    let (status, _) = send(&app, ALPHA, &assistant, Method::POST, &dismiss, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = merge(&app, ALPHA, &assistant, &first, &known).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = flags(&app, ALPHA, &app.token(ALPHA_NOTHING)).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic sees none of them and gets 404 for Alpha's flag and records.
    let beta = app.token(BETA_OWNER);
    let (status, home) = flags(&app, BETA, &beta).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(home["items"], json!([]));
    let (status, _) = send(&app, BETA, &beta, Method::POST, &dismiss, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = merge(&app, BETA, &beta, &first, &known).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The desk dismisses a flag once.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = send(&app, ALPHA, &desk, Method::POST, &dismiss, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(&app, ALPHA, &desk, Method::POST, &dismiss, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Three flags were open: each online record against Kavita, and the second against the
    // first (same phone too). Two are left.
    let (_, left) = flags(&app, ALPHA, &desk).await;
    assert_eq!(left["items"].as_array().unwrap().len(), 2);
    app.finish().await;
}
