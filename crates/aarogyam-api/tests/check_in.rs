//! Checking in an online sign-up on a real database: registration completed, allergies and
//! consents recorded and the patient arrived in one call, once; bad input, roles, other clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime, UtcOffset};
use uuid::Uuid;

/// An online booking for tomorrow at 09:00 with a doctor working 09:00-10:00; returns the
/// appointment's check-in path and the appointment id.
async fn online_booking(app: &TestApp) -> (String, String) {
    let owner = app.token(ALPHA_OWNER);
    let (status, doctor) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/practitioners",
            Some(&owner),
            Some(json!({ "display_name": "Dr Asha" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    let doctor = doctor["id"].as_str().unwrap().to_owned();
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "09:00", "ends": "10:00" }))
        .collect();
    let hours = format!("/api/v1/practitioners/{doctor}/working-hours");
    app.send(
        Method::PUT,
        ALPHA,
        &hours,
        Some(&owner),
        Some(json!({ "shifts": shifts })),
    )
    .await;
    let day = OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date()
        + Duration::days(1);
    let token = app
        .tokens
        .mint_with_email(Uuid::now_v7(), Some("anu@example.test"))
        .unwrap();
    let body = json!({ "starts_at": format!("{day}T09:00:00+05:30"), "practitioner_id": doctor,
                       "full_name": "Anu Joseph", "phone": "91234 56789" });
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
    let id = booked["id"].as_str().unwrap().to_owned();
    (format!("/api/v1/appointments/{id}/check-in"), id)
}

async fn confirm(app: &TestApp, id: &str) {
    let path = format!("/api/v1/appointments/{id}/status");
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&app.token(ALPHA_OWNER)),
            Some(json!({ "status": "confirmed" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_online_sign_up_is_completed_and_arrives_in_one_call() {
    let app = TestApp::start().await;
    let (path, id) = online_booking(&app).await;
    let desk = app.token(ALPHA_FRONT_DESK);
    // An online request the desk hasn't confirmed can't arrive yet.
    let (status, _) = app
        .send(Method::POST, ALPHA, &path, Some(&desk), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    confirm(&app, &id).await;
    let body = json!({
        "sex": "female", "age_years": 34, "no_known_allergies": true,
        "consents": [{ "purpose": "care", "method": "verbal" },
                     { "purpose": "reminders", "method": "verbal" }]
    });
    let (status, done) = app
        .send(Method::POST, ALPHA, &path, Some(&desk), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["appointment"]["status"], "arrived");
    assert_eq!(done["appointment"]["patient"]["sex"], "female");
    assert_eq!(done["appointment"]["patient"]["age_years"], 34);
    assert_eq!(
        done["appointment"]["patient"]["registration_incomplete"],
        false
    );
    assert_eq!(done["consents_recorded"], json!(["care", "reminders"]));
    let token = done["queue_token_id"].as_str().unwrap().to_owned();

    // Again: details recorded, no second token, nothing repeated.
    let (status, again) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "consents": [{ "purpose": "care", "method": "paper" }] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["queue_token_id"], token.as_str());
    assert_eq!(again["consents_recorded"], json!([]));
    let (tokens, reviewed): (i64, String) = sqlx::query_as(
        "select (select count(*) from aarogyam.queue_tokens q where q.appointment_id = a.id),
                p.allergies_reviewed
         from aarogyam.appointments a join aarogyam.patients p on p.id = a.patient_id
         where a.id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((tokens, reviewed.as_str()), (1, "none_known"));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bad_check_ins_roles_and_other_clinics() {
    let app = TestApp::start().await;
    let (path, id) = online_booking(&app).await;
    confirm(&app, &id).await;
    let owner = app.token(ALPHA_OWNER);
    for body in [
        json!({ "date_of_birth": "1990-01-01", "age_years": 34 }),
        json!({ "sex": "robot" }),
        json!({ "no_known_allergies": true, "allergies": ["Penicillin"] }),
        json!({ "consents": [{ "purpose": "marketing", "method": "verbal" }] }),
    ] {
        let (status, error) = app
            .send(Method::POST, ALPHA, &path, Some(&owner), Some(body.clone()))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "gender": "female" })),
        )
        .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // The assistant may record intake but not edit patients; a role with nothing may do neither;
    // another clinic gets 404. None of it marked the patient arrived.
    for (host, who, expected) in [
        (ALPHA, ALPHA_ASSISTANT, StatusCode::FORBIDDEN),
        (ALPHA, ALPHA_NOTHING, StatusCode::FORBIDDEN),
        (BETA, BETA_OWNER, StatusCode::NOT_FOUND),
    ] {
        let (status, _) = app
            .send(
                Method::POST,
                host,
                &path,
                Some(&app.token(who)),
                Some(json!({})),
            )
            .await;
        assert_eq!(status, expected, "{who}");
    }
    let status: String =
        sqlx::query_scalar("select status from aarogyam.appointments where id = $1::uuid")
            .bind(&id)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(status, "confirmed");
    app.finish().await;
}
