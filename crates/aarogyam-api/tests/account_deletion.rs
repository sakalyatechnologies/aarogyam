//! Staff deleting their own account (`DELETE /me/account`) on a real database: the one
//! transaction (membership, sessions, devices, the user row, the queue), the guards (last owner,
//! platform staff, confirmation), that clinic records stay, that other people are untouched, the
//! job that deletes the Supabase identity, and the grants of the functions behind it.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one story end to end"
)]

mod support;

use std::sync::Mutex;

use aarogyam_app::account::drain_deletions;
use aarogyam_app::accounts::{AccountFuture, AccountsError, AuthUid, DeleteFuture, SignInAccounts};
use aarogyam_domain::patient::Email;
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::OffsetDateTime;
use uuid::{Uuid, uuid};

const DOCTOR: Uuid = uuid!("a0000000-0000-4000-8000-0000000000d1");
const RAVI: Uuid = uuid!("e0000000-0000-4000-8000-000000000001");
const SECOND_OWNER: Uuid = uuid!("a0000000-0000-4000-8000-0000000000e1");

/// Adds a person to a clinic with a role, over the owner connection; returns their user id.
async fn add_member(app: &TestApp, auth_uid: Uuid, name: &str, slug: &str, role: &str) -> Uuid {
    let user: Uuid = sqlx::query_scalar(
        "insert into aarogyam.users (auth_uid, display_name, email, phone_e164)
         values ($1, $2, $3, $4)
         on conflict (auth_uid) do update set display_name = excluded.display_name
         returning id",
    )
    .bind(auth_uid)
    .bind(name)
    .bind(format!("{}@example.test", auth_uid.simple()))
    .bind(format!("+9198{:08}", auth_uid.as_u128() % 100_000_000))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    join(app, user, slug, role).await;
    user
}

async fn join(app: &TestApp, user: Uuid, slug: &str, role: &str) {
    sqlx::query(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, $1, r.id, 'active'
         from aarogyam.organizations o
         join aarogyam.roles r on r.org_id = o.id and r.key = $3
         where o.slug = $2",
    )
    .bind(user)
    .bind(slug)
    .bind(role)
    .execute(&app.owner)
    .await
    .unwrap();
}

async fn delete_account(app: &TestApp, token: &str, body: Option<Value>) -> (StatusCode, Value) {
    app.send(
        Method::DELETE,
        ALPHA,
        "/api/v1/me/account",
        Some(token),
        body,
    )
    .await
}

fn confirmed() -> Value {
    json!({ "confirm": "delete" })
}

/// Records a clinic session for the person (as any clinic request does) and gives it a device
/// with a push token; returns the session's provider id.
async fn sign_in_on_a_phone(app: &TestApp, auth_uid: Uuid, user: Uuid, token: &str) -> Uuid {
    let (status, body) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(token), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let device: Uuid = sqlx::query_scalar(
        "insert into aarogyam.devices (user_id, platform, push_token) values ($1, 'ios', $2)
         returning id",
    )
    .bind(user)
    // A token has one holder (0714), so each phone gets its own.
    .bind(format!("push-token-{user}"))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    sqlx::query_scalar(
        "update aarogyam.sessions s set device_id = $2
         from aarogyam.users u where u.id = s.user_id and u.auth_uid = $1
         returning s.provider_session_id",
    )
    .bind(auth_uid)
    .bind(device)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn count(pool: &PgPool, sql: &'static str, id: Uuid) -> i64 {
    sqlx::query_scalar(sql)
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn membership_statuses(app: &TestApp, auth_uid: Uuid) -> Vec<String> {
    sqlx::query_scalar(
        "select m.status from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
         where u.auth_uid = $1 order by m.org_id",
    )
    .bind(auth_uid)
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_doctor_deletes_their_account_and_the_clinic_keeps_its_records() {
    let app = TestApp::start().await;
    let doctor = add_member(&app, DOCTOR, "Dr Deepa Test", "alpha", "doctor").await;
    let token = app.token(DOCTOR);
    let session = sign_in_on_a_phone(&app, DOCTOR, doctor, &token).await;
    // A second device, as the same person on a tablet.
    let other_session = Uuid::now_v7();
    sqlx::query(
        "insert into aarogyam.sessions (user_id, provider_session_id, audience, expires_at)
         values ($1, $2, 'clinic', now() + interval '1 day')",
    )
    .bind(doctor)
    .bind(other_session)
    .execute(&app.owner)
    .await
    .unwrap();
    // The clinic's practitioner row for the doctor: where notes get the doctor's name.
    let membership: Uuid =
        sqlx::query_scalar("select id from aarogyam.memberships where user_id = $1")
            .bind(doctor)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    sqlx::query(
        "insert into aarogyam.practitioners (org_id, membership_id, display_name)
         select org_id, id, 'Dr Deepa Test' from aarogyam.memberships where id = $1",
    )
    .bind(membership)
    .execute(&app.owner)
    .await
    .unwrap();
    // A record the doctor made, and bystanders: a colleague with a phone, and the other clinic.
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&token),
            Some(json!({ "full_name": "Synthetic Patient", "sex": "female", "age_years": 40 })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    // Visit and consent the doctor recorded, a PIN, an avatar, an invitation to their address, and
    // a future appointment-bearing practitioner row (above).
    let (status, visit) = app
        .send(
            Method::POST,
            ALPHA,
            &format!(
                "/api/v1/patients/{}/visits",
                patient["id"].as_str().unwrap()
            ),
            Some(&token),
            Some(json!({ "chief_complaint": "Pain lower left" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    let (status, consent) = app
        .send(
            Method::POST,
            ALPHA,
            &format!(
                "/api/v1/patients/{}/consents",
                patient["id"].as_str().unwrap()
            ),
            Some(&token),
            Some(json!({ "purpose": "care", "notice_version": "v1 2026-10", "method": "paper" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{consent}");
    sqlx::query(
        "update aarogyam.memberships set pin_hash = 'x', avatar_preset = 'tooth_3' where user_id = $1",
    )
    .bind(doctor)
    .execute(&app.owner)
    .await
    .unwrap();
    sqlx::query(
        "insert into aarogyam.invitations (org_id, email, role_id, token_hash, expires_at)
         select m.org_id, $2, m.role_id, repeat('a', 64), now() + interval '2 days'
         from aarogyam.memberships m where m.user_id = $1",
    )
    .bind(doctor)
    .bind(format!("{}@example.test", DOCTOR.simple()))
    .execute(&app.owner)
    .await
    .unwrap();
    let assistant = app.token(ALPHA_ASSISTANT);
    let assistant_user = sign_in_on_a_phone(
        &app,
        ALPHA_ASSISTANT,
        sqlx::query_scalar("select id from aarogyam.users where auth_uid = $1")
            .bind(ALPHA_ASSISTANT)
            .fetch_one(&app.owner)
            .await
            .unwrap(),
        &assistant,
    )
    .await;
    let beta_owner = app.token(BETA_OWNER);
    let (status, _) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/session",
            Some(&beta_owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    // Asking without the confirmation changes nothing.
    let (status, body) = delete_account(&app, &token, Some(json!({}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(membership_statuses(&app, DOCTOR).await, ["active"]);

    let (status, body) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");

    // Signed out everywhere: on the clinic host and on the neutral routes.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/me", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let reasons: Vec<(Uuid, Option<String>)> = sqlx::query_as(
        "select provider_session_id, revoke_reason from aarogyam.sessions
         where user_id = $1 order by provider_session_id",
    )
    .bind(doctor)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(reasons.len(), 2);
    assert!(
        reasons
            .iter()
            .all(|(_, r)| r.as_deref() == Some("account_deleted"))
    );
    assert!(reasons.iter().any(|(id, _)| *id == session));
    assert!(reasons.iter().any(|(id, _)| *id == other_session));

    // Left the clinic; devices and push tokens gone; the user row anonymised but kept.
    assert_eq!(membership_statuses(&app, DOCTOR).await, ["left"]);
    assert_eq!(
        count(
            &app.owner,
            "select count(*) from aarogyam.devices where user_id = $1",
            doctor
        )
        .await,
        0
    );
    let (name, email, phone, status, auth_uid): (String, Option<String>, Option<String>, String, Uuid) =
        sqlx::query_as(
            "select display_name, email, phone_e164, status, auth_uid from aarogyam.users where id = $1",
        )
        .bind(doctor)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(
        (name.as_str(), email, phone, status.as_str(), auth_uid),
        ("Deleted user", None, None, "disabled", DOCTOR)
    );
    let queue: Vec<(String, i32, Uuid)> = sqlx::query_as(
        "select status, attempts, auth_uid from aarogyam.account_deletions where user_id = $1",
    )
    .bind(doctor)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(queue, [("pending".to_owned(), 0, DOCTOR)]);

    // The change history records the person as the actor of the membership change. Other updates
    // to the membership (the name copy, say) are audited too, so pick the status change itself.
    let (actor, kind, changes): (Option<Uuid>, Option<String>, Option<String>) = sqlx::query_as(
        "select actor_user_id, actor_kind, changes::text from audit.audit_events
         where table_name = 'aarogyam.memberships' and row_id = $1 and action = 'update'
           and changes ? 'status'",
    )
    .bind(membership)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(actor, Some(doctor));
    assert_eq!(kind.as_deref(), Some("staff"));
    assert!(changes.unwrap().contains(r#""status": ["active", "left"]"#));
    // The migration's backfill of the name copy left no plain name in the change history.
    let leaked: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events
         where table_name = 'aarogyam.memberships' and changes::text like '%display_name%'
           and changes::text not like '%\"display_name\": \"changed\"%'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(leaked, 0);
    // The change history of the user row holds no email, name or phone values for the change.
    let user_changes: Vec<String> = sqlx::query_scalar(
        "select changes::text from audit.audit_events
         where table_name = 'aarogyam.users' and row_id = $1 and action = 'update'",
    )
    .bind(doctor)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert!(
        user_changes
            .iter()
            .all(|c| !c.contains("Deleted user") && !c.contains("@example.test"))
    );

    // The clinic keeps its copy of the name and clears the rest of what was theirs.
    let (copy, pin, avatar): (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "select display_name, pin_hash, avatar_preset from aarogyam.memberships where id = $1",
    )
    .bind(membership)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        (copy.as_deref(), pin, avatar),
        (Some("Dr Deepa Test"), None, None)
    );
    let open_invitations: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.invitations where email = $1 and expires_at > now()",
    )
    .bind(format!("{}@example.test", DOCTOR.simple()))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(open_invitations, 0);
    // The doctor is no longer offered for new bookings (their appointments stay for the clinic).
    let still_active: bool =
        sqlx::query_scalar("select active from aarogyam.practitioners where membership_id = $1")
            .bind(membership)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert!(!still_active);
    // Attribution survives: the visit and the consent still name the doctor for the owner.
    let owner_token = app.token(ALPHA_OWNER);
    let pid = patient["id"].as_str().unwrap();
    let (status, visits) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{pid}/visits"),
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{visits}");
    assert_eq!(visits["items"][0]["clinician"]["name"], "Dr Deepa Test");
    let (status, consents) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{pid}/consents"),
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{consents}");
    assert_eq!(consents["items"][0]["recorded_by"], "Dr Deepa Test");
    let (status, staff) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/staff",
            Some(&owner_token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{staff}");
    assert!(!staff.to_string().contains("Deleted user"));

    // The clinic's records stay and read fine; the practitioner row is as it was.
    let owner = app.token(ALPHA_OWNER);
    let path = format!("/api/v1/patients/{}", patient["id"].as_str().unwrap());
    let (status, body) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["full_name"], "Synthetic Patient");
    let practitioner: String = sqlx::query_scalar(
        "select display_name from aarogyam.practitioners where membership_id = $1",
    )
    .bind(membership)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(practitioner, "Dr Deepa Test");

    // Cross-clinic and cross-person: colleagues and the other clinic are untouched.
    assert_eq!(membership_statuses(&app, ALPHA_ASSISTANT).await, ["active"]);
    assert_eq!(membership_statuses(&app, ALPHA_OWNER).await, ["active"]);
    assert_eq!(membership_statuses(&app, BETA_OWNER).await, ["active"]);
    let untouched: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.sessions where revoked_at is not null and user_id <> $1",
    )
    .bind(doctor)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(untouched, 0);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "select count(*) from aarogyam.devices d join aarogyam.sessions s on s.device_id = d.id
             where s.provider_session_id = $1 and d.push_token like 'push-token-%'",
        )
        .bind(assistant_user)
        .fetch_one(&app.owner)
        .await
        .unwrap(),
        1
    );
    for token in [&assistant, &beta_owner] {
        let host = if *token == assistant { ALPHA } else { BETA };
        let (status, _) = app
            .send(Method::GET, host, "/api/v1/session", Some(token), None)
            .await;
        assert_eq!(status, StatusCode::OK);
    }

    // Asking again: the session ended with the first call, so the answer is 401. The database
    // function itself is idempotent: a deleted person is a no-op.
    let (status, _) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let outcome: String =
        sqlx::query_scalar("select outcome from app.delete_own_account($1, null)")
            .bind(DOCTOR)
            .fetch_one(&app.api_db().pool().clone())
            .await
            .unwrap();
    assert_eq!(outcome, "noop");
    assert_eq!(
        count(
            &app.owner,
            "select count(*) from aarogyam.account_deletions where user_id = $1",
            doctor
        )
        .await,
        1
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_only_owner_of_a_clinic_must_hand_it_over_first() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let beta = app.clinic_id("beta").await;
    let owner_user: Uuid = sqlx::query_scalar("select id from aarogyam.users where auth_uid = $1")
        .bind(ALPHA_OWNER)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    // Also an owner of Beta, which has another owner: only Alpha blocks.
    join(&app, owner_user, "beta", "owner").await;
    let token = app.token(ALPHA_OWNER);

    let (status, body) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(
        body,
        json!({
            "error": {
                "code": "last_owner",
                "message": "Make another member an owner of these clinics first."
            },
            "clinics": [{ "id": alpha, "name": "Alpha Dental" }]
        })
    );
    // Nothing changed.
    assert_eq!(membership_statuses(&app, ALPHA_OWNER).await.len(), 2);
    assert!(
        membership_statuses(&app, ALPHA_OWNER)
            .await
            .iter()
            .all(|s| s == "active")
    );
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        count(
            &app.owner,
            "select count(*) from aarogyam.account_deletions where user_id = $1",
            owner_user
        )
        .await,
        0
    );
    let status_now: String = sqlx::query_scalar("select status from aarogyam.users where id = $1")
        .bind(owner_user)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(status_now, "active");

    // A suspended second owner doesn't count: still blocked, with the same answer.
    let second = add_member(&app, SECOND_OWNER, "Second Owner", "alpha", "owner").await;
    sqlx::query("update aarogyam.memberships set status = 'suspended' where user_id = $1")
        .bind(second)
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, body) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["clinics"].as_array().unwrap().len(), 1);

    // An active second owner lets the deletion through; Beta is unaffected.
    sqlx::query("update aarogyam.memberships set status = 'active' where user_id = $1")
        .bind(second)
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, body) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    assert_eq!(
        membership_statuses(&app, ALPHA_OWNER).await,
        ["left", "left"]
    );
    assert_eq!(membership_statuses(&app, SECOND_OWNER).await, ["active"]);
    assert_eq!(membership_statuses(&app, BETA_OWNER).await, ["active"]);
    let beta_owner = app.token(BETA_OWNER);
    let (status, _) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/session",
            Some(&beta_owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        count(
            &app.owner,
            "select count(*) from aarogyam.memberships where org_id = $1 and status = 'active'",
            beta
        )
        .await,
        1
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_request_is_checked_before_anything_changes() {
    let app = TestApp::start().await;
    let token = app.token(ALPHA_FRONT_DESK);
    // A request with no body at all is 415 (the shared JSON extractor); the client always sends one.
    for body in [
        Some(json!({})),
        Some(json!({ "confirm": "yes" })),
        Some(json!({ "confirm": "DELETE" })),
        Some(json!({ "confirm": null })),
    ] {
        let (status, answer) = delete_account(&app, &token, body.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body:?} {answer}");
    }
    let (status, answer) = delete_account(&app, &token, Some(json!({}))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        answer["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("confirm:")
    );
    assert_eq!(
        membership_statuses(&app, ALPHA_FRONT_DESK).await,
        ["active"]
    );

    // Not signed in.
    let (status, _) = delete_account(&app, "not-a-token", Some(confirmed())).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            "/api/v1/me/account",
            None,
            Some(confirmed()),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // A sign-in with no staff account (a patient-only identity) is told so, and nothing is made.
    let patient_only = app
        .tokens
        .mint_with_email(RAVI, Some("ravi@example.test"))
        .unwrap();
    let (status, body) = delete_account(&app, &patient_only, Some(confirmed())).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(body["error"]["code"], "no_staff_account");

    // Sakalya staff are managed in the console.
    let staff = app.token(STAFF);
    let (status, body) = delete_account(&app, &staff, Some(confirmed())).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "platform_staff");
    assert!(body.get("clinics").is_none());
    let active: String =
        sqlx::query_scalar("select status from aarogyam.users where auth_uid = $1")
            .bind(STAFF)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(active, "active");
    let queued: i64 = sqlx::query_scalar("select count(*) from aarogyam.account_deletions")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(queued, 0);
    app.finish().await;
}

/// A stand-in for Supabase Auth that records who it was asked to delete and can fail.
#[derive(Debug, Default)]
struct FakeAccounts {
    deleted: Mutex<Vec<Uuid>>,
    failing: Mutex<bool>,
}

impl SignInAccounts for FakeAccounts {
    fn ensure_user<'a>(&'a self, _email: &'a Email) -> AccountFuture<'a> {
        Box::pin(async { Err(AccountsError::Configuration("not used")) })
    }

    fn delete_user(&self, auth_uid: AuthUid) -> DeleteFuture<'_> {
        let failing = *self.failing.lock().unwrap();
        Box::pin(async move {
            if failing {
                return Err(AccountsError::Upstream("500".to_owned()));
            }
            self.deleted.lock().unwrap().push(auth_uid.uuid());
            Ok(())
        })
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_job_deletes_the_identity_later_and_retries_failures() {
    let app = TestApp::start().await;
    add_member(&app, DOCTOR, "Dr Deepa Test", "alpha", "doctor").await;
    let token = app.token(DOCTOR);
    let (status, _) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let accounts = FakeAccounts::default();
    let db = app.api_db();
    let state = |sql: &'static str| {
        let pool = app.owner.clone();
        async move {
            sqlx::query_as::<_, (String, i32, Option<String>, bool)>(sql)
                .fetch_one(&pool)
                .await
                .unwrap()
        }
    };
    let row = "select status, attempts, last_error, processed_at is not null from aarogyam.account_deletions";

    // Supabase is down: the row stays pending, one attempt counted, retried later.
    *accounts.failing.lock().unwrap() = true;
    let report = drain_deletions(&db, &accounts, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.deleted, report.retrying), (1, 0, 1));
    assert_eq!(
        state(row).await,
        (
            "pending".to_owned(),
            1,
            Some("sign-in accounts: Supabase answered 500".to_owned()),
            false
        )
    );
    // Not due yet (30 seconds of backoff): the next run claims nothing.
    let report = drain_deletions(&db, &accounts, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(report.claimed, 0);
    assert!(accounts.deleted.lock().unwrap().is_empty());

    // Due again and Supabase is back: the identity is deleted and the row done.
    sqlx::query("update aarogyam.account_deletions set next_attempt_at = now()")
        .execute(&app.owner)
        .await
        .unwrap();
    *accounts.failing.lock().unwrap() = false;
    let report = drain_deletions(&db, &accounts, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.deleted), (1, 1));
    assert_eq!(*accounts.deleted.lock().unwrap(), [DOCTOR]);
    assert_eq!(state(row).await, ("done".to_owned(), 2, None, true));
    // Done rows are never claimed again.
    let report = drain_deletions(&db, &accounts, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(report.claimed, 0);
    assert_eq!(accounts.deleted.lock().unwrap().len(), 1);

    // Past the outbox backoff the job doesn't give up: the row stays pending and is tried again in
    // about an hour, with the reason kept.
    sqlx::query(
        "update aarogyam.account_deletions set status = 'pending', attempts = 4, processed_at = null,
           next_attempt_at = now(), last_error = null",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    *accounts.failing.lock().unwrap() = true;
    let report = drain_deletions(&db, &accounts, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.retrying), (1, 1));
    let (status, attempts, error, processed) = state(row).await;
    assert_eq!(
        (status.as_str(), attempts, processed),
        ("pending", 5, false)
    );
    assert!(error.is_some());
    let wait: f64 = sqlx::query_scalar(
        "select extract(epoch from next_attempt_at - now())::float8 from aarogyam.account_deletions",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!((3000.0..=3600.0).contains(&wait), "{wait}");
    // And it still goes through once Supabase is back.
    sqlx::query("update aarogyam.account_deletions set next_attempt_at = now()")
        .execute(&app.owner)
        .await
        .unwrap();
    *accounts.failing.lock().unwrap() = false;
    let report = drain_deletions(&db, &accounts, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.deleted), (1, 1));
    assert_eq!(state(row).await.0, "done");
    assert_eq!(accounts.deleted.lock().unwrap().len(), 2);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_the_api_login_can_run_the_functions() {
    let app = TestApp::start().await;
    let functions = [
        "app.delete_own_account(uuid, uuid)",
        "app.account_deletions_claim(int, int)",
        "app.account_deletion_done(uuid, text)",
        "app.account_deletion_failed(uuid, text, timestamptz)",
    ];
    for function in functions {
        for (role, allowed) in [
            ("aarogyam_api", true),
            ("app_user", false),
            ("anon", false),
            ("authenticated", false),
        ] {
            let can: bool = sqlx::query_scalar("select has_function_privilege($1, $2, 'execute')")
                .bind(role)
                .bind(function)
                .fetch_one(&app.owner)
                .await
                .unwrap();
            assert_eq!(can, allowed, "{role} on {function}");
        }
        // Not granted to PUBLIC: no ACL entry for grantee 0.
        let public: bool = sqlx::query_scalar(
            "select exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                            where p.oid = $1::regprocedure and a.grantee = 0)",
        )
        .bind(function)
        .fetch_one(&app.owner)
        .await
        .unwrap();
        assert!(!public, "{function} is executable by PUBLIC");
    }
    // The queue has no grants for the clinic role or the API login: definer functions only.
    let direct: i64 = sqlx::query_scalar(
        "select count(*) from information_schema.role_table_grants
         where table_name = 'account_deletions' and grantee in ('app_user', 'aarogyam_api', 'PUBLIC')",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(direct, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_session_that_never_made_a_clinic_request_is_signed_out_too() {
    let app = TestApp::start().await;
    let token = app.token(ALPHA_FRONT_DESK);
    // The token has only ever been used to delete: its session has no row yet.
    let (status, body) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, _) = delete_account(&app, &token, Some(confirmed())).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/me", Some(&token), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_patient_app_account_of_a_deleted_member_is_not_touched() {
    let app = TestApp::start().await;
    let patient_app = "app.localtest.me";
    // A doctor who is also a patient: the same sign-in identity has a patient-app account.
    add_member(&app, DOCTOR, "Dr Deepa Test", "alpha", "doctor").await;
    sqlx::query("insert into aarogyam.patient_accounts (auth_uid, email) values ($1, $2)")
        .bind(DOCTOR)
        .bind("deepa@example.test")
        .execute(&app.owner)
        .await
        .unwrap();
    // A second member with no patient account.
    add_member(&app, SECOND_OWNER, "Dr Sam Test", "alpha", "doctor").await;
    let deepa = app
        .tokens
        .mint_with_email(DOCTOR, Some("deepa@example.test"))
        .unwrap();
    let sam = app
        .tokens
        .mint_with_email(SECOND_OWNER, Some("sam@example.test"))
        .unwrap();
    for token in [&deepa, &sam] {
        let (status, body) = delete_account(&app, token, Some(confirmed())).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    }
    // The patient app still serves the doctor-patient on its own session.
    let deepa_patient = app
        .tokens
        .mint_with_email(DOCTOR, Some("deepa@example.test"))
        .unwrap();
    let (status, body) = app
        .send(
            Method::GET,
            patient_app,
            "/api/v1/me/patient",
            Some(&deepa_patient),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    // A request from the other deleted member can't make them a patient-app account.
    let (status, _) = app
        .send(
            Method::GET,
            patient_app,
            "/api/v1/me/patient",
            Some(&sam),
            None,
        )
        .await;
    assert_ne!(status, StatusCode::OK);
    let made: i64 =
        sqlx::query_scalar("select count(*) from aarogyam.patient_accounts where auth_uid = $1")
            .bind(SECOND_OWNER)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(made, 0);

    // The job keeps the identity the patient app uses, and deletes the other.
    let accounts = FakeAccounts::default();
    let report = drain_deletions(&app.api_db(), &accounts, OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.deleted, report.kept), (2, 1, 1));
    assert_eq!(*accounts.deleted.lock().unwrap(), [SECOND_OWNER]);
    let note: Option<String> = sqlx::query_scalar(
        "select note from aarogyam.account_deletions where auth_uid = $1 and status = 'done'",
    )
    .bind(DOCTOR)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(note.as_deref(), Some("kept_for_patient_app"));
}
