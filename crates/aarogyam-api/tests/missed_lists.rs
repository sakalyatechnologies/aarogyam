//! The Missed list (`GET /appointments/missed`) and the desk's "To collect" list
//! (`GET /queue/to-collect`): what each returns, who may read it, and the clinic wall.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one scenario from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn create(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, path, Some(token), None).await
}

async fn patient(app: &TestApp, token: &str, name: &str) -> String {
    id_of(
        &create(
            app,
            ALPHA,
            token,
            "/api/v1/patients",
            json!({ "full_name": name, "sex": "female", "age_years": 30 }),
        )
        .await,
    )
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_missed_list_shows_a_days_no_shows_to_those_who_read_appointments() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let chair = id_of(
        &create(
            &app,
            ALPHA,
            &owner,
            "/api/v1/rooms",
            json!({ "name": "Chair 1" }),
        )
        .await,
    );
    let doctor = id_of(
        &create(
            &app,
            ALPHA,
            &owner,
            "/api/v1/practitioners",
            json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
        )
        .await,
    );
    let mut booked = Vec::new();
    for (hour, name) in [(10, "Anu"), (11, "Bela"), (12, "Chitra")] {
        let p = patient(&app, &owner, name).await;
        let saved = create(
            &app,
            ALPHA,
            &owner,
            "/api/v1/appointments",
            json!({
                "patient_id": p, "practitioner_id": doctor, "room_id": chair,
                "starts_at": format!("2030-01-07T{hour}:00:00+05:30"),
                "ends_at": format!("2030-01-07T{hour}:30:00+05:30"), "reason": "Check-up"
            }),
        )
        .await;
        booked.push((id_of(&saved["appointment"]), p));
    }
    // One no-show by the job (with a follow-up), one by hand (without), one still booked.
    sqlx::query_scalar::<_, i32>("select app.auto_no_show('2030-01-07T06:00:01Z', 100)")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let (status, by_hand) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/appointments/{}/status", booked[2].0),
            Some(&owner),
            Some(json!({ "status": "no_show" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{by_hand}");

    let (status, list) = get(
        &app,
        ALPHA,
        &owner,
        "/api/v1/appointments/missed?date=2030-01-07",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["date"], "2030-01-07");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 2, "{list}");
    assert_eq!(items[0]["appointment_id"], booked[0].0.as_str());
    assert_eq!(items[0]["patient_id"], booked[0].1.as_str());
    assert_eq!(items[0]["practitioner_id"], doctor.as_str());
    assert!(items[0]["patient_number"].as_str().unwrap().contains('-'));
    assert!(items[0]["recall_id"].is_string());
    assert!(items[0]["starts_at"].is_string());
    assert!(items[1]["recall_id"].is_null());
    assert!(items[0].get("full_name").is_none() && items[0].get("patient").is_none());

    // Another day, and today, are empty; a bad date is a 400.
    let (_, other) = get(
        &app,
        ALPHA,
        &owner,
        "/api/v1/appointments/missed?date=2030-01-08",
    )
    .await;
    assert_eq!(other["items"].as_array().unwrap().len(), 0);
    let (status, today) = get(&app, ALPHA, &owner, "/api/v1/appointments/missed").await;
    assert_eq!(status, StatusCode::OK, "{today}");
    let (status, _) = get(&app, ALPHA, &owner, "/api/v1/appointments/missed?date=nope").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Permission: no appointments.read is 403; the other clinic sees none of Alpha's rows.
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = get(
        &app,
        ALPHA,
        &nothing,
        "/api/v1/appointments/missed?date=2030-01-07",
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let beta = app.token(BETA_OWNER);
    let (status, theirs) = get(
        &app,
        BETA,
        &beta,
        "/api/v1/appointments/missed?date=2030-01-07",
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["items"].as_array().unwrap().len(), 0);
    // A member of Beta cannot use Alpha's host at all.
    let (status, _) = get(
        &app,
        ALPHA,
        &beta,
        "/api/v1/appointments/missed?date=2030-01-07",
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bills_from_earlier_days_are_listed_to_collect() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let p = patient(&app, &owner, "Meera").await;
    let queued = id_of(
        &create(
            &app,
            ALPHA,
            &owner,
            "/api/v1/queue",
            json!({ "patient_id": p }),
        )
        .await,
    );
    let started = create(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/queue/{queued}/start-visit"),
        json!({}),
    )
    .await;
    let visit = id_of(&started["visit"]);
    create(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/close"),
        json!({ "fee_paise": 50_000, "queue_status": "ready_to_bill" }),
    )
    .await;

    // Today's token is the queue's business, not this list's.
    let (status, list) = get(&app, ALPHA, &owner, "/api/v1/queue/to-collect").await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["items"].as_array().unwrap().len(), 0);

    // Yesterday's is listed, for the roles that collect, with ids and numbers only.
    sqlx::query("update aarogyam.queue_tokens set day = day - 1 where id = $1")
        .bind(queued.parse::<uuid::Uuid>().unwrap())
        .execute(&app.owner)
        .await
        .unwrap();
    for who in [ALPHA_OWNER, ALPHA_ASSISTANT, ALPHA_FRONT_DESK] {
        let token = app.token(who);
        let (status, list) = get(&app, ALPHA, &token, "/api/v1/queue/to-collect").await;
        assert_eq!(status, StatusCode::OK, "{list}");
        let items = list["items"].as_array().unwrap();
        assert_eq!(items.len(), 1, "{list}");
        assert_eq!(items[0]["token_id"], queued.as_str());
        assert_eq!(items[0]["balance_paise"], 50_000);
        assert_eq!(items[0]["patient_id"], p.as_str());
        assert!(items[0]["invoice_id"].is_string());
        assert!(items[0].get("full_name").is_none());
    }
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = get(&app, ALPHA, &nothing, "/api/v1/queue/to-collect").await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let beta = app.token(BETA_OWNER);
    let (status, theirs) = get(&app, BETA, &beta, "/api/v1/queue/to-collect").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(theirs["items"].as_array().unwrap().len(), 0);
    let (status, _) = get(&app, ALPHA, &beta, "/api/v1/queue/to-collect").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
