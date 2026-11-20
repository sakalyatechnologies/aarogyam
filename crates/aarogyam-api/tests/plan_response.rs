//! The patient's answer to their plan from the visit page, on a real database: the answer and
//! its one notification, a changed answer, the shared wrong-PIN lock, expiry and revocation, the
//! open count, row-level security and the cross-clinic 404.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

async fn post(
    app: &TestApp,
    host: &str,
    token: Option<&str>,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, token, Some(body)).await
}

/// A visit with a planned procedure and a link to it: (patient, visit, procedure, token, pin).
async fn visit_with_link(app: &TestApp) -> (String, String, String, String, String) {
    let owner = app.token(ALPHA_OWNER);
    let (status, patient) = post(
        app,
        ALPHA,
        Some(&owner),
        "/api/v1/patients",
        json!({ "full_name": "Meera Shah", "sex": "female", "age_years": 34 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let patient = patient["id"].as_str().unwrap().to_owned();
    let (status, visit) = post(
        app,
        ALPHA,
        Some(&owner),
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Pain lower right" }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    let visit = visit["id"].as_str().unwrap().to_owned();
    let (status, planned) = post(
        app,
        ALPHA,
        Some(&owner),
        &format!("/api/v1/visits/{visit}/procedures"),
        json!({ "name": "Implant", "tooth": 46, "status": "planned", "price_paise": 2_500_000 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{planned}");
    let (status, link) = post(
        app,
        ALPHA,
        Some(&owner),
        &format!("/api/v1/visits/{visit}/share"),
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    (
        patient,
        visit,
        planned["id"].as_str().unwrap().to_owned(),
        link["token"].as_str().unwrap().to_owned(),
        link["pin"].as_str().unwrap().to_owned(),
    )
}

fn answer_path(token: &str) -> String {
    format!("/api/v1/shared/{token}/plan-response")
}

async fn answer(app: &TestApp, token: &str, pin: &str, choice: &str) -> (StatusCode, Value) {
    post(
        app,
        ALPHA,
        None,
        &answer_path(token),
        json!({ "pin": pin, "choice": choice }),
    )
    .await
}

async fn open_count(app: &TestApp, token_visit: &str) -> i32 {
    sqlx::query_scalar::<_, i32>(
        "select open_count from aarogyam.share_links where encounter_id = $1",
    )
    .bind(token_visit.parse::<Uuid>().unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn plan_notifications(app: &TestApp, token: &str) -> Vec<Value> {
    let (status, body) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/notifications",
            Some(token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "plan_response")
        .cloned()
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_patient_answers_their_plan_and_the_clinic_is_told_once_per_visit() {
    let app = TestApp::start().await;
    let (patient, visit, procedure, token, pin) = visit_with_link(&app).await;
    let opens = open_count(&app, &visit).await;

    let (status, body) = answer(&app, &token, &pin, "go_ahead").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["choice"], "go_ahead");
    assert!(body["responded_at"].is_string(), "{body}");
    // Answering is not an open.
    assert_eq!(open_count(&app, &visit).await, opens);

    let (choice, shown): (String, Value) = sqlx::query_as(
        "select choice, shown from aarogyam.visit_plan_responses where encounter_id = $1",
    )
    .bind(visit.parse::<Uuid>().unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(choice, "go_ahead");
    assert_eq!(shown, json!([{ "source": "procedure", "id": procedure }]));

    // The visit's doctor and the desk see one notification, with ids only.
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let seen = plan_notifications(&app, &owner).await;
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert_eq!(seen[0]["href"], format!("/patients/{patient}"));
    assert_eq!(seen[0]["encounter_id"], visit.as_str());
    assert_eq!(seen[0]["audience"], "front_desk");
    assert!(!seen[0].to_string().contains("Meera"));
    let at_desk = plan_notifications(&app, &desk).await;
    assert_eq!(at_desk.len(), 1);
    let id = at_desk[0]["id"].as_str().unwrap().to_owned();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/notifications/{id}/read"),
            Some(&desk),
            None,
        )
        .await;
    assert!(status.is_success(), "{status}");
    assert_eq!(plan_notifications(&app, &desk).await[0]["read"], true);

    // The same answer again changes nothing for the clinic.
    let (status, _) = answer(&app, &token, &pin, "go_ahead").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(plan_notifications(&app, &desk).await[0]["read"], true);

    // A different answer replaces it and reopens the one notification, unread again.
    sqlx::query(
        "update aarogyam.staff_notifications set handled_at = now() where kind = 'plan_response'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, body) = answer(&app, &token, &pin, "question").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["choice"], "question");
    let (rows, choice): (i64, String) = sqlx::query_as(
        "select count(*), max(choice) from aarogyam.visit_plan_responses where encounter_id = $1",
    )
    .bind(visit.parse::<Uuid>().unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((rows, choice.as_str()), (1, "question"));
    let (notes, open): (i64, i64) = sqlx::query_as(
        "select count(*), count(*) filter (where handled_at is null)
         from aarogyam.staff_notifications where kind = 'plan_response'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((notes, open), (1, 1));
    let at_desk = plan_notifications(&app, &desk).await;
    assert_eq!(at_desk.len(), 1);
    assert_eq!(at_desk[0]["read"], false);
    assert_eq!(open_count(&app, &visit).await, opens);

    // Another clinic's member sees nothing; another clinic's host doesn't know the link.
    let beta = app.token(BETA_OWNER);
    let (status, body) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/notifications",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!body.to_string().contains("plan_response"), "{body}");
    let (status, _) = post(
        &app,
        BETA,
        None,
        &answer_path(&token),
        json!({ "pin": pin, "choice": "go_ahead" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Row-level security: the answer is Alpha's alone.
    let db = app.api_db();
    let count = async |clinic| {
        db.scoped(&Scope::tenant(clinic), async |tx| {
            sqlx::query_scalar::<_, i64>("select count(*) from aarogyam.visit_plan_responses")
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap()
    };
    assert_eq!(count(app.clinic_id("alpha").await).await, 1);
    assert_eq!(count(app.clinic_id("beta").await).await, 0);

    // Unknown links and choices.
    let (status, _) = answer(&app, "nope", &pin, "go_ahead").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, body) = answer(&app, &token, &pin, "maybe").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn wrong_pins_count_with_opening_and_expired_or_revoked_links_are_gone() {
    let app = TestApp::start().await;
    let (_, visit, _, token, pin) = visit_with_link(&app).await;
    let wrong = if pin == "000000" { "111111" } else { "000000" };

    let (status, body) = answer(&app, &token, wrong, "go_ahead").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(body["error"]["code"], "wrong_pin");
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("4 tries left"),
        "{body}"
    );
    // Opening shares the same counter.
    let open = format!("/api/v1/shared/{token}/visit");
    let (status, body) = post(&app, ALPHA, None, &open, json!({ "pin": wrong })).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("3 tries left"),
        "{body}"
    );
    for _ in 0..2 {
        let (status, _) = answer(&app, &token, wrong, "question").await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, body) = answer(&app, &token, wrong, "question").await;
    assert_eq!(status, StatusCode::LOCKED, "{body}");
    // Locked for good, even with the right PIN, for answering and opening alike.
    let (status, _) = answer(&app, &token, &pin, "go_ahead").await;
    assert_eq!(status, StatusCode::LOCKED);
    let (status, _) = post(&app, ALPHA, None, &open, json!({ "pin": pin })).await;
    assert_eq!(status, StatusCode::LOCKED);
    assert_eq!(open_count(&app, &visit).await, 0);

    // An expired link is gone; so is a revoked one.
    let (_, visit, _, token, pin) = visit_with_link(&app).await;
    sqlx::query(
        "update aarogyam.share_links set expires_at = now() - interval '1 minute'
         where encounter_id = $1",
    )
    .bind(visit.parse::<Uuid>().unwrap())
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, body) = answer(&app, &token, &pin, "go_ahead").await;
    assert_eq!(status, StatusCode::GONE, "{body}");
    assert_eq!(body["error"]["code"], "expired");
    let (_, visit, _, token, pin) = visit_with_link(&app).await;
    sqlx::query("update aarogyam.share_links set revoked_at = now() where encounter_id = $1")
        .bind(visit.parse::<Uuid>().unwrap())
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, _) = answer(&app, &token, &pin, "go_ahead").await;
    assert_eq!(status, StatusCode::GONE);
    let saved: i64 = sqlx::query_scalar("select count(*) from aarogyam.visit_plan_responses")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(saved, 0);
}
