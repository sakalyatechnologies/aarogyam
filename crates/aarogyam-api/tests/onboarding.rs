//! Clinic registration and onboarding: the public form, the console's decisions, the clinic
//! detail page and inviting staff from the console. Supabase is a fake that counts calls.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use aarogyam_api::TokenCheck;
use aarogyam_app::accounts::{AccountFuture, AuthUid, SignInAccounts};
use aarogyam_domain::patient::Email;
use axum::http::{Method, StatusCode};
use sakalya_http::HttpConfig;
use serde_json::{Value, json};
use support::people::{ALPHA_OWNER, STAFF, STRANGER};
use support::{ALPHA, CONSOLE, TestApp, dev_tokens};
use uuid::Uuid;

const PUBLIC: &str = "app.localtest.me";

/// Counts accounts made sure of, as Supabase's Admin API would make them.
#[derive(Debug, Default)]
struct FakeAccounts {
    calls: AtomicUsize,
    emails: std::sync::Mutex<Vec<String>>,
}

impl SignInAccounts for FakeAccounts {
    fn ensure_user<'a>(&'a self, email: &'a Email) -> AccountFuture<'a> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.emails.lock().unwrap().push(email.as_str().to_owned());
        Box::pin(async { Ok(AuthUid::from_uuid(Uuid::now_v7())) })
    }
}

async fn start(accounts: &Arc<FakeAccounts>) -> TestApp {
    let accounts: Arc<dyn SignInAccounts> = Arc::clone(accounts) as _;
    TestApp::start_configured(
        HttpConfig::default(),
        TokenCheck::Dev(dev_tokens()),
        move |state| state.with_accounts(accounts),
    )
    .await
}

fn application(email: &str) -> Value {
    json!({
        "clinic_name": "Lotus Dental Care",
        "city": "Pune",
        "contact_name": "Lata Kulkarni",
        "email": email,
        "phone": "98765 43210",
        "message": "Two chairs."
    })
}

async fn apply(app: &TestApp, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        PUBLIC,
        "/api/v1/registrations",
        None,
        Some(body),
    )
    .await
}

async fn pending(app: &TestApp, staff: &str) -> Vec<Value> {
    let (status, list) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/applications?status=pending",
            Some(staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    list["items"].as_array().unwrap().clone()
}

async fn count(app: &TestApp, sql: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn registration_always_answers_the_same_and_collapses_duplicates() {
    let accounts = Arc::new(FakeAccounts::default());
    let app = start(&accounts).await;
    let (first_status, first) = apply(&app, application("Lata@Lotus.test")).await;
    assert_eq!(first_status, StatusCode::ACCEPTED);
    // Again from the same address, and from an address that already belongs to a clinic
    // owner: the answer is the same, so it reveals nothing.
    let (status, again) = apply(&app, application("lata@lotus.test")).await;
    assert_eq!((status, &again), (StatusCode::ACCEPTED, &first));
    let (status, existing) = apply(&app, application("asha@alpha.test")).await;
    assert_eq!((status, &existing), (StatusCode::ACCEPTED, &first));

    // Invalid input is refused by field, without echoing anything.
    let (status, _) = apply(
        &app,
        json!({ "clinic_name": "", "city": "Pune", "contact_name": "L", "email": "x@y.test" }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = apply(&app, application("not-an-email")).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let staff = app.token(STAFF);
    let items = pending(&app, &staff).await;
    assert_eq!(items.len(), 2);
    let lotus = items
        .iter()
        .find(|item| item["email"] == "lata@lotus.test")
        .unwrap();
    assert_eq!(lotus["submissions"], 2);
    assert_eq!(lotus["phone"], "+919876543210");
    assert_eq!(accounts.calls.load(Ordering::SeqCst), 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn registration_is_throttled_per_ip() {
    let app = TestApp::start_configured(
        HttpConfig::default(),
        TokenCheck::Dev(dev_tokens()),
        |state| state.with_throttle(aarogyam_api::standard_throttle().unwrap()),
    )
    .await;
    for _ in 0..5 {
        let (status, _) = apply(&app, application("lata@lotus.test")).await;
        assert_eq!(status, StatusCode::ACCEPTED);
    }
    let (status, _) = apply(&app, application("other@lotus.test")).await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    // Other routes keep their own, looser limit.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/session", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn approval_creates_the_clinic_the_account_the_invitation_and_the_email() {
    let accounts = Arc::new(FakeAccounts::default());
    let app = start(&accounts).await;
    apply(&app, application("lata@lotus.test")).await;
    let staff = app.token(STAFF);
    let id = pending(&app, &staff).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let path = format!("/api/v1/console/applications/{id}/approve");

    // Not on the console host, or not staff: refused.
    let (status, _) = app
        .send(Method::POST, ALPHA, &path, Some(&staff), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::POST,
            CONSOLE,
            &path,
            Some(&app.token(ALPHA_OWNER)),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, approved) = app
        .send(Method::POST, CONSOLE, &path, Some(&staff), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{approved}");
    assert_eq!(approved["slug"], "lotus-dental-care");
    assert_eq!(approved["account_ready"], true);
    let link = approved["invite_link"].as_str().unwrap();
    assert!(
        link.starts_with("https://lotus-dental-care.localtest.me/invite#"),
        "{link}"
    );
    assert_eq!(accounts.calls.load(Ordering::SeqCst), 1);
    assert_eq!(*accounts.emails.lock().unwrap(), ["lata@lotus.test"]);
    assert_eq!(
        count(&app, "select count(*) from aarogyam.outbox_events where event_key = 'staff.invited' and recipient = 'lata@lotus.test' and secret is not null").await,
        1
    );

    // Approving twice does nothing more.
    let (status, _) = app
        .send(Method::POST, CONSOLE, &path, Some(&staff), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(accounts.calls.load(Ordering::SeqCst), 1);

    // The owner joins with the emailed link, signed in with the applying address.
    let token = link.split_once('#').unwrap().1;
    let owner = app
        .tokens
        .mint_with_email(Uuid::now_v7(), Some("lata@lotus.test"))
        .unwrap();
    let (status, joined) = app
        .send(
            Method::POST,
            PUBLIC,
            "/api/v1/invitations/accept",
            Some(&owner),
            Some(json!({ "token": token })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{joined}");
    assert_eq!(joined["org_id"], approved["clinic_id"]);

    // The console shows the clinic with its owner, and no patient data.
    let clinic_path = format!(
        "/api/v1/console/clinics/{}",
        approved["clinic_id"].as_str().unwrap()
    );
    let (status, clinic) = app
        .send(Method::GET, CONSOLE, &clinic_path, Some(&staff), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{clinic}");
    assert_eq!(clinic["name"], "Lotus Dental Care");
    assert_eq!(clinic["hosts"][0], "lotus-dental-care.localtest.me");
    assert_eq!(clinic["active_members"], 1);
    assert_eq!(clinic["patients"], 0);
    assert_eq!(clinic["members"][0]["role_key"], "owner");
    assert_eq!(clinic["members"][0]["status"], "active");
    // The application is approved and points at the clinic.
    let (_, approved_list) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/applications?status=approved",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(
        approved_list["items"][0]["clinic_id"],
        approved["clinic_id"]
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn rejection_closes_the_application() {
    let accounts = Arc::new(FakeAccounts::default());
    let app = start(&accounts).await;
    apply(&app, application("lata@lotus.test")).await;
    let staff = app.token(STAFF);
    let id = pending(&app, &staff).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let path = format!("/api/v1/console/applications/{id}/reject");
    let (status, _) = app
        .send(
            Method::POST,
            CONSOLE,
            &path,
            Some(&staff),
            Some(json!({ "reason": "Not a clinic" })),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(pending(&app, &staff).await.len(), 0);
    let (status, _) = app
        .send(Method::POST, CONSOLE, &path, Some(&staff), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, rejected) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/applications?status=rejected",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(rejected["items"][0]["decision_reason"], "Not a clinic");
    assert_eq!(rejected["items"][0]["decided_by"], "Sakalya Staff");
    // The same address may apply again once its application was decided.
    let (status, _) = apply(&app, application("lata@lotus.test")).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(pending(&app, &staff).await.len(), 1);
    assert_eq!(accounts.calls.load(Ordering::SeqCst), 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_console_invites_doctors_with_a_role_the_clinic_has() {
    let accounts = Arc::new(FakeAccounts::default());
    let app = start(&accounts).await;
    let staff = app.token(STAFF);
    let alpha = app.clinic_id("alpha").await;
    let path = format!("/api/v1/console/clinics/{alpha}/invitations");

    let (status, invited) = app
        .send(
            Method::POST,
            CONSOLE,
            &path,
            Some(&staff),
            Some(json!({ "email": "Dr.Rao@Alpha.test", "role_key": "doctor" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{invited}");
    assert_eq!(invited["email"], "dr.rao@alpha.test");
    assert!(
        invited["invite_link"]
            .as_str()
            .unwrap()
            .starts_with("https://alpha.localtest.me/invite#")
    );
    assert_eq!(accounts.calls.load(Ordering::SeqCst), 1);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.outbox_events where recipient = 'dr.rao@alpha.test'"
        )
        .await,
        1
    );

    // An unknown role or a bad address is refused before any account is made.
    for body in [
        json!({ "email": "x@alpha.test", "role_key": "surgeon-general" }),
        json!({ "email": "not-an-email", "role_key": "doctor" }),
    ] {
        let (status, _) = app
            .send(Method::POST, CONSOLE, &path, Some(&staff), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    assert_eq!(accounts.calls.load(Ordering::SeqCst), 1);

    // An unknown clinic is 404; people who aren't staff get 403; clinic hosts get 404.
    let missing = format!("/api/v1/console/clinics/{}/invitations", Uuid::now_v7());
    let body = json!({ "email": "x@alpha.test", "role_key": "doctor" });
    let (status, _) = app
        .send(
            Method::POST,
            CONSOLE,
            &missing,
            Some(&staff),
            Some(body.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for person in [ALPHA_OWNER, STRANGER] {
        let (status, _) = app
            .send(
                Method::POST,
                CONSOLE,
                &path,
                Some(&app.token(person)),
                Some(body.clone()),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, _) = app
        .send(Method::POST, ALPHA, &path, Some(&staff), Some(body))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/console/clinics/{alpha}"),
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The detail page lists the open invitation.
    let (_, clinic) = app
        .send(
            Method::GET,
            CONSOLE,
            &format!("/api/v1/console/clinics/{alpha}"),
            Some(&staff),
            None,
        )
        .await;
    assert!(
        clinic["invitations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|i| i["email"] == "dr.rao@alpha.test" && i["role_key"] == "doctor")
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn analysts_can_look_but_not_onboard() {
    let accounts = Arc::new(FakeAccounts::default());
    let app = start(&accounts).await;
    sqlx::raw_sql(
        "update aarogyam.platform_users set role = 'analyst'
         where user_id = '01900000-0000-7000-8000-0000000000c1'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    apply(&app, application("lata@lotus.test")).await;
    let analyst = app.token(STAFF);
    let id = pending(&app, &analyst).await[0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    for path in [
        format!("/api/v1/console/applications/{id}/approve"),
        format!("/api/v1/console/applications/{id}/reject"),
        format!(
            "/api/v1/console/clinics/{}/invitations",
            app.clinic_id("alpha").await
        ),
    ] {
        let (status, _) = app
            .send(
                Method::POST,
                CONSOLE,
                &path,
                Some(&analyst),
                Some(json!({ "email": "x@alpha.test", "role_key": "doctor" })),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
    assert_eq!(accounts.calls.load(Ordering::SeqCst), 0);
    app.finish().await;
}
