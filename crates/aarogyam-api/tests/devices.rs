//! A person's own devices for push notifications on a real database (migration 0714): register
//! and refresh, a token that moves when a phone changes hands, the reserved patient app, bad
//! input, removal that is safe to repeat and never reaches another person's install, a revoked
//! session's devices dropping out of the push list, and the table's constraints and grants.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};
use uuid::Uuid;

const APP: &str = "app.localtest.me";

/// A well-formed APNs token (hex) for `seed`.
fn ios(seed: &str) -> String {
    let digits = b"0123456789abcdef";
    let hex: String = seed
        .bytes()
        .flat_map(|b| [digits[usize::from(b >> 4)], digits[usize::from(b & 15)]])
        .map(char::from)
        .collect();
    format!("{hex:0<64}")
}

/// A well-formed FCM token for `seed`.
fn fcm(seed: &str) -> String {
    format!("{seed:x<64}")
}

fn path(installation: Uuid) -> String {
    format!("/api/v1/me/devices/{installation}")
}

fn registration(token: &str) -> Value {
    json!({ "platform": "ios", "token": token, "app": "staff", "locale": "en-IN",
            "app_version": "0.1.0" })
}

async fn put(app: &TestApp, bearer: &str, installation: Uuid, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::PUT,
        APP,
        &path(installation),
        Some(bearer),
        Some(body),
    )
    .await
}

async fn delete(app: &TestApp, bearer: &str, installation: Uuid) -> StatusCode {
    app.send(Method::DELETE, APP, &path(installation), Some(bearer), None)
        .await
        .0
}

/// The token held by the install, `None` when it has none or is unknown.
async fn token_of(app: &TestApp, auth_uid: Uuid, installation: Uuid) -> Option<String> {
    sqlx::query_scalar(
        "select d.push_token from aarogyam.devices d join aarogyam.users u on u.id = d.user_id
         where u.auth_uid = $1 and d.installation_id = $2",
    )
    .bind(auth_uid)
    .bind(installation)
    .fetch_optional(&app.owner)
    .await
    .unwrap()
    .flatten()
}

async fn rows(app: &TestApp, auth_uid: Uuid) -> i64 {
    sqlx::query_scalar(
        "select count(*) from aarogyam.devices d join aarogyam.users u on u.id = d.user_id
         where u.auth_uid = $1",
    )
    .bind(auth_uid)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn registering_creates_then_updates_the_install() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let install = Uuid::now_v7();

    let (status, body) = put(&app, &owner, install, registration(&ios("token-one"))).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    assert_eq!(
        token_of(&app, ALPHA_OWNER, install).await.as_deref(),
        Some(ios("token-one").as_str())
    );
    let (platform, app_name, locale, version, session): (
        String,
        String,
        String,
        Option<String>,
        Option<Uuid>,
    ) = sqlx::query_as(
        "select platform, app, locale, app_version, session_id from aarogyam.devices
         where installation_id = $1",
    )
    .bind(install)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        (platform.as_str(), app_name.as_str(), locale.as_str()),
        ("ios", "staff", "en-IN")
    );
    assert_eq!(version.as_deref(), Some("0.1.0"));
    assert!(session.is_some(), "the registering session is recorded");

    // The token rotates: the same install is updated, never duplicated.
    let (status, _) = put(
        &app,
        &owner,
        install,
        json!({ "platform": "android", "token": fcm("token-two"), "app": "staff", "locale": "hi-IN" }),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        token_of(&app, ALPHA_OWNER, install).await.as_deref(),
        Some(fcm("token-two").as_str())
    );
    assert_eq!(rows(&app, ALPHA_OWNER).await, 1);
    let locale: String =
        sqlx::query_scalar("select locale from aarogyam.devices where installation_id = $1")
            .bind(install)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(locale, "hi-IN");
    // A person with no clinic role at all can register their own device too.
    let stranger = app.token(STRANGER);
    let (status, _) = put(
        &app,
        &stranger,
        Uuid::now_v7(),
        registration(&ios("stranger-token")),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    // It works on a clinic's host as well as the neutral one.
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            &path(Uuid::now_v7()),
            Some(&owner),
            Some(registration(&ios("clinic-host-token"))),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_token_moves_when_a_phone_changes_hands() {
    let app = TestApp::start().await;
    let (asha, farah) = (app.token(ALPHA_OWNER), app.token(ALPHA_FRONT_DESK));
    let (first, second, third) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());

    put(&app, &asha, first, registration(&ios("shared-phone"))).await;
    // The next person signs in on the same phone: the token moves to them.
    let (status, _) = put(&app, &farah, second, registration(&ios("shared-phone"))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(token_of(&app, ALPHA_OWNER, first).await, None);
    assert_eq!(
        token_of(&app, ALPHA_FRONT_DESK, second).await.as_deref(),
        Some(ios("shared-phone").as_str())
    );
    // The same person under a new install id moves it within their own devices.
    put(&app, &farah, third, registration(&ios("shared-phone"))).await;
    assert_eq!(token_of(&app, ALPHA_FRONT_DESK, second).await, None);
    assert_eq!(
        token_of(&app, ALPHA_FRONT_DESK, third).await.as_deref(),
        Some(ios("shared-phone").as_str())
    );
    let holders: i64 =
        sqlx::query_scalar("select count(*) from aarogyam.devices where push_token = $1")
            .bind(ios("shared-phone"))
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(holders, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_patient_app_is_reserved_and_bad_input_is_refused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let install = Uuid::now_v7();

    let (status, body) = put(
        &app,
        &owner,
        install,
        json!({ "platform": "ios", "token": "abc", "app": "patient", "locale": "en-IN" }),
    )
    .await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    assert_eq!(body["error"]["code"], "unsupported_app");
    assert_eq!(rows(&app, ALPHA_OWNER).await, 0);

    for (what, bad) in [
        (
            "platform",
            json!({ "platform": "windows", "token": "abc", "app": "staff", "locale": "en-IN" }),
        ),
        (
            "app",
            json!({ "platform": "ios", "token": "abc", "app": "admin", "locale": "en-IN" }),
        ),
        (
            "locale",
            json!({ "platform": "ios", "token": "abc", "app": "staff", "locale": "english" }),
        ),
        (
            "locale case",
            json!({ "platform": "ios", "token": "abc", "app": "staff", "locale": "en-in" }),
        ),
        (
            "empty token",
            json!({ "platform": "ios", "token": "", "app": "staff", "locale": "en-IN" }),
        ),
        (
            "long token",
            json!({ "platform": "ios", "token": "a".repeat(201), "app": "staff",
                    "locale": "en-IN" }),
        ),
        (
            "short token",
            json!({ "platform": "ios", "token": "ab12", "app": "staff", "locale": "en-IN" }),
        ),
        (
            "path in an apns token",
            json!({ "platform": "ios", "token": format!("x/../{}", ios("a")), "app": "staff",
                    "locale": "en-IN" }),
        ),
        (
            "non-hex apns token",
            json!({ "platform": "ios", "token": format!("{}z", &ios("a")[..63]),
                    "app": "staff", "locale": "en-IN" }),
        ),
        (
            "query in an fcm token",
            json!({ "platform": "android", "token": format!("{}?x=1", fcm("a")), "app": "staff",
                    "locale": "en-IN" }),
        ),
        (
            "fragment in an fcm token",
            json!({ "platform": "android", "token": format!("{}#x", fcm("a")), "app": "staff",
                    "locale": "en-IN" }),
        ),
        (
            "slash in an fcm token",
            json!({ "platform": "android", "token": format!("{}/../x", fcm("a")),
                    "app": "staff", "locale": "en-IN" }),
        ),
    ] {
        let (status, body) = put(&app, &owner, install, bad).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{what}: {body}");
    }
    // A malformed body (a missing token, an unknown field) is refused before anything is read.
    for malformed in [
        json!({ "platform": "ios", "app": "staff", "locale": "en-IN" }),
        json!({ "platform": "ios", "token": "abc", "app": "staff", "locale": "en-IN",
                "name": "Asha" }),
    ] {
        let (status, _) = put(&app, &owner, install, malformed).await;
        assert!(status.is_client_error(), "{status}");
    }
    let (status, _) = app
        .send(
            Method::PUT,
            APP,
            "/api/v1/me/devices/not-a-uuid",
            Some(&owner),
            Some(registration(&ios("abc"))),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // The longest token is fine, and nothing was stored by the refusals.
    let (status, _) = put(&app, &owner, install, registration(&"a".repeat(200))).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(rows(&app, ALPHA_OWNER).await, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn removing_is_repeatable_and_stays_in_the_callers_own_installs() {
    let app = TestApp::start().await;
    let (asha, farah) = (app.token(ALPHA_OWNER), app.token(ALPHA_FRONT_DESK));
    let (mine, theirs) = (Uuid::now_v7(), Uuid::now_v7());
    put(&app, &asha, mine, registration(&ios("asha-phone"))).await;
    put(&app, &farah, theirs, registration(&ios("farah-phone"))).await;

    // Another person's install id is in their own namespace: 204, and nothing changes.
    assert_eq!(delete(&app, &asha, theirs).await, StatusCode::NO_CONTENT);
    assert_eq!(
        token_of(&app, ALPHA_FRONT_DESK, theirs).await.as_deref(),
        Some(ios("farah-phone").as_str())
    );
    assert_eq!(
        token_of(&app, ALPHA_OWNER, mine).await.as_deref(),
        Some(ios("asha-phone").as_str())
    );

    // Removing your own clears the token, again and again, and an unknown id is fine too.
    for _ in 0..2 {
        assert_eq!(delete(&app, &asha, mine).await, StatusCode::NO_CONTENT);
    }
    assert_eq!(token_of(&app, ALPHA_OWNER, mine).await, None);
    assert_eq!(
        delete(&app, &asha, Uuid::now_v7()).await,
        StatusCode::NO_CONTENT
    );
    // Signing in again registers the same install anew.
    put(&app, &asha, mine, registration(&ios("asha-new-token"))).await;
    assert_eq!(
        token_of(&app, ALPHA_OWNER, mine).await.as_deref(),
        Some(ios("asha-new-token").as_str())
    );
    // Without a token it is refused.
    let (status, _) = app.send(Method::DELETE, APP, &path(mine), None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_revoked_session_drops_its_devices_from_the_push_list() {
    let app = TestApp::start().await;
    let laptop = app.token(ALPHA_OWNER);
    let phone = app.token(ALPHA_OWNER);
    let (phone_install, laptop_install) = (Uuid::now_v7(), Uuid::now_v7());
    put(
        &app,
        &phone,
        phone_install,
        registration(&ios("phone-token")),
    )
    .await;
    put(
        &app,
        &laptop,
        laptop_install,
        registration(&ios("laptop-token")),
    )
    .await;
    let user: Uuid = sqlx::query_scalar("select id from aarogyam.users where auth_uid = $1")
        .bind(ALPHA_OWNER)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let db = app.api_db();
    let tokens = async |db: &sakalya_db::Db| -> Vec<String> {
        let mut tokens: Vec<String> = aarogyam_dal::devices::push_devices(db.pool(), &[user])
            .await
            .unwrap()
            .into_iter()
            .map(|device| device.push_token)
            .collect();
        tokens.sort();
        tokens
    };
    let mut both = vec![ios("laptop-token"), ios("phone-token")];
    both.sort();
    assert_eq!(tokens(&db).await, both);

    // The laptop signs everything else out: the phone's session is revoked, so its device is
    // no longer pushed to, though its token is still stored.
    let (status, done) = app
        .send(
            Method::POST,
            APP,
            "/api/v1/me/sessions/revoke-others",
            Some(&laptop),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(tokens(&db).await, [ios("laptop-token")]);
    assert!(token_of(&app, ALPHA_OWNER, phone_install).await.is_some());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_table_keeps_its_rules_and_the_api_login_reads_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    put(
        &app,
        &owner,
        Uuid::now_v7(),
        registration(&ios("rules-token")),
    )
    .await;
    let user: Uuid = sqlx::query_scalar("select id from aarogyam.users where auth_uid = $1")
        .bind(ALPHA_OWNER)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let insert = "insert into aarogyam.devices (user_id, platform, installation_id, app, push_token, locale) values ($1, $2, $3, $4, $5, $6)";
    let attempt =
        async |platform: &str, install: Uuid, app_name: &str, token: &str, locale: &str| {
            sqlx::query(insert)
                .bind(user)
                .bind(platform)
                .bind(install)
                .bind(app_name)
                .bind(token)
                .bind(locale)
                .execute(&app.owner)
                .await
        };
    let fresh = Uuid::now_v7();
    // The same install twice for one person, one token held twice, a bad app, a bad locale and
    // an over-long token are all refused by the database itself.
    assert!(attempt("ios", fresh, "staff", "t-1", "en-IN").await.is_ok());
    assert!(
        attempt("ios", fresh, "staff", "t-2", "en-IN")
            .await
            .is_err()
    );
    assert!(
        attempt("ios", Uuid::now_v7(), "staff", "t-1", "en-IN")
            .await
            .is_err()
    );
    assert!(
        attempt("ios", Uuid::now_v7(), "kiosk", "t-3", "en-IN")
            .await
            .is_err()
    );
    assert!(
        attempt("ios", Uuid::now_v7(), "staff", "t-4", "english")
            .await
            .is_err()
    );
    assert!(
        attempt("ios", Uuid::now_v7(), "staff", &"a".repeat(4097), "en-IN")
            .await
            .is_err()
    );
    // Rows from before 0714 (no install, app or locale) stay valid, and can repeat.
    for _ in 0..2 {
        sqlx::query("insert into aarogyam.devices (user_id, platform) values ($1, 'android')")
            .bind(user)
            .execute(&app.owner)
            .await
            .unwrap();
    }

    // The API's login reads no table directly; it only runs the functions.
    let db = app.api_db();
    let direct = sqlx::query("select push_token from aarogyam.devices")
        .fetch_all(db.pool())
        .await;
    assert!(direct.is_err(), "the API login must not read devices");
    let direct = sqlx::query("update aarogyam.devices set push_token = null")
        .execute(db.pool())
        .await;
    assert!(direct.is_err(), "the API login must not write devices");
    let public_can_run: bool = sqlx::query_scalar(
        "select bool_or(has_function_privilege('public', p.oid, 'execute'))
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'app' and p.proname in ('register_device', 'unregister_device',
           'claim_staff_push', 'push_members', 'push_devices', 'clear_device_token')",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(
        !public_can_run,
        "only the API login may run the push functions"
    );
    // The table comment keeps its sensitivity.
    let comment: String =
        sqlx::query_scalar("select obj_description('aarogyam.devices'::regclass)")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert!(comment.contains("sensitivity=personal"), "{comment}");
    // The change history masks the token.
    let leaked: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events where table_name = 'aarogyam.devices'
           and changes::text like '%' || $1 || '%'",
    )
    .bind(ios("rules-token"))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(leaked, 0, "a push token must not reach the change history");
    app.finish().await;
}

async fn listed(app: &TestApp, auth_uid: Uuid) -> Vec<String> {
    let user: Uuid = sqlx::query_scalar("select id from aarogyam.users where auth_uid = $1")
        .bind(auth_uid)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let db = app.api_db();
    aarogyam_dal::devices::push_devices(db.pool(), &[user])
        .await
        .unwrap()
        .into_iter()
        .map(|device| device.push_token)
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_phone_unused_for_two_weeks_stops_being_pushed_to() {
    let app = TestApp::start().await;
    let phone = app.token(ALPHA_OWNER);
    put(
        &app,
        &phone,
        Uuid::now_v7(),
        registration(&ios("quiet-phone")),
    )
    .await;
    assert_eq!(listed(&app, ALPHA_OWNER).await, [ios("quiet-phone")]);
    let age = async |days: i32| {
        sqlx::query(
            "update aarogyam.sessions set last_active_at = now() - make_interval(days => $1)
             where user_id = (select id from aarogyam.users where auth_uid = $2)",
        )
        .bind(days)
        .bind(ALPHA_OWNER)
        .execute(&app.owner)
        .await
        .unwrap();
    };
    age(13).await;
    assert_eq!(listed(&app, ALPHA_OWNER).await.len(), 1);
    age(15).await;
    assert_eq!(listed(&app, ALPHA_OWNER).await, Vec::<String>::new());
    // Any request on the session brings it back: the phone is in use again.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(listed(&app, ALPHA_OWNER).await.len(), 1);
    // A device with no session on record is never pushed to.
    sqlx::query("update aarogyam.devices set session_id = null")
        .execute(&app.owner)
        .await
        .unwrap();
    assert_eq!(listed(&app, ALPHA_OWNER).await, Vec::<String>::new());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn signing_out_the_current_session_clears_its_devices_and_nobody_elses() {
    let app = TestApp::start().await;
    let (phone, laptop, farah) = (
        app.token(ALPHA_OWNER),
        app.token(ALPHA_OWNER),
        app.token(ALPHA_FRONT_DESK),
    );
    let (phone_install, laptop_install, farah_install) =
        (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    put(&app, &phone, phone_install, registration(&ios("out-phone"))).await;
    put(
        &app,
        &laptop,
        laptop_install,
        registration(&ios("out-laptop")),
    )
    .await;
    put(&app, &farah, farah_install, registration(&ios("out-farah"))).await;

    let revoke = "/api/v1/me/sessions/revoke-current";
    let (status, _) = app.send(Method::POST, APP, revoke, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = app
        .send(Method::POST, APP, revoke, Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    // The phone's token is gone and its session is refused; the other sessions are untouched.
    assert_eq!(token_of(&app, ALPHA_OWNER, phone_install).await, None);
    assert_eq!(listed(&app, ALPHA_OWNER).await, [ios("out-laptop")]);
    assert_eq!(listed(&app, ALPHA_FRONT_DESK).await, [ios("out-farah")]);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&laptop), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    // Repeating it with the same token is refused: the session is already gone.
    let (status, _) = app
        .send(Method::POST, APP, revoke, Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // A session first seen by this very call is revoked too.
    let fresh = app.token(ALPHA_OWNER);
    let (status, _) = app
        .send(Method::POST, APP, revoke, Some(&fresh), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&fresh), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}
