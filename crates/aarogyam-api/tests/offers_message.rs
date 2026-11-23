//! Offers P6 on a real database: the patient message states the offer (and the referral only with
//! promotional consent) when the doctor ticked it, the visit page carries the codes and the share
//! text, nothing crosses clinics, and the share text has no patient name.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), body).await
}

async fn consent(app: &TestApp, token: &str, patient: &str, purpose: &str) {
    let (status, body) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/consents"),
        Some(json!({ "purpose": purpose, "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
}

async fn closed_visit(app: &TestApp, token: &str, name: &str, phone: &str) -> (String, String) {
    let (status, made) = post(
        app,
        ALPHA,
        token,
        "/api/v1/patients",
        Some(json!({ "full_name": name, "sex": "female", "age_years": 34, "phone": phone })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    let patient = made["id"].as_str().unwrap().to_owned();
    consent(app, token, &patient, "care").await;
    let (status, visit) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/visits"),
        Some(json!({ "chief_complaint": "Check-up" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    let visit = visit["id"].as_str().unwrap().to_owned();
    let (status, body) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    (patient, visit)
}

async fn message(app: &TestApp, token: &str, visit: &str, sections: Option<Value>) -> Value {
    let (status, body) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/visits/{visit}/patient-message"),
        sections,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_message_and_page_carry_the_offer_and_the_referral_follows_consent() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let (patient, visit) = closed_visit(&app, &owner, "Priya Sharma", "9876500001").await;

    // Nothing given yet: no offer lines.
    let plain = message(&app, &owner, &visit, None).await;
    assert!(!plain["text"].as_str().unwrap().contains("Your offer"));

    let (status, made) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/offers"),
        Some(json!({ "patient_offer": {}, "referral": true })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    let offer = made["patient_offer"]["code"].as_str().unwrap().to_owned();
    let referral = made["referral"]["code"].as_str().unwrap().to_owned();

    // The offer is a fee fact: it is in the message. The referral is not: no promotional consent.
    let body = message(&app, &owner, &visit, None).await;
    let text = body["text"].as_str().unwrap();
    assert!(text.contains("Your offer"), "{text}");
    assert!(text.contains(&offer), "{text}");
    assert!(text.contains("10% off (up to ₹5,000)"), "{text}");
    assert!(text.contains("the next treatment"), "{text}");
    assert!(!text.contains("Friends and family"), "{text}");
    assert!(!text.contains(&referral), "{text}");

    // Unticked, the offer is left out.
    let unticked = message(
        &app,
        &owner,
        &visit,
        Some(json!({ "sections": ["done", "detail", "found", "plan", "medicines", "care"] })),
    )
    .await;
    assert!(!unticked["text"].as_str().unwrap().contains(&offer));

    // With promotional consent the referral line appears, and never carries the code.
    consent(&app, &owner, &patient, "promotional").await;
    let body = message(&app, &owner, &visit, None).await;
    let text = body["text"].as_str().unwrap();
    assert!(text.contains("Friends and family get"), "{text}");
    assert!(!text.contains(&referral), "{text}");
    assert!(text.contains(&offer), "{text}");

    // The page carries both codes and the share text, on a no-store response.
    sqlx::query(
        "update aarogyam.org_domains set verified_at = coalesce(verified_at, now())
         where kind = 'portal' and is_primary",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let url = body["url"].as_str().unwrap();
    let token = url.rsplit("/shared/").next().unwrap();
    let (status, headers, page) = app
        .send_full(
            Method::POST,
            ALPHA,
            &format!("/api/v1/shared/{token}/visit"),
            None,
            Some(json!({ "pin": body["pin"] })),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(page["offer"][0]["code"], offer.as_str());
    assert_eq!(page["offer"][0]["purpose"], "patient_offer");
    assert_eq!(page["offer"][0]["words"], "10% off (up to ₹5,000)");
    assert_eq!(page["referral"]["code"], referral.as_str());
    let share = page["referral"]["share_text"].as_str().unwrap();
    assert!(
        share.contains(&referral) && share.contains("Alpha Dental"),
        "{share}"
    );
    assert!(share.contains("/book"), "{share}");
    for word in ["Priya", "Sharma", "Check-up"] {
        assert!(!share.contains(word), "share text has {word}: {share}");
    }
    assert!(!share.contains("wa.me"), "{share}");

    // Another clinic sees neither the visit's offers nor the message.
    let (status, _) = post(
        &app,
        BETA,
        &beta,
        &format!("/api/v1/visits/{visit}/patient-message"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}
