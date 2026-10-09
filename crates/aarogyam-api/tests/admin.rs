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
        json!({ "email_provider": "log", "claimed": 2, "sent": 1, "retrying": 0, "failed": 1, "purged": 0,
                // The two seeded clinics' portal addresses, made ready first (tests/addresses.rs).
                "address_provider": "wildcard", "addresses_ready": 2, "addresses_retrying": 0,
                "addresses_failed": 0,
                // No booking requests waiting (tests/notifications.rs).
                "booking_requests_open": 0, "booking_requests_reminded": 0,
                "booking_requests_escalated": 0 })
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

/// The membership id of the member called `name`, as the owner's staff list shows it.
async fn membership(app: &TestApp, owner: &str, name: &str) -> String {
    let (status, staff) = app
        .send(Method::GET, ALPHA, "/api/v1/staff", Some(owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    staff["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|member| member["display_name"] == name)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_and_roles_stay_within_the_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, staff) = app
        .send(Method::GET, ALPHA, "/api/v1/staff", Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let members = staff["members"].as_array().unwrap();
    assert_eq!(members.len(), 4);
    let desk = members
        .iter()
        .find(|member| member["display_name"] == "Farah Desk")
        .unwrap();
    assert_eq!(desk["role_key"], "front_desk");
    assert_eq!(desk["role_name"], "Front desk");
    assert_eq!(desk["status"], "active");
    assert_eq!(desk["branches"], json!([]));

    let (status, roles) = app
        .send(Method::GET, ALPHA, "/api/v1/roles", Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let roles = roles["items"].as_array().unwrap();
    assert_eq!(roles.len(), 7);
    let owner_role = roles.iter().find(|role| role["key"] == "owner").unwrap();
    assert!(
        owner_role["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!({ "key": "staff.manage", "scope": "all" }))
    );

    // Front desk lacks staff.manage.
    let front_desk = app.token(ALPHA_FRONT_DESK);
    for path in ["/api/v1/staff", "/api/v1/roles"] {
        let (status, _) = app
            .send(Method::GET, ALPHA, path, Some(&front_desk), None)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
    // Beta's owner sees only Beta's staff, and can't touch Alpha's.
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/staff", Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, theirs) = app
        .send(Method::GET, BETA, "/api/v1/staff", Some(&beta), None)
        .await;
    assert_eq!(theirs["members"].as_array().unwrap().len(), 1);
    let path = format!("/api/v1/staff/{}", desk["id"].as_str().unwrap());
    let (status, _) = app
        .send(
            Method::PATCH,
            BETA,
            &path,
            Some(&beta),
            Some(json!({ "status": "suspended" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn suspending_or_changing_a_member_takes_effect_at_once() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let path = format!(
        "/api/v1/staff/{}",
        membership(&app, &owner, "Farah Desk").await
    );
    // The desk's grant is now cached.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, member) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "status": "suspended" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{member}");
    assert_eq!(member["status"], "suspended");
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "status": "active", "role_key": "assistant" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, session) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(session["membership"]["role_key"], "assistant");
    // The new role applies at once: an assistant can't register patients.
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&desk),
            Some(json!({ "full_name": "Asha Rao" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    for (body, field) in [
        (json!({ "status": "invited" }), "status"),
        (json!({ "status": "fired" }), "status"),
        (json!({ "role_key": "wizard" }), "role_key"),
    ] {
        let (status, error) = app
            .send(Method::PATCH, ALPHA, &path, Some(&owner), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field)
        );
    }
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&desk),
            Some(json!({ "status": "left" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn owners_keep_the_clinic_and_their_own_roles() {
    let app = TestApp::start().await;
    let asha = app.token(ALPHA_OWNER);
    let own = format!(
        "/api/v1/staff/{}",
        membership(&app, &asha, "Asha Owner").await
    );
    let assistant = format!(
        "/api/v1/staff/{}",
        membership(&app, &asha, "Arun Assistant").await
    );
    let desk = format!(
        "/api/v1/staff/{}",
        membership(&app, &asha, "Farah Desk").await
    );
    for (body, message) in [
        (
            json!({ "role_key": "doctor" }),
            "you can't change your own role",
        ),
        (
            json!({ "status": "left" }),
            "the clinic needs at least one active owner",
        ),
    ] {
        let (status, error) = app
            .send(Method::PATCH, ALPHA, &own, Some(&asha), Some(body))
            .await;
        assert_eq!(status, StatusCode::CONFLICT);
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(message)
        );
    }

    // A manager who isn't an owner can't make or touch owners.
    sqlx::raw_sql(
        "insert into aarogyam.role_permissions (org_id, role_id, permission)
         select org_id, id, 'staff.manage' from aarogyam.roles where key = 'nothing'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let manager = app.token(ALPHA_NOTHING);
    for (path, body) in [
        (&desk, json!({ "role_key": "owner" })),
        (&own, json!({ "status": "suspended" })),
    ] {
        let (status, _) = app
            .send(Method::PATCH, ALPHA, path, Some(&manager), Some(body))
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/staff/invitations",
            Some(&manager),
            Some(json!({ "email": "new.owner@alpha.test", "role_key": "owner" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // With a second owner, the first may go; the second is then the last.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &assistant,
            Some(&asha),
            Some(json!({ "role_key": "owner" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let arun = app.token(ALPHA_ASSISTANT);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &own,
            Some(&arun),
            Some(json!({ "status": "suspended" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&asha), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &assistant,
            Some(&arun),
            Some(json!({ "status": "left" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_invitation_is_emailed_through_the_outbox_and_accepted() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let invite = json!({ "email": " Ravi@Alpha.test ", "role_key": "doctor" });
    let (status, created) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/staff/invitations",
            Some(&owner),
            Some(invite),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["email"], "ravi@alpha.test");
    let token = created["invite_token"].as_str().unwrap().to_owned();
    assert_eq!(token.len(), 43);
    let (_, staff) = app
        .send(Method::GET, ALPHA, "/api/v1/staff", Some(&owner), None)
        .await;
    assert_eq!(staff["invitations"][0]["email"], "ravi@alpha.test");

    // The email was queued with the invitation, carrying the token until it is sent.
    let (recipient, payload, secret): (String, serde_json::Value, Option<String>) =
        sqlx::query_as(
            "select recipient, payload, secret from aarogyam.outbox_events where event_key = 'staff.invited'",
        )
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(recipient, "ravi@alpha.test");
    assert_eq!(payload["portal_host"], ALPHA);
    assert_eq!(payload["role_name"], "Doctor");
    assert_eq!(secret.as_deref(), Some(token.as_str()));
    let (_, report) = app
        .send(
            Method::POST,
            "localhost",
            "/api/v1/internal/outbox/drain",
            None,
            None,
        )
        .await;
    assert_eq!(report["sent"], 1);
    let (secret,): (Option<String>,) = sqlx::query_as("select secret from aarogyam.outbox_events")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(secret, None);

    // Ravi signs in with that address and joins as a doctor.
    let ravi = app
        .tokens
        .mint_with_email(uuid::Uuid::now_v7(), Some("ravi@alpha.test"))
        .unwrap();
    let (status, _) = app
        .send(
            Method::POST,
            "app.localtest.me",
            "/api/v1/invitations/accept",
            Some(&ravi),
            Some(json!({ "token": token, "display_name": "Dr Ravi" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, session) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&ravi), None)
        .await;
    assert_eq!(session["membership"]["role_key"], "doctor");

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bad_or_foreign_invitations_are_refused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    for (body, field) in [
        (json!({ "email": "ravi", "role_key": "doctor" }), "email"),
        (
            json!({ "email": "x@alpha.test", "role_key": "wizard" }),
            "role_key",
        ),
    ] {
        let (status, error) = app
            .send(
                Method::POST,
                ALPHA,
                "/api/v1/staff/invitations",
                Some(&owner),
                Some(body),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(
            error["error"]["message"]
                .as_str()
                .unwrap()
                .starts_with(field)
        );
    }
    let beta = app.token(BETA_OWNER);
    let body = json!({ "email": "spy@beta.test", "role_key": "owner" });
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/staff/invitations",
            Some(&beta),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn add_member_bootstraps_a_clinic_owner_over_the_owner_connection() {
    let app = TestApp::start().await;
    let newcomer = uuid::Uuid::now_v7();
    let add = |slug: &'static str, role: &'static str| {
        aarogyam_dal::console::add_member(
            &app.owner,
            slug,
            role,
            newcomer,
            "newcomer@example.com",
            "Newcomer",
        )
    };

    assert_eq!(add("nowhere", "owner").await.unwrap(), None);
    assert_eq!(add("beta", "no_such_role").await.unwrap(), None);
    let first = add("beta", "doctor").await.unwrap().unwrap();
    // Again with another role: the same membership takes the new role.
    let second = add("beta", "owner").await.unwrap().unwrap();
    assert_eq!(first, second);

    let token = app.token(newcomer);
    let (status, session) = app
        .send(Method::GET, BETA, "/api/v1/session", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert_eq!(session["membership"]["role_key"], "owner");
    // Nothing granted at the other clinic.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
