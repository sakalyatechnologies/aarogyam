//! Running a clinic on a real database: settings, staff and roles, sign-in sessions, and the
//! outbox that sends messages after a change.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::json;
use support::people::*;
use support::{ALPHA, BETA, TestApp};

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn clinic_settings_are_validated_and_kept_per_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let path = "/api/v1/settings/clinic";

    let (status, settings) = app.send(Method::GET, ALPHA, path, Some(&owner), None).await;
    assert_eq!(status, StatusCode::OK, "{settings}");
    assert_eq!(settings["name"], "Alpha Dental");
    assert_eq!(settings["timezone"], "Asia/Kolkata");
    assert_eq!(settings["gstin"], serde_json::Value::Null);

    let edits = json!({
        "name": "Alpha Dental Care",
        "legal_name": "Alpha Dental Care LLP",
        "gstin": "27aapfu0939f1zv",
        "branding": { "brand": "#0f766e", "mode": "dark" },
        "prescription_footer": "Dr Asha, BDS\nReg. A-1234",
        "address": { "line1": "12 MG Road", "city": "Pune", "state": "Maharashtra", "pincode": "411001" },
        "phone": "020 2612 3456",
        "upi_id": "AlphaDental@okicici"
    });
    let (status, saved) = app
        .send(Method::PATCH, ALPHA, path, Some(&owner), Some(edits))
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["gstin"], "27AAPFU0939F1ZV");
    assert_eq!(
        saved["branding"],
        json!({ "brand": "#0F766E", "mode": "dark" })
    );
    assert_eq!(saved["address"]["pincode"], "411001");
    assert_eq!(saved["address"]["line2"], serde_json::Value::Null);
    assert_eq!(saved["phone"], "+912026123456");
    assert_eq!(saved["upi_id"], "alphadental@okicici");
    let (_, reread) = app.send(Method::GET, ALPHA, path, Some(&owner), None).await;
    assert_eq!(reread, saved);
    // The portal's session picks up the new name and branding.
    let (_, session) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&owner), None)
        .await;
    assert_eq!(session["clinic"]["name"], "Alpha Dental Care");
    assert_eq!(session["clinic"]["branding"]["brand"], "#0F766E");
    // The change history records the organisation's changed columns.
    let (changed,): (serde_json::Value,) = sqlx::query_as(
        "select changes from audit.audit_events
         where table_name = 'aarogyam.organizations' and action = 'update' order by at desc limit 1",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(changed.get("gstin").is_some(), "{changed}");

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bad_clinic_settings_are_refused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let path = "/api/v1/settings/clinic";
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            path,
            Some(&owner),
            Some(json!({ "legal_name": "Alpha Dental Care LLP", "gstin": "27AAPFU0939F1ZV" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    // Clearing and invalid values.
    let (status, cleared) = app
        .send(
            Method::PATCH,
            ALPHA,
            path,
            Some(&owner),
            Some(json!({ "gstin": "", "upi_id": "" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(cleared["gstin"], serde_json::Value::Null);
    assert_eq!(cleared["upi_id"], serde_json::Value::Null);
    assert_eq!(cleared["legal_name"], "Alpha Dental Care LLP");
    for (body, field) in [
        (json!({ "gstin": "27AAPFU0939F1ZW" }), "gstin"),
        (json!({ "timezone": "Europe/London" }), "timezone"),
        (json!({ "branding": { "brand": "teal" } }), "branding.brand"),
        (json!({ "branding": { "mode": "dim" } }), "branding.mode"),
        (
            json!({ "address": { "pincode": "01100" } }),
            "address.pincode",
        ),
        (json!({ "upi_id": "alpha" }), "upi_id"),
        (json!({ "name": " " }), "name"),
    ] {
        let (status, error) = app
            .send(Method::PATCH, ALPHA, path, Some(&owner), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field),
            "{error}"
        );
    }

    // Front desk lacks settings.manage; Beta's owner can't reach Alpha's settings, and Beta's
    // own changes stay in Beta.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app.send(Method::GET, ALPHA, path, Some(&desk), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            path,
            Some(&beta),
            Some(json!({ "name": "Taken" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::PATCH,
            BETA,
            path,
            Some(&beta),
            Some(json!({ "name": "Beta Smiles" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, alpha_settings) = app.send(Method::GET, ALPHA, path, Some(&owner), None).await;
    assert_eq!(alpha_settings["name"], "Alpha Dental");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn people_see_and_revoke_only_their_own_sessions() {
    let app = TestApp::start().await;
    let laptop = app.token(ALPHA_OWNER);
    let phone = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    // Each token's first clinic request records its session; the phone's grant is now cached.
    for token in [&laptop, &phone] {
        let (status, _) = app
            .send(Method::GET, ALPHA, "/api/v1/session", Some(token), None)
            .await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _) = app
        .send(Method::GET, BETA, "/api/v1/session", Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, mine) = app
        .send(
            Method::GET,
            "app.localtest.me",
            "/api/v1/me/sessions",
            Some(&laptop),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{mine}");
    let items = mine["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(
        items.iter().filter(|item| item["current"] == true).count(),
        1
    );
    let phone_session = items.iter().find(|item| item["current"] == false).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let revoke = format!("/api/v1/me/sessions/{phone_session}/revoke");

    // Someone else can't revoke it, nor see it.
    let (status, _) = app
        .send(Method::POST, "app.localtest.me", &revoke, Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, theirs) = app
        .send(
            Method::GET,
            "app.localtest.me",
            "/api/v1/me/sessions",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(theirs["items"].as_array().unwrap().len(), 1);

    // The owner revokes the phone from the laptop: the phone's next request is refused at
    // once, despite its cached grant, on clinic and neutral hosts alike.
    let (status, _) = app
        .send(Method::POST, ALPHA, &revoke, Some(&laptop), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(
            Method::GET,
            "app.localtest.me",
            "/api/v1/me",
            Some(&phone),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&laptop), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, mine) = app
        .send(
            Method::GET,
            "app.localtest.me",
            "/api/v1/me/sessions",
            Some(&laptop),
            None,
        )
        .await;
    assert_eq!(mine["items"].as_array().unwrap().len(), 1);
    // The change history names the person who revoked it.
    let (actor,): (Option<uuid::Uuid>,) = sqlx::query_as(
        "select actor_user_id from audit.audit_events
         where table_name = 'aarogyam.sessions' and action = 'update' and row_id = $1::uuid",
    )
    .bind(&phone_session)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        actor,
        Some(uuid::uuid!("01900000-0000-7000-8000-0000000000a1"))
    );
    app.finish().await;
}
