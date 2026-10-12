//! A payment can carry a proof (a file of kind `payment_proof` of the same patient), and the
//! collections report compares with the period before. Another clinic's files and bills are 404.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt as _;

const BOUNDARY: &str = "aarogyam-proof-boundary";

async fn upload(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    kind: &str,
) -> (StatusCode, Value) {
    let mut jpeg = vec![0xFF_u8, 0xD8, 0xFF, 0xE0];
    jpeg.extend_from_slice(&[3_u8; 512]);
    let mut body = Vec::new();
    body.extend_from_slice(
        format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"kind\"\r\n\r\n{kind}\r\n")
            .as_bytes(),
    );
    body.extend_from_slice(
        format!("--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.jpg\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(&jpeg);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::post(format!("/api/v1/patients/{patient}/attachments"))
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn patient(app: &TestApp, host: &str, token: &str) -> String {
    let (status, body) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": "Meera Shah" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn pay(app: &TestApp, token: &str, key: &str, body: Value) -> (StatusCode, Value) {
    app.send_with(
        Method::POST,
        ALPHA,
        "/api/v1/payments",
        Some(token),
        Some(body),
        &[("idempotency-key", key)],
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_payment_keeps_its_proof_and_the_report_compares_with_the_last_period() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let nothing = app.token(ALPHA_NOTHING);
    let meera = patient(&app, ALPHA, &owner).await;
    let other = patient(&app, ALPHA, &owner).await;
    let (status, proof) = upload(&app, ALPHA, &owner, &meera, "payment_proof").await;
    assert_eq!(status, StatusCode::CREATED, "{proof}");
    let proof = proof["id"].as_str().unwrap().to_owned();
    let (_, photo) = upload(&app, ALPHA, &owner, &meera, "photo").await;
    let photo = photo["id"].as_str().unwrap().to_owned();
    let (_, elsewhere) = upload(&app, ALPHA, &owner, &other, "payment_proof").await;
    let elsewhere = elsewhere["id"].as_str().unwrap().to_owned();

    // The proof must be a payment_proof of the same patient.
    let body = |attachment: &str| {
        json!({ "patient_id": meera, "method": "upi", "amount_paise": 50_000,
                "reference": "UPI9", "attachment_id": attachment })
    };
    assert_eq!(
        pay(&app, &owner, "key-proof-001", body(&photo)).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        pay(&app, &owner, "key-proof-002", body(&elsewhere)).await.0,
        StatusCode::BAD_REQUEST
    );
    let (status, paid) = pay(&app, &owner, "key-proof-003", body(&proof)).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    assert_eq!(paid["attachment_id"], proof.as_str());
    // A retry with the same key and proof returns the same payment.
    let (status, again) = pay(&app, &owner, "key-proof-003", body(&proof)).await;
    assert!(status.is_success(), "{again}");
    assert_eq!(again["id"], paid["id"]);

    // Another clinic cannot attach this clinic's file: 404.
    let beta = app.token(BETA_OWNER);
    let beta_patient = patient(&app, BETA, &beta).await;
    let (status, _) = app
        .send_with(
            Method::POST,
            BETA,
            "/api/v1/payments",
            Some(&beta),
            Some(
                json!({ "patient_id": beta_patient, "method": "upi", "amount_paise": 100,
                         "attachment_id": proof }),
            ),
            &[("idempotency-key", "key-proof-004")],
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Collections: methods on every day, the discount, and the previous period.
    let (status, report) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/reports/collections?compare=prev",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["collected_paise"], 50_000);
    assert_eq!(report["discount_paise"], 0);
    let today = &report["by_day"][6];
    assert_eq!(today["by_method"].as_array().unwrap().len(), 4);
    assert_eq!(
        today["by_method"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["method"] == "upi")
            .unwrap()["amount_paise"],
        50_000
    );
    assert_eq!(report["previous"]["collected_paise"], 0);
    assert_eq!(report["previous"]["payments"], 0);
    let (_, plain) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/reports/collections",
            Some(&owner),
            None,
        )
        .await;
    assert!(plain["previous"].is_null());
    for (path, token, want) in [
        (
            "/api/v1/reports/collections?compare=last",
            &owner,
            StatusCode::BAD_REQUEST,
        ),
        (
            "/api/v1/reports/collections?compare=prev",
            &nothing,
            StatusCode::FORBIDDEN,
        ),
    ] {
        let (status, _) = app.send(Method::GET, ALPHA, path, Some(token), None).await;
        assert_eq!(status, want, "{path}");
    }
    app.finish().await;
}
