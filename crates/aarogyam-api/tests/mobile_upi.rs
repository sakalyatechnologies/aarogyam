//! `GET /invoices/{id}/upi-link`: the clinic's UPI payment link and QR text for a bill's balance.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn bill(app: &TestApp, token: &str, issue: bool) -> String {
    let (_, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": "Meera Shah" })),
        )
        .await;
    let items = json!([{ "description": "Scaling", "unit_price_paise": 123_450 }]);
    let body = json!({ "patient_id": patient["id"], "items": items });
    let (status, draft) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/invoices",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{draft}");
    let id = draft["id"].as_str().unwrap().to_owned();
    if issue {
        let path = format!("/api/v1/invoices/{id}/issue");
        let (status, issued) = app
            .send(Method::POST, ALPHA, &path, Some(token), None)
            .await;
        assert_eq!(status, StatusCode::OK, "{issued}");
    }
    id
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_issued_bill_has_a_upi_link_for_its_balance() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let id = bill(&app, &owner, true).await;
    let path = format!("/api/v1/invoices/{id}/upi-link");
    let get = async |host: &str, token: &str| -> (StatusCode, Value) {
        app.send(Method::GET, host, &path, Some(token), None).await
    };

    // No UPI ID in settings yet: a 409, not a broken link.
    assert_eq!(get(ALPHA, &owner).await.0, StatusCode::CONFLICT);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/clinic",
            Some(&owner),
            Some(json!({ "upi_id": "alpha@okicici" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, link) = get(ALPHA, &owner).await;
    assert_eq!(status, StatusCode::OK, "{link}");
    assert_eq!(link["upi_id"], "alpha@okicici");
    assert_eq!(link["amount_paise"], 123_500);
    let number = link["invoice_number"].as_str().unwrap();
    let uri = link["uri"].as_str().unwrap();
    assert!(uri.starts_with("upi://pay?pa=alpha@okicici&pn="), "{uri}");
    assert!(uri.contains("&am=1235.00&cu=INR"), "{uri}");
    assert!(uri.contains(&number.replace('/', "%2F")), "{uri}");
    assert_eq!(link["qr_data"], link["uri"]);

    // A draft has no number to pay against; 404 across clinics; 403 without billing.read.
    let draft = bill(&app, &owner, false).await;
    let draft_path = format!("/api/v1/invoices/{draft}/upi-link");
    let (status, _) = app
        .send(Method::GET, ALPHA, &draft_path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        get(BETA, &app.token(BETA_OWNER)).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        get(ALPHA, &app.token(ALPHA_NOTHING)).await.0,
        StatusCode::FORBIDDEN
    );
    app.finish().await;
}
