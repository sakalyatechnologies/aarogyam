//! Consent drives messaging on a real database: `app.may_contact` and its Rust wrappers follow
//! the patient's consents (no row: care yes, reminders and promotional no; withdrawal stops,
//! consenting again restores) and never answer about another clinic's patient.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_app::contact::may_send;
use aarogyam_dal::contact::may_contact;
use aarogyam_domain::contact::PatientMessage;
use aarogyam_domain::ids::{ClinicId, PatientId};
use axum::http::{Method, StatusCode};
use sakalya_db::Scope;
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};
use uuid::Uuid;

/// What the API's own connection (as the notification worker would) answers per purpose.
async fn answers(app: &TestApp, org: Uuid, patient: Uuid) -> [bool; 3] {
    let db = app.api_db();
    let mut conn = db.pool().acquire().await.unwrap();
    let mut out = [false; 3];
    for (slot, purpose) in out.iter_mut().zip(["care", "reminders", "promotional"]) {
        *slot = may_contact(&mut conn, org, patient, purpose).await.unwrap();
    }
    out
}

async fn post(app: &TestApp, path: &str, body: Value) -> Value {
    let token = app.token(ALPHA_OWNER);
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(&token), Some(body))
        .await;
    assert!(
        status == StatusCode::CREATED || status == StatusCode::OK,
        "{value}"
    );
    value
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn consents_decide_who_may_be_messaged() {
    let app = TestApp::start().await;
    let (alpha, beta) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let made = post(&app, "/api/v1/patients", json!({ "full_name": "Leela M" })).await;
    let patient = Uuid::parse_str(made["id"].as_str().unwrap()).unwrap();
    let consents = format!("/api/v1/patients/{patient}/consents");

    // No consent rows: care messages yes, reminders and promotions no.
    assert_eq!(answers(&app, alpha, patient).await, [true, false, false]);

    let reminders = post(
        &app,
        &consents,
        json!({ "purpose": "reminders", "method": "verbal" }),
    )
    .await;
    post(
        &app,
        &consents,
        json!({ "purpose": "promotional", "method": "paper" }),
    )
    .await;
    assert_eq!(answers(&app, alpha, patient).await, [true, true, true]);

    // Withdrawing reminders stops reminders only; consenting again restores them.
    let withdraw = format!(
        "/api/v1/consents/{}/withdraw",
        reminders["id"].as_str().unwrap()
    );
    post(&app, &withdraw, json!({ "method": "verbal" })).await;
    assert_eq!(answers(&app, alpha, patient).await, [true, false, true]);
    post(
        &app,
        &consents,
        json!({ "purpose": "reminders", "method": "app" }),
    )
    .await;
    assert_eq!(answers(&app, alpha, patient).await, [true, true, true]);

    // Withdrawing care stops care messages until care is given again.
    let care = post(
        &app,
        &consents,
        json!({ "purpose": "care", "method": "paper" }),
    )
    .await;
    let withdraw = format!("/api/v1/consents/{}/withdraw", care["id"].as_str().unwrap());
    post(&app, &withdraw, json!({ "method": "paper" })).await;
    assert!(!answers(&app, alpha, patient).await[0]);

    // Another clinic, an unknown patient: never. Inside Beta's transaction, not even for Alpha.
    assert_eq!(answers(&app, beta, patient).await, [false; 3]);
    assert_eq!(answers(&app, alpha, Uuid::now_v7()).await, [false; 3]);
    let (as_alpha, as_beta) = {
        let db = app.api_db();
        let ask = |org: Uuid| {
            let db = db.clone();
            async move {
                db.scoped(&Scope::tenant(org), async |tx| {
                    may_send(
                        tx,
                        ClinicId::from_uuid(alpha),
                        PatientId::from_uuid(patient),
                        PatientMessage::Campaign,
                    )
                    .await
                })
                .await
            }
        };
        (ask(alpha).await, ask(beta).await)
    };
    assert!(matches!(as_alpha, Ok(true)));
    assert!(matches!(as_beta, Ok(false)), "{as_beta:?}");
    app.finish().await;
}
