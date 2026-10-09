//! Additions the staff phone apps asked for: chart corrections across surfaces, seating in a
//! chosen chair, idempotent expenses, staff avatars, richer analytics, record share links and
//! UPI payment links.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn register(app: &TestApp, host: &str, token: &str, name: &str) -> String {
    let (status, patient) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    patient["id"].as_str().unwrap().to_owned()
}

fn entry<'a>(chart: &'a Value, tooth: u64, surface: Option<&str>) -> &'a Value {
    chart["current"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["tooth"] == tooth && e["surface"].as_str() == surface)
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_chart_correction_can_move_an_entry_to_another_surface() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, ALPHA, &owner, "Meera Shah").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar").await;
    let beta_patient = register(&app, BETA, &beta, "Asha Rao").await;
    let path = format!("/api/v1/patients/{patient}/dental-chart");
    let record = async |path: &str, token: &str, host: &str, body: Value| {
        app.send(Method::POST, host, path, Some(token), Some(body))
            .await
    };

    let (status, chart) = record(
        &path,
        &owner,
        ALPHA,
        json!({ "entries": [
        { "tooth": 36, "surface": "O", "finding": "caries" },
        { "tooth": 36, "surface": "D", "finding": "filled" },
    ] }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    let wrong = entry(&chart, 36, Some("O"))["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // The caries was on the mesial surface of 37, not the occlusal of 36.
    let fix = json!({ "entries": [
        { "tooth": 37, "surface": "M", "finding": "caries", "supersedes_id": wrong },
    ] });
    let (status, chart) = record(&path, &owner, ALPHA, fix.clone()).await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    assert_eq!(
        entry(&chart, 37, Some("M"))["supersedes_id"],
        wrong.as_str()
    );
    assert_eq!(chart["current"].as_array().unwrap().len(), 2, "{chart}");
    assert_eq!(entry(&chart, 36, Some("D"))["finding"], "filled");

    // Only a current entry can be corrected: the second try is refused.
    let (status, _) = record(&path, &owner, ALPHA, fix).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The change of status is audited.
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events
         where table_name = 'aarogyam.specialty_records' and row_id = $1::uuid
           and action = 'update'",
    )
    .bind(&wrong)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(audited, 1);

    // Another patient's entry, or another clinic's, can't be named.
    let (_, other_chart) = record(
        &format!("/api/v1/patients/{other}/dental-chart"),
        &owner,
        ALPHA,
        json!({ "entries": [{ "tooth": 11, "finding": "watch" }] }),
    )
    .await;
    let others = entry(&other_chart, 11, None)["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, beta_chart) = record(
        &format!("/api/v1/patients/{beta_patient}/dental-chart"),
        &beta,
        BETA,
        json!({ "entries": [{ "tooth": 21, "finding": "watch" }] }),
    )
    .await;
    let betas = entry(&beta_chart, 21, None)["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for id in [others, betas] {
        let body = json!({ "entries": [{ "tooth": 11, "finding": "watch", "supersedes_id": id }] });
        let (status, error) = record(&path, &owner, ALPHA, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    }

    // Beta can't reach Alpha's patient, and a role without clinical.write can't record.
    let body = json!({ "entries": [{ "tooth": 11, "finding": "watch" }] });
    let (status, _) = record(&path, &beta, BETA, body.clone()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = record(&path, &app.token(ALPHA_NOTHING), ALPHA, body).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

async fn created(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one seating flow from start to finish"
)]
async fn seating_puts_the_patient_and_appointment_in_the_chosen_chair() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let room = async |host: &str, token: &str, name: &str| {
        id_of(&created(&app, host, token, "/api/v1/rooms", json!({ "name": name })).await)
    };
    let (chair1, chair2) = (
        room(ALPHA, &owner, "Chair 1").await,
        room(ALPHA, &owner, "Chair 2").await,
    );
    let beta_chair = room(BETA, &beta, "Chair 1").await;
    let doctor = id_of(
        &created(
            &app,
            ALPHA,
            &owner,
            "/api/v1/practitioners",
            json!({ "display_name": "Dr Asha" }),
        )
        .await,
    );
    let booked = register(&app, ALPHA, &owner, "Anil").await;
    let walker = register(&app, ALPHA, &owner, "Bela").await;
    let now = time::OffsetDateTime::now_utc();
    let at = |minutes: i64| {
        (now + time::Duration::minutes(minutes))
            .format(&time::format_description::well_known::Rfc3339)
            .unwrap()
    };
    let appointment = created(
        &app,
        ALPHA,
        &owner,
        "/api/v1/appointments",
        json!({
            "patient_id": booked, "practitioner_id": doctor, "room_id": chair1,
            "starts_at": at(5), "ends_at": at(35), "reason": "Check-up"
        }),
    )
    .await["appointment"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/appointments/{appointment}/status"),
            Some(&owner),
            Some(json!({ "status": "arrived" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let walk_in = id_of(
        &created(
            &app,
            ALPHA,
            &owner,
            "/api/v1/queue",
            json!({ "patient_id": walker }),
        )
        .await,
    );
    let (_, queue) = app
        .send(Method::GET, ALPHA, "/api/v1/queue", Some(&owner), None)
        .await;
    let token = queue["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["appointment_id"] == appointment.as_str())
        .map(id_of)
        .unwrap();
    let seat = async |token: &str, auth: &str, host: &str, body: Value| {
        app.send(
            Method::POST,
            host,
            &format!("/api/v1/queue/{token}/status"),
            Some(auth),
            Some(body),
        )
        .await
    };

    // Seated in chair 2: the token and its appointment both move there, and the history says so.
    let (status, seated) = seat(
        &token,
        &owner,
        ALPHA,
        json!({ "status": "in_chair", "room_id": chair2 }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{seated}");
    assert_eq!(seated["status"], "in_chair");
    assert_eq!(seated["room_id"], chair2.as_str());
    let (room_now, events): (uuid::Uuid, i64) = sqlx::query_as(
        "select a.room_id, (select count(*) from aarogyam.appointment_events e
                             where e.appointment_id = a.id and e.changes ? 'room_id')
         from aarogyam.appointments a where a.id = $1::uuid",
    )
    .bind(&appointment)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(room_now.to_string(), chair2);
    assert_eq!(events, 1);
    // Asking again with the same chair is a repeat; another chair moves them.
    let (status, again) = seat(
        &token,
        &owner,
        ALPHA,
        json!({ "status": "in_chair", "room_id": chair2 }),
    )
    .await;
    assert_eq!(
        (status, &again["room_id"]),
        (StatusCode::OK, &seated["room_id"])
    );
    let (status, moved) = seat(
        &token,
        &owner,
        ALPHA,
        json!({ "status": "in_chair", "room_id": chair1 }),
    )
    .await;
    assert_eq!(
        (status, moved["room_id"].as_str()),
        (StatusCode::OK, Some(chair1.as_str()))
    );
    // A walk-in has no appointment: only the token takes the chair.
    let (status, seated_walk_in) = seat(
        &walk_in,
        &owner,
        ALPHA,
        json!({ "status": "in_chair", "room_id": chair2 }),
    )
    .await;
    assert_eq!(
        (status, seated_walk_in["room_id"].as_str()),
        (StatusCode::OK, Some(chair2.as_str()))
    );

    // Another clinic's chair, or a chair with another status, is refused.
    for body in [
        json!({ "status": "in_chair", "room_id": beta_chair }),
        json!({ "status": "done", "room_id": chair1 }),
    ] {
        let (status, error) = seat(&token, &owner, ALPHA, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with("room_id"),
            "{error}"
        );
    }
    let body = json!({ "status": "in_chair", "room_id": chair1 });
    let (status, _) = seat(&token, &beta, BETA, body.clone()).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = seat(&token, &app.token(ALPHA_NOTHING), ALPHA, body).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}
