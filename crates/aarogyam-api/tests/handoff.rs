//! Central sign-in's session handoff: a code for one host, once, within a minute, only for a
//! host the person may go to, stored as a hash, audited and throttled.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use std::sync::{Arc, Mutex};

use aarogyam_api::TokenCheck;
use aarogyam_app::accounts::{
    AccountFuture, AccountsError, SignInAccounts, SignInToken, TokenFuture,
};
use aarogyam_domain::patient::Email;
use axum::http::{Method, StatusCode};
use sakalya_http::HttpConfig;
use secrecy::SecretString;
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, CONSOLE, TestApp, dev_tokens};

/// The public site's host, where people sign in.
const SITE: &str = "app.localtest.me";
const CREATE: &str = "/api/v1/auth/handoff";
const REDEEM: &str = "/api/v1/auth/handoff/redeem";

async fn handoff(app: &TestApp, who: uuid::Uuid, host: &str) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        SITE,
        CREATE,
        Some(&app.token(who)),
        Some(json!({ "host": host })),
    )
    .await
}

async fn redeem(app: &TestApp, host: &str, code: &str) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        REDEEM,
        None,
        Some(json!({ "code": code })),
    )
    .await
}

fn code(created: &Value) -> String {
    created["code"].as_str().unwrap().to_owned()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_code_signs_the_person_in_once_on_its_own_host() {
    let app = TestApp::start().await;
    let (status, created) = handoff(&app, ALPHA_OWNER, "Alpha.LocalTest.me").await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let code = code(&created);
    assert_eq!(created["host"], ALPHA);
    assert_eq!(
        created["redirect_url"],
        format!("https://{ALPHA}/auth/handoff#code={code}")
    );

    // Only the hash is stored.
    let stored: (String, String) =
        sqlx::query_as("select code_hash, target_host from aarogyam.auth_handoffs")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(stored.0, aarogyam_app::tokens::hash_token(&code));
    assert_ne!(stored.0, code);
    assert_eq!(stored.1, ALPHA);

    let (status, session) = redeem(&app, ALPHA, &code).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert_eq!(session["kind"], "dev");
    let token = session["access_token"].as_str().unwrap();
    let (status, me) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(token), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["clinic"]["slug"], "alpha");

    // Once only.
    let (status, _) = redeem(&app, ALPHA, &code).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Both steps are in the change history, without the hash.
    let history: Vec<(String, Option<Value>)> = sqlx::query_as(
        "select action, changes from audit.audit_events
         where table_name = 'aarogyam.auth_handoffs' order by at",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(history.len(), 2, "{history:?}");
    assert!(!format!("{history:?}").contains(&stored.0));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn wrong_hosts_expired_and_garbled_codes_sign_no_one_in() {
    let app = TestApp::start().await;

    // Redeemed on another clinic's host: refused, and the code is used up.
    let (_, created) = handoff(&app, ALPHA_OWNER, ALPHA).await;
    let stolen = code(&created);
    let (status, _) = redeem(&app, BETA, &stolen).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = redeem(&app, ALPHA, &stolen).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Expired.
    let (_, created) = handoff(&app, ALPHA_OWNER, ALPHA).await;
    sqlx::query("update aarogyam.auth_handoffs set expires_at = now() - interval '1 second' where redeemed_at is null")
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, _) = redeem(&app, ALPHA, &code(&created)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Codes are at most a minute long.
    let (_, created) = handoff(&app, ALPHA_OWNER, ALPHA).await;
    let expires = time::OffsetDateTime::parse(
        created["expires_at"].as_str().unwrap(),
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    assert!(expires - time::OffsetDateTime::now_utc() <= time::Duration::seconds(61));

    for garbled in ["", "short", &"x".repeat(43).replace('x', "!")] {
        let (status, _) = redeem(&app, ALPHA, garbled).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{garbled}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_code_is_only_for_a_host_the_person_may_go_to() {
    let app = TestApp::start().await;
    // Not signed in.
    let (status, _) = app
        .send(
            Method::POST,
            SITE,
            CREATE,
            None,
            Some(json!({ "host": ALPHA })),
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    // Another clinic's member, a stranger, an unknown host: the same 404.
    for (who, host) in [
        (BETA_OWNER, ALPHA),
        (ALPHA_OWNER, BETA),
        (STRANGER, ALPHA),
        (ALPHA_OWNER, "nowhere.localtest.me"),
        // The console needs Sakalya staff.
        (ALPHA_OWNER, CONSOLE),
    ] {
        let (status, body) = handoff(&app, who, host).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{who} to {host}: {body}");
    }
    let (status, _) = handoff(&app, ALPHA_OWNER, "https://alpha.localtest.me/x").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let none: i64 = sqlx::query_scalar("select count(*) from aarogyam.auth_handoffs")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(none, 0);

    // Each owner to their own clinic, staff to the console.
    let (status, created) = handoff(&app, BETA_OWNER, BETA).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = redeem(&app, BETA, &code(&created)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, created) = handoff(&app, STAFF, CONSOLE).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, session) = redeem(&app, CONSOLE, &code(&created)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/clinics",
            Some(session["access_token"].as_str().unwrap()),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    // A suspended member gets no code.
    sqlx::query(
        "update aarogyam.memberships set status = 'suspended'
         where user_id = (select id from aarogyam.users where auth_uid = $1)",
    )
    .bind(ALPHA_ASSISTANT)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, _) = handoff(&app, ALPHA_ASSISTANT, ALPHA).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

/// Issues sign-in tokens as Supabase's `generate_link` would.
#[derive(Debug, Default)]
struct FakeSupabase {
    asked_for: Mutex<Vec<String>>,
}

impl SignInAccounts for FakeSupabase {
    fn ensure_user<'a>(&'a self, _email: &'a Email) -> AccountFuture<'a> {
        Box::pin(async { Err(AccountsError::Configuration("not used")) })
    }

    fn sign_in_token<'a>(&'a self, email: &'a Email) -> TokenFuture<'a> {
        self.asked_for
            .lock()
            .unwrap()
            .push(email.as_str().to_owned());
        Box::pin(async { Ok(SignInToken::new(SecretString::from("hashed-token-1"))) })
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn with_supabase_the_host_gets_a_one_time_magic_link_token() {
    let supabase = Arc::new(FakeSupabase::default());
    let accounts: Arc<dyn SignInAccounts> = Arc::clone(&supabase) as _;
    let app = TestApp::start_configured(
        HttpConfig::default(),
        TokenCheck::Dev(dev_tokens()),
        move |state| state.with_accounts(accounts),
    )
    .await;
    let (_, created) = handoff(&app, ALPHA_OWNER, ALPHA).await;
    let (status, session) = redeem(&app, ALPHA, &code(&created)).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    assert_eq!(
        session,
        json!({ "kind": "supabase", "email": "asha@alpha.test", "token_hash": "hashed-token-1", "access_token": null })
    );
    assert_eq!(*supabase.asked_for.lock().unwrap(), ["asha@alpha.test"]);
    // A refused code never reaches Supabase.
    let (status, _) = redeem(&app, ALPHA, &code(&created)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(supabase.asked_for.lock().unwrap().len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn redeeming_is_throttled_per_ip() {
    let app = TestApp::start_configured(
        HttpConfig::default(),
        TokenCheck::Dev(dev_tokens()),
        |state| state.with_throttle(aarogyam_api::standard_throttle().unwrap()),
    )
    .await;
    let guess = "A".repeat(43);
    for _ in 0..20 {
        let (status, _) = redeem(&app, ALPHA, &guess).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    let (status, _) = redeem(&app, ALPHA, &guess).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    app.finish().await;
}

async fn me(app: &TestApp, who: uuid::Uuid) -> Value {
    let (status, body) = app
        .send(Method::GET, SITE, "/api/v1/me", Some(&app.token(who)), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn me_says_who_may_open_the_console() {
    let app = TestApp::start().await;
    let staff = me(&app, STAFF).await;
    assert_eq!(staff["console_access"], true);
    assert_eq!(staff["clinics"], json!([]));
    let owner = me(&app, ALPHA_OWNER).await;
    assert_eq!(owner["console_access"], false);
    assert_eq!(owner["clinics"][0]["slug"], "alpha");
    assert_eq!(
        me(&app, STRANGER).await,
        json!({ "clinics": [], "console_access": false })
    );

    // Staff can't also belong to a clinic: the database refuses, so /me never mixes the two.
    let joined = sqlx::query(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, u.id, r.id, 'active' from aarogyam.organizations o
         join aarogyam.roles r on r.org_id = o.id and r.key = 'owner'
         join aarogyam.users u on u.auth_uid = $1 where o.slug = 'beta'",
    )
    .bind(STAFF)
    .execute(&app.owner)
    .await;
    assert!(joined.is_err());
    assert_eq!(me(&app, STAFF).await["clinics"], json!([]));

    // Clinic members can't be made staff, and the last owner can't be deactivated.
    sqlx::query(
        "insert into aarogyam.platform_users (user_id, role)
         select id, 'owner' from aarogyam.users where auth_uid = $1",
    )
    .bind(ALPHA_OWNER)
    .execute(&app.owner)
    .await
    .unwrap_err();
    sqlx::query("update aarogyam.platform_users set active = false")
        .execute(&app.owner)
        .await
        .unwrap_err();
    app.finish().await;
}
