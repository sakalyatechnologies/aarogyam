//! Running a clinic on a real database: settings, staff and roles, sign-in sessions, and the
//! outbox that sends messages after a change.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, DbErrorKind, Scope};
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

/// Event key, status, provider, secret, last error and attempts.
type OutboxRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    i32,
);

const QUEUE_TWO: &str = r"
insert into aarogyam.outbox_events (org_id, event_key, channel, recipient, payload, secret)
select o.id, k.event_key, 'email', 'new.doctor@alpha.test',
       jsonb_build_object('clinic_name', o.name, 'role_name', 'Doctor',
                          'portal_host', 'alpha.localtest.me', 'expires_on', '10 October 2026'),
       'one-time-token'
from aarogyam.organizations o, (values ('staff.invited'), ('staff.poked')) as k(event_key)
where o.slug = 'alpha';
";

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_outbox_drain_delivers_to_the_log_and_abandons_broken_messages() {
    let app = TestApp::start().await;
    sqlx::raw_sql(QUEUE_TWO).execute(&app.owner).await.unwrap();
    let drain = "/api/v1/internal/outbox/drain";
    let (status, report) = app.send(Method::POST, "localhost", drain, None, None).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(
        report,
        json!({ "email_provider": "log", "claimed": 2, "sent": 1, "retrying": 0, "failed": 1, "purged": 0 })
    );
    let rows: Vec<OutboxRow> = sqlx::query_as(
        "select event_key, status, provider, secret, last_error, attempts
             from aarogyam.outbox_events order by event_key",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        rows,
        [
            (
                "staff.invited".into(),
                "sent".into(),
                Some("log".into()),
                None,
                None,
                1
            ),
            (
                "staff.poked".into(),
                "failed".into(),
                None,
                None,
                Some("unknown message kind".into()),
                1
            ),
        ]
    );
    // Nothing is due any more.
    let (_, report) = app.send(Method::POST, "localhost", drain, None, None).await;
    assert_eq!(report["claimed"], 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn claimed_messages_are_leased_retried_and_never_claimed_twice() {
    let app = TestApp::start().await;
    sqlx::raw_sql(QUEUE_TWO).execute(&app.owner).await.unwrap();
    let claim = "select id, attempts from app.outbox_claim(1, 300)";

    // A worker holding a row locks it; another worker skips it and takes the next one.
    let mut first = app.owner.begin().await.unwrap();
    let (held, attempts): (uuid::Uuid, i32) =
        sqlx::query_as(claim).fetch_one(&mut *first).await.unwrap();
    assert_eq!(attempts, 1);
    let (other, _): (uuid::Uuid, i32) = sqlx::query_as(claim).fetch_one(&app.owner).await.unwrap();
    assert_ne!(held, other);
    first.commit().await.unwrap();
    // Both are leased: nothing is due until the lease ends or a retry is scheduled.
    let none: Vec<(uuid::Uuid, i32)> = sqlx::query_as(claim).fetch_all(&app.owner).await.unwrap();
    assert_eq!(none.len(), 0);
    sqlx::query(
        "select app.outbox_failed(org_id, id, 'resend answered 503', now() - interval '1 second')
         from aarogyam.outbox_events where id = $1",
    )
    .bind(held)
    .execute(&app.owner)
    .await
    .unwrap();
    let (again, attempts): (uuid::Uuid, i32) =
        sqlx::query_as(claim).fetch_one(&app.owner).await.unwrap();
    assert_eq!((again, attempts), (held, 2));
    // Giving up clears the secret and settles the row.
    sqlx::query(
        "select app.outbox_failed(org_id, id, 'resend answered 422', null)
         from aarogyam.outbox_events where id = $1",
    )
    .bind(held)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, secret): (String, Option<String>) =
        sqlx::query_as("select status, secret from aarogyam.outbox_events where id = $1")
            .bind(held)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!((status.as_str(), secret), ("failed", None));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn clinics_see_and_queue_only_their_own_messages() {
    let app = TestApp::start().await;
    sqlx::raw_sql(QUEUE_TWO).execute(&app.owner).await.unwrap();
    let db = app.api_db();
    let alpha = app.clinic_id("alpha").await;
    let beta = app.clinic_id("beta").await;
    let count = async |clinic| {
        db.scoped(&Scope::tenant(clinic), async |tx| {
            sqlx::query_scalar::<_, i64>("select count(*) from aarogyam.outbox_events")
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap()
    };
    assert_eq!(count(alpha).await, 2);
    assert_eq!(count(beta).await, 0);
    // Beta can't queue a message as Alpha.
    let forged = db
        .scoped(&Scope::tenant(beta), async |tx| {
            sqlx::query(
                "insert into aarogyam.outbox_events (org_id, event_key, channel) values ($1, 'staff.invited', 'email')",
            )
            .bind(alpha)
            .execute(tx.conn())
            .await
            .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(forged.kind(), DbErrorKind::Forbidden);
    app.finish().await;
}
