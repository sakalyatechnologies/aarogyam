//! Editing an appointment on a real database: the chair alone, reason, visit kind and length,
//! with the same chair conflict checks and history as a move, roles and other clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

fn id(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

/// Two chairs, a doctor, a patient and a 10:00-10:30 booking in chair 1; returns the booking's
/// path and both chairs.
async fn booked(app: &TestApp, owner: &str) -> (String, String, String, Value) {
    let chair1 = id(&created(app, owner, "/api/v1/rooms", json!({ "name": "Chair 1" })).await);
    let chair2 = id(&created(app, owner, "/api/v1/rooms", json!({ "name": "Chair 2" })).await);
    let doctor = id(&created(
        app,
        owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha" }),
    )
    .await);
    let patient = id(&created(
        app,
        owner,
        "/api/v1/patients",
        json!({ "full_name": "Meera Iyer", "sex": "female", "age_years": 41 }),
    )
    .await);
    let booking = json!({
        "patient_id": patient, "practitioner_id": doctor, "room_id": chair1,
        "starts_at": "2030-01-07T10:00:00+05:30", "ends_at": "2030-01-07T10:30:00+05:30",
        "reason": "Check-up"
    });
    let saved = created(app, owner, "/api/v1/appointments", booking.clone()).await;
    let path = format!(
        "/api/v1/appointments/{}",
        saved["appointment"]["id"].as_str().unwrap()
    );
    (path, chair1, chair2, booking)
}

async fn patch(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::PATCH, host, path, Some(token), Some(body))
        .await
}

async fn last_change(app: &TestApp, path: &str) -> Value {
    let appointment = Uuid::parse_str(path.rsplit('/').next().unwrap()).unwrap();
    sqlx::query_scalar(
        "select changes from aarogyam.appointment_events
         where appointment_id = $1 and kind = 'changed' order by at desc, id desc limit 1",
    )
    .bind(appointment)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn changing_only_the_chair_saves_it() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (path, chair1, chair2, _) = booked(&app, &owner).await;

    let (status, saved) = patch(&app, ALPHA, &desk, &path, json!({ "room_id": chair2 })).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let appointment = &saved["appointment"];
    assert_eq!(appointment["room_id"], chair2.as_str());
    assert_eq!(appointment["room"], "Chair 2");
    assert_eq!(appointment["starts_at"], "2030-01-07T04:30:00Z");
    assert_eq!(appointment["ends_at"], "2030-01-07T05:00:00Z");

    // The calendar shows the new chair, and the history records only the chair.
    let (_, day) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/appointments?from=2030-01-07&to=2030-01-07",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(day["items"][0]["room_id"], chair2.as_str());
    assert_eq!(
        last_change(&app, &path).await,
        json!({ "room_id": [chair1, chair2] })
    );

    // Taking the chair off, then putting it back, also saves.
    let (status, none) = patch(&app, ALPHA, &desk, &path, json!({ "room_id": "" })).await;
    assert_eq!(status, StatusCode::OK, "{none}");
    assert!(none["appointment"]["room_id"].is_null());
    let (status, back) = patch(&app, ALPHA, &desk, &path, json!({ "room_id": chair1 })).await;
    assert_eq!(status, StatusCode::OK, "{back}");
    assert_eq!(back["appointment"]["room_id"], chair1.as_str());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn reason_kind_and_length_change_with_the_same_checks() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (path, _, chair2, booking) = booked(&app, &owner).await;
    // Another booking in chair 2 from 11:00.
    let mut other = booking.clone();
    other["room_id"] = json!(chair2);
    other["starts_at"] = json!("2030-01-07T11:00:00+05:30");
    other["ends_at"] = json!("2030-01-07T11:30:00+05:30");
    created(&app, &owner, "/api/v1/appointments", other).await;

    let (status, saved) = patch(
        &app,
        ALPHA,
        &desk,
        &path,
        json!({ "reason": "Root canal", "kind": "procedure", "ends_at": "2030-01-07T11:00:00+05:30" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["appointment"]["reason"], "Root canal");
    assert_eq!(saved["appointment"]["kind"], "procedure");
    assert_eq!(saved["appointment"]["starts_at"], "2030-01-07T04:30:00Z");
    assert_eq!(saved["appointment"]["ends_at"], "2030-01-07T05:30:00Z");
    // The history keeps the times and kind, and only that the reason changed.
    assert_eq!(
        last_change(&app, &path).await,
        json!({
            "ends_at": ["2030-01-07T05:00:00Z", "2030-01-07T05:30:00Z"],
            "kind": ["follow_up", "procedure"],
            "reason": "changed"
        })
    );

    // Moving to chair 2 while running into its 11:00 booking is refused, and nothing changes;
    // moving to chair 2 alone fits, since the visit ends as the other starts.
    let clash = json!({ "ends_at": "2030-01-07T11:15:00+05:30", "room_id": chair2 });
    let (status, error) = patch(&app, ALPHA, &desk, &path, clash).await;
    assert_eq!(status, StatusCode::CONFLICT, "{error}");
    let (status, moved) = patch(&app, ALPHA, &desk, &path, json!({ "room_id": chair2 })).await;
    assert_eq!(status, StatusCode::OK, "{moved}");
    assert_eq!(moved["appointment"]["ends_at"], "2030-01-07T05:30:00Z");
    assert_eq!(moved["appointment"]["room_id"], chair2.as_str());
    for body in [
        json!({ "kind": "surgery" }),
        json!({ "ends_at": "2030-01-07T09:00:00+05:30" }),
        json!({ "reason": "x".repeat(201) }),
    ] {
        let (status, error) = patch(&app, ALPHA, &desk, &path, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    // A misspelt field is refused instead of silently ignored.
    let (status, _) = patch(&app, ALPHA, &desk, &path, json!({ "chair_id": chair2 })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // Without appointments.write, or from another clinic, nothing can be edited.
    let (status, _) = patch(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        &path,
        json!({ "kind": "new" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let beta = app.token(BETA_OWNER);
    let (status, _) = patch(&app, BETA, &beta, &path, json!({ "kind": "new" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, day) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/appointments?from=2030-01-07&to=2030-01-07",
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(day["items"][0]["kind"], "procedure");
    app.finish().await;
}
