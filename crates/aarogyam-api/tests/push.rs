//! Staff push notifications on a real database, against local fake APNs and FCM servers (never
//! Apple or Google): who is pushed to (exactly those whose feed shows the notification), the
//! exact requests, dead tokens, the switched-off sender, the 30-minute cut-off, revoked
//! sessions, and reminders and escalations. Keys are generated here and thrown away.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::{Arc, Mutex};

use aarogyam_domain::ids::ClinicId;
use aarogyam_domain::notification::{Audience, OpenHours};
use aarogyam_notify::push::{Apns, Fcm};
use aarogyam_notify::{Push, PushSetup};
use aws_lc_rs::encoding::AsDer;
use aws_lc_rs::rsa::{KeyPair, KeySize};
use aws_lc_rs::signature::{ECDSA_P256_SHA256_FIXED_SIGNING, EcdsaKeyPair};
use axum::http::{Method, StatusCode};
use base64::Engine as _;
use secrecy::SecretString;
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};
use time::{Duration, OffsetDateTime, Time};
use uuid::Uuid;

const APP: &str = "app.localtest.me";
const TOPIC: &str = "test.example.staff";

fn pem(label: &str, der: &[u8]) -> String {
    let body = base64::engine::general_purpose::STANDARD.encode(der);
    let lines: Vec<&str> = body
        .as_bytes()
        .chunks(64)
        .map(|c| std::str::from_utf8(c).unwrap())
        .collect();
    format!(
        "-----BEGIN {label}-----\n{}\n-----END {label}-----\n",
        lines.join("\n")
    )
}

/// A throwaway P-256 key in `.p8` form.
fn p8() -> SecretString {
    let rng = aws_lc_rs::rand::SystemRandom::new();
    let doc = EcdsaKeyPair::generate_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &rng).unwrap();
    SecretString::from(pem("PRIVATE KEY", doc.as_ref()))
}

/// A throwaway service account whose token endpoint is `token_uri`.
fn service_account(token_uri: &str) -> SecretString {
    let key = KeyPair::generate(KeySize::Rsa2048).unwrap();
    let der = AsDer::<aws_lc_rs::encoding::Pkcs8V1Der>::as_der(&key).unwrap();
    SecretString::from(
        json!({ "client_email": "push@test.invalid",
                "private_key": pem("PRIVATE KEY", der.as_ref()),
                "token_uri": token_uri })
        .to_string(),
    )
}

#[derive(Clone, Debug)]
struct Seen {
    path: String,
    headers: HashMap<String, String>,
    body: Value,
}

#[derive(Clone, Default)]
struct Mock {
    seen: Arc<Mutex<Vec<Seen>>>,
    /// Tokens (the last path segment, or the body's token) the fake says are dead.
    dead: Arc<Mutex<HashSet<String>>>,
    /// Tokens the fake answers like a misconfigured sender: APNs 400 `BadDeviceToken`, FCM 404.
    confused: Arc<Mutex<HashSet<String>>>,
}

impl Mock {
    fn requests(&self) -> Vec<Seen> {
        self.seen.lock().unwrap().clone()
    }
    fn confuse(&self, token: &str) {
        self.confused.lock().unwrap().insert(token.to_owned());
    }
    fn kill(&self, token: &str) {
        self.dead.lock().unwrap().insert(token.to_owned());
    }
}

/// A fake provider: records every request; answers per `answer(request) -> (status, body)`.
async fn serve(
    mock: &Mock,
    answer: impl Fn(&Mock, &Seen) -> (u16, String) + Clone + Send + Sync + 'static,
) -> String {
    let state = mock.clone();
    let router = axum::Router::new().fallback(move |req: axum::extract::Request| {
        let (state, answer) = (state.clone(), answer.clone());
        async move {
            let (parts, body) = req.into_parts();
            let bytes = axum::body::to_bytes(body, 1 << 20).await.unwrap();
            let text = String::from_utf8_lossy(&bytes).into_owned();
            let seen = Seen {
                path: parts.uri.path().to_owned(),
                headers: parts
                    .headers
                    .iter()
                    .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_owned()))
                    .collect(),
                body: serde_json::from_str(&text).unwrap_or(Value::String(text)),
            };
            let (status, reply) = answer(&state, &seen);
            state.seen.lock().unwrap().push(seen);
            (StatusCode::from_u16(status).unwrap(), reply)
        }
    });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{address}")
}

struct Fakes {
    apns: Mock,
    fcm: Mock,
    push: Push,
}

async fn fakes() -> Fakes {
    let (apns, fcm) = (Mock::default(), Mock::default());
    let apns_url = serve(&apns, |mock, seen| {
        let token = seen.path.rsplit('/').next().unwrap().to_owned();
        if mock.dead.lock().unwrap().contains(&token) {
            (410, r#"{"reason":"Unregistered"}"#.to_owned())
        } else if mock.confused.lock().unwrap().contains(&token) {
            (400, r#"{"reason":"BadDeviceToken"}"#.to_owned())
        } else {
            (200, String::new())
        }
    })
    .await;
    let fcm_url = serve(&fcm, |mock, seen| {
        if seen.path == "/token" {
            return (
                200,
                r#"{"access_token":"fcm-access","expires_in":3600}"#.into(),
            );
        }
        let token = seen.body["message"]["token"].as_str().unwrap_or("");
        if mock.dead.lock().unwrap().contains(token) {
            (
                404,
                r#"{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}"#
                    .into(),
            )
        } else if mock.confused.lock().unwrap().contains(token) {
            (404, r#"{"error":{"code":404,"status":"NOT_FOUND"}}"#.into())
        } else {
            (200, r#"{"name":"projects/p/messages/1"}"#.into())
        }
    })
    .await;
    let push = Push::new(PushSetup {
        apns: Some(Apns::new(&apns_url, &p8(), "KEYID12345", "TEAMID1234", TOPIC).unwrap()),
        fcm: Some(
            Fcm::new(
                &fcm_url,
                "test-project",
                &service_account(&format!("{fcm_url}/token")),
            )
            .unwrap(),
        ),
    });
    Fakes { apns, fcm, push }
}

fn pushes(mock: &Mock) -> Vec<Seen> {
    mock.requests()
        .into_iter()
        .filter(|seen| seen.path != "/token")
        .collect()
}

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

/// A well-formed token for `seed` on `platform`.
fn token_for(platform: &str, seed: &str) -> String {
    if platform == "ios" {
        ios(seed)
    } else {
        fcm(seed)
    }
}

async fn register(app: &TestApp, auth_uid: Uuid, platform: &str, seed: &str) -> Uuid {
    let token = token_for(platform, seed);
    let install = Uuid::now_v7();
    let (status, body) = app
        .send(
            Method::PUT,
            APP,
            &format!("/api/v1/me/devices/{install}"),
            Some(&app.token(auth_uid)),
            Some(
                json!({ "platform": platform, "token": &token, "app": "staff",
                         "locale": "en-IN" }),
            ),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    install
}

struct Scene {
    clinic: Uuid,
    doctor_member: Uuid,
    doctor_auth: Uuid,
    practitioner: Uuid,
    other_practitioner: Uuid,
}

async fn member(app: &TestApp, clinic: Uuid, role: &str) -> (Uuid, Uuid, Uuid) {
    let auth_uid = Uuid::new_v4();
    let user: Uuid = sqlx::query_scalar(
        "insert into aarogyam.users (auth_uid, display_name, email) values ($1, 'Extra Member', $2) returning id",
    )
    .bind(auth_uid)
    .bind(format!("{auth_uid}@alpha.test"))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let member: Uuid = sqlx::query_scalar(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select $1, $2, id, 'active' from aarogyam.roles where org_id = $1 and key = $3
         returning id",
    )
    .bind(clinic)
    .bind(user)
    .bind(role)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    (auth_uid, user, member)
}

async fn scene(app: &TestApp) -> Scene {
    let clinic = app.clinic_id("alpha").await;
    // A doctor whose appointments are their own only.
    sqlx::query(
        "with r as (insert into aarogyam.roles (org_id, key, name) values ($1, 'doctor_own', 'Doctor')
                    returning id)
         insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
         select $1, r.id, p, 'own' from r, unnest(array['appointments.read', 'patients.read']) p",
    )
    .bind(clinic)
    .execute(&app.owner)
    .await
    .unwrap();
    let (doctor_auth, _, doctor_member) = member(app, clinic, "doctor_own").await;
    let practitioner: Uuid = sqlx::query_scalar(
        "insert into aarogyam.practitioners (org_id, membership_id, display_name)
         values ($1, $2, 'Dr Rao') returning id",
    )
    .bind(clinic)
    .bind(doctor_member)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let other_practitioner: Uuid = sqlx::query_scalar(
        "insert into aarogyam.practitioners (org_id, display_name) values ($1, 'Dr Jain')
         returning id",
    )
    .bind(clinic)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    Scene {
        clinic,
        doctor_member,
        doctor_auth,
        practitioner,
        other_practitioner,
    }
}

/// A booking request for `practitioner`; its notification's id.
async fn booking(app: &TestApp, scene: &Scene, practitioner: Uuid) -> Uuid {
    let patient: Uuid = sqlx::query_scalar(
        "insert into aarogyam.patients (org_id, number, full_name, sex, date_of_birth)
         values ($1, 'AD-' || (floor(random() * 1000000000))::int, 'Meera Shah', 'female',
                 date '1990-01-01') returning id",
    )
    .bind(scene.clinic)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let appointment: Uuid = sqlx::query_scalar(
        "insert into aarogyam.appointments
           (org_id, patient_id, practitioner_id, branch_id, starts_at, ends_at, status)
         select $1, $2, $3, b.id, now() + interval '2 days', now() + interval '2 days 30 minutes',
                'requested'
         from aarogyam.branches b where b.org_id = $1 limit 1 returning id",
    )
    .bind(scene.clinic)
    .bind(patient)
    .bind(practitioner)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    sqlx::query_scalar(
        "insert into aarogyam.staff_notifications (org_id, kind, appointment_id)
         values ($1, 'booking_requested', $2) returning id",
    )
    .bind(scene.clinic)
    .bind(appointment)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn pushed(app: &TestApp, id: Uuid) -> bool {
    sqlx::query_scalar(
        "select pushed_at is not null from aarogyam.staff_notifications where id = $1",
    )
    .bind(id)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn drain_old_rows(app: &TestApp) {
    // Rows the seed and other steps wrote are not what these tests are about.
    sqlx::query(
        "update aarogyam.staff_notifications set pushed_at = now() where pushed_at is null",
    )
    .execute(&app.owner)
    .await
    .unwrap();
}

fn all_text(mocks: &[&Mock]) -> String {
    let lines: Vec<String> = mocks
        .iter()
        .flat_map(|mock| pushes(mock))
        .map(|seen| format!("{} {}", seen.path, seen.body))
        .collect();
    lines.join("\n")
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one scenario compares every member's feed with the push recipients"
)]
async fn push_recipients_are_the_members_whose_feed_shows_it() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let own_row = booking(&app, &s, s.practitioner).await;
    let other_row = booking(&app, &s, s.other_practitioner).await;
    // A bill to collect, from a visit sent for payment.
    let patient: Uuid = sqlx::query_scalar("select id from aarogyam.patients limit 1")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let front_desk_member = member_of(&app, s.clinic, ALPHA_FRONT_DESK).await;
    let assistant_member = member_of(&app, s.clinic, ALPHA_ASSISTANT).await;
    let owner_member = member_of(&app, s.clinic, ALPHA_OWNER).await;
    let invoice: Uuid = sqlx::query_scalar(
        "insert into aarogyam.invoices (org_id, patient_id, branch_id)
         select $1, $2, (select id from aarogyam.branches where org_id = $1 limit 1) returning id",
    )
    .bind(s.clinic)
    .bind(patient)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let collect: Uuid = sqlx::query_scalar(
        "insert into aarogyam.staff_notifications (org_id, kind, invoice_id, href, audience)
         values ($1, 'collect_payment', $2, '/billing/invoices/x', 'front_desk') returning id",
    )
    .bind(s.clinic)
    .bind(invoice)
    .fetch_one(&app.owner)
    .await
    .unwrap();

    // Owners who left or were suspended, and another clinic's owner, are never recipients.
    let (_, _, left_member) = member(&app, s.clinic, "owner").await;
    let (_, _, suspended_member) = member(&app, s.clinic, "owner").await;
    sqlx::query("update aarogyam.memberships set status = 'left' where id = $1")
        .bind(left_member)
        .execute(&app.owner)
        .await
        .unwrap();
    sqlx::query("update aarogyam.memberships set status = 'suspended' where id = $1")
        .bind(suspended_member)
        .execute(&app.owner)
        .await
        .unwrap();
    let beta = app.clinic_id("beta").await;
    let beta_member = member_of(&app, beta, BETA_OWNER).await;
    let ids: Vec<Uuid> =
        sqlx::query_scalar("select id from aarogyam.staff_notifications where org_id = $1")
            .bind(s.clinic)
            .fetch_all(&app.owner)
            .await
            .unwrap();
    let db = app.api_db();
    let seeing =
        aarogyam_app::push::seeing(&db, ClinicId::from_uuid(s.clinic), &ids, Audience::Clinic)
            .await
            .unwrap();
    let by_member: HashMap<Uuid, BTreeSet<Uuid>> = seeing
        .into_iter()
        .map(|p| (p.membership_id.uuid(), p.seen.into_iter().collect()))
        .collect();

    let who: [(&str, Uuid, String); 5] = [
        ("owner", owner_member, owner.clone()),
        ("doctor", s.doctor_member, app.token(s.doctor_auth)),
        ("front desk", front_desk_member, app.token(ALPHA_FRONT_DESK)),
        ("assistant", assistant_member, app.token(ALPHA_ASSISTANT)),
        (
            "nothing",
            member_of(&app, s.clinic, ALPHA_NOTHING).await,
            app.token(ALPHA_NOTHING),
        ),
    ];
    for (name, membership, token) in &who {
        let (status, feed) = app
            .send(
                Method::GET,
                ALPHA,
                "/api/v1/notifications?limit=100",
                Some(token),
                None,
            )
            .await;
        let in_feed: BTreeSet<Uuid> = if status == StatusCode::OK {
            feed["items"]
                .as_array()
                .unwrap()
                .iter()
                .map(|item| item["id"].as_str().unwrap().parse().unwrap())
                .collect()
        } else {
            BTreeSet::new()
        };
        let pushed_to = by_member.get(membership).cloned().unwrap_or_default();
        assert_eq!(pushed_to, in_feed, "{name}: push recipients vs feed");
    }
    // The cases the rules exist for.
    let sees = |m: Uuid, id: Uuid| by_member.get(&m).is_some_and(|set| set.contains(&id));
    assert!(sees(owner_member, own_row) && sees(owner_member, other_row));
    assert!(
        sees(s.doctor_member, own_row),
        "a doctor sees their own patient's booking"
    );
    assert!(
        !sees(s.doctor_member, other_row),
        "own scope hides another doctor's booking"
    );
    assert!(
        sees(assistant_member, collect)
            || sees(front_desk_member, collect)
            || sees(owner_member, collect)
    );
    for (name, absent) in [
        ("a member who left", left_member),
        ("a suspended member", suspended_member),
        ("another clinic's owner", beta_member),
    ] {
        assert!(
            !by_member.contains_key(&absent),
            "{name} must not be pushed to"
        );
    }
    let escalation = aarogyam_app::push::seeing(
        &db,
        ClinicId::from_uuid(s.clinic),
        &[own_row],
        Audience::Owners,
    )
    .await
    .unwrap();
    assert_eq!(escalation.len(), 1, "an escalation goes to the owners only");
    assert_eq!(escalation[0].membership_id.uuid(), owner_member);
    // A suspended clinic is pushed to nobody, as its feed is closed too.
    sqlx::query("update aarogyam.organizations set status = 'suspended' where id = $1")
        .bind(s.clinic)
        .execute(&app.owner)
        .await
        .unwrap();
    let closed =
        aarogyam_app::push::seeing(&db, ClinicId::from_uuid(s.clinic), &ids, Audience::Clinic)
            .await
            .unwrap();
    assert!(
        closed.is_empty(),
        "a suspended clinic has no push recipients"
    );
    app.finish().await;
}

async fn member_of(app: &TestApp, clinic: Uuid, auth_uid: Uuid) -> Uuid {
    sqlx::query_scalar(
        "select m.id from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
         where m.org_id = $1 and u.auth_uid = $2",
    )
    .bind(clinic)
    .bind(auth_uid)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn requests_match_the_agreed_shapes_and_carry_no_names() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    register(&app, ALPHA_OWNER, "ios", "apns-owner-token").await;
    register(&app, s.doctor_auth, "android", "fcm-doctor-token").await;
    let row = booking(&app, &s, s.practitioner).await;

    let report = f
        .push
        .run(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(
        (report.claimed, report.sent, report.failed),
        (1, 2, 0),
        "{report:?}"
    );
    assert!(pushed(&app, row).await);

    let apns = pushes(&f.apns);
    assert_eq!(apns.len(), 1);
    let a = &apns[0];
    assert_eq!(a.path, format!("/3/device/{}", ios("apns-owner-token")));
    assert!(a.headers["authorization"].starts_with("bearer ey"));
    assert_eq!(a.headers["apns-topic"], TOPIC);
    assert_eq!(a.headers["apns-push-type"], "alert");
    assert_eq!(a.headers["apns-priority"], "10");
    assert_eq!(
        a.body,
        json!({
            "aps": { "alert": { "loc-key": "push.booking_requested", "title-loc-key": "push.title" },
                     "thread-id": "booking_requested", "sound": "default" },
            "kind": "booking_requested", "org_id": s.clinic.to_string(),
            "id": row.to_string(), "href": ""
        })
    );
    let google = pushes(&f.fcm);
    assert_eq!(google.len(), 1);
    assert_eq!(google[0].path, "/v1/projects/test-project/messages:send");
    assert_eq!(google[0].headers["authorization"], "Bearer fcm-access");
    assert_eq!(
        google[0].body,
        json!({ "message": { "token": fcm("fcm-doctor-token"),
            "data": { "kind": "booking_requested", "org_id": s.clinic.to_string(),
                      "id": row.to_string(), "href": "" },
            "android": { "priority": "high" } } })
    );
    let text = all_text(&[&f.apns, &f.fcm]);
    for name in ["Meera", "Shah", "Asha", "Rao", "Jain"] {
        assert!(!text.contains(name), "{name} must not appear in a push");
    }
    // A second run finds nothing new: no duplicates.
    f.push
        .run(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(pushes(&f.apns).len() + pushes(&f.fcm).len(), 2);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn dead_tokens_are_cleared() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    let apple = register(&app, ALPHA_OWNER, "ios", "dead-apns").await;
    let google = register(&app, s.doctor_auth, "android", "dead-fcm").await;
    f.apns.kill(&ios("dead-apns"));
    f.fcm.kill(&fcm("dead-fcm"));
    booking(&app, &s, s.practitioner).await;
    let report = f
        .push
        .run(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.cleared, report.sent), (2, 0), "{report:?}");
    for install in [apple, google] {
        let token: Option<String> = sqlx::query_scalar(
            "select push_token from aarogyam.devices where installation_id = $1",
        )
        .bind(install)
        .fetch_one(&app.owner)
        .await
        .unwrap();
        assert_eq!(token, None);
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_configuration_mistake_clears_no_token() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    let apple = register(&app, ALPHA_OWNER, "ios", "conf-apns").await;
    let google = register(&app, s.doctor_auth, "android", "conf-fcm").await;
    // A sandbox token against production, or a wrong Firebase project, fails for everyone.
    f.apns.confuse(&ios("conf-apns"));
    f.fcm.confuse(&fcm("conf-fcm"));
    booking(&app, &s, s.practitioner).await;
    let report = f
        .push
        .run(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!(
        (report.cleared, report.sent, report.failed),
        (0, 0, 2),
        "{report:?}"
    );
    for install in [apple, google] {
        let token: Option<String> = sqlx::query_scalar(
            "select push_token from aarogyam.devices where installation_id = $1",
        )
        .bind(install)
        .fetch_one(&app.owner)
        .await
        .unwrap();
        assert!(
            token.is_some(),
            "a failure that isn't UNREGISTERED or 410 keeps the token"
        );
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn disabled_sends_nothing_but_marks_rows_pushed() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    register(&app, ALPHA_OWNER, "ios", "off-token").await;
    let row = booking(&app, &s, s.practitioner).await;
    let report = Push::off()
        .run(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert_eq!((report.claimed, report.sent), (1, 0));
    assert!(pushed(&app, row).await);
    assert!(pushes(&f.apns).is_empty() && pushes(&f.fcm).is_empty());
    // Enabling it later does not send what was marked.
    f.push
        .run(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert!(pushes(&f.apns).is_empty());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_the_last_thirty_minutes_are_pushed() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    register(&app, ALPHA_OWNER, "ios", "cutoff-token").await;
    let db = app.api_db();
    let now = OffsetDateTime::now_utc();
    // 45 minutes after it was written, a notification is marked pushed and not sent.
    let old = booking(&app, &s, s.practitioner).await;
    let report = f.push.run(&db, now + Duration::minutes(45)).await.unwrap();
    assert_eq!(
        (report.claimed, report.too_old, report.sent),
        (1, 1, 0),
        "{report:?}"
    );
    assert!(pushed(&app, old).await);
    assert!(pushes(&f.apns).is_empty());
    // 20 minutes after, it is sent.
    let recent = booking(&app, &s, s.practitioner).await;
    let report = f.push.run(&db, now + Duration::minutes(20)).await.unwrap();
    assert_eq!(
        (report.claimed, report.too_old, report.sent),
        (1, 0, 1),
        "{report:?}"
    );
    assert!(pushed(&app, recent).await);
    let sent = pushes(&f.apns);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].body["id"], recent.to_string());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_revoked_session_gets_no_push() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    // The owner's phone signs in (its own session), then another session signs the rest out.
    let phone = app.token(ALPHA_OWNER);
    let install = Uuid::now_v7();
    let (status, _) = app
        .send(
            Method::PUT,
            APP,
            &format!("/api/v1/me/devices/{install}"),
            Some(&phone),
            Some(
                json!({ "platform": "ios", "token": ios("revoked-phone"), "app": "staff",
                         "locale": "en-IN" }),
            ),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let laptop = app.token(ALPHA_OWNER);
    let (status, _) = app
        .send(
            Method::POST,
            APP,
            "/api/v1/me/sessions/revoke-others",
            Some(&laptop),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    booking(&app, &s, s.practitioner).await;
    f.push
        .run(&app.api_db(), OffsetDateTime::now_utc())
        .await
        .unwrap();
    assert!(
        pushes(&f.apns).is_empty(),
        "a revoked session's phone must not be pushed to"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn reminders_and_escalations_are_pushed_with_the_notification_id() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    register(&app, ALPHA_OWNER, "ios", "owner-phone").await;
    register(&app, s.doctor_auth, "android", "doctor-phone").await;
    let row = booking(&app, &s, s.practitioner).await;
    let always = OpenHours {
        opens: Time::MIDNIGHT,
        closes: Time::from_hms(23, 59, 59).unwrap(),
    };
    let db = app.api_db();
    let now = OffsetDateTime::now_utc();
    let first = aarogyam_notify::remind_with(&db, now + Duration::minutes(30), always, &f.push)
        .await
        .unwrap();
    assert_eq!((first.reminded, first.escalated), (1, 0));
    let reminder_kinds = |mock: &Mock| -> Vec<(String, Value)> {
        pushes(mock)
            .into_iter()
            .map(|p| {
                (
                    p.body["kind"]
                        .as_str()
                        .unwrap_or(p.body["message"]["data"]["kind"].as_str().unwrap_or(""))
                        .to_owned(),
                    p.body,
                )
            })
            .collect()
    };
    assert_eq!(reminder_kinds(&f.apns).len(), 1);
    assert_eq!(reminder_kinds(&f.apns)[0].0, "booking_reminder");
    assert_eq!(reminder_kinds(&f.fcm).len(), 1);
    assert_eq!(reminder_kinds(&f.apns)[0].1["id"], row.to_string());
    let second = aarogyam_notify::remind_with(&db, now + Duration::minutes(90), always, &f.push)
        .await
        .unwrap();
    assert_eq!((second.reminded, second.escalated), (0, 1));
    // The escalation reaches the owner's phone only.
    assert_eq!(pushes(&f.fcm).len(), 1);
    let apns = reminder_kinds(&f.apns);
    assert_eq!(apns.len(), 2);
    assert_eq!(apns[1].0, "booking_escalation");
    assert_eq!(apns[1].1["id"], row.to_string());
    assert_eq!(
        apns[1].1["aps"]["alert"]["loc-key"],
        "push.booking_escalation"
    );
    app.finish().await;
    let _ = OpenHours::DEFAULT;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_doctors_remind_is_pushed_again() {
    let app = TestApp::start().await;
    let s = scene(&app).await;
    drain_old_rows(&app).await;
    let f = fakes().await;
    register(&app, s.doctor_auth, "android", "remind-doctor").await;
    let owner = app.token(ALPHA_OWNER);
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&owner),
            Some(json!({ "full_name": "Ramesh Jadhav", "sex": "male", "age_years": 40 })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let (status, queued) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/queue",
            Some(&owner),
            Some(json!({ "patient_id": patient["id"], "practitioner_id": s.practitioner })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{queued}");
    let token = queued["id"].as_str().unwrap().to_owned();
    let db = app.api_db();
    let report = f.push.run(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!(report.sent, 1, "{report:?}");
    assert_eq!(pushes(&f.fcm).len(), 1);
    assert_eq!(
        pushes(&f.fcm)[0].body["message"]["data"]["kind"],
        "patient_waiting"
    );

    // The notification is old by now, but a Remind makes it new again: pushed once more.
    sqlx::query(
        "update aarogyam.staff_notifications set created_at = now() - interval '3 hours'
         where kind = 'patient_waiting'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/queue/{token}/remind"),
            Some(&owner),
            None,
        )
        .await;
    assert!(status.is_success(), "{body}");
    let report = f.push.run(&db, OffsetDateTime::now_utc()).await.unwrap();
    assert_eq!(
        (report.claimed, report.too_old, report.sent),
        (1, 0, 1),
        "{report:?}"
    );
    let sent = pushes(&f.fcm);
    assert_eq!(sent.len(), 2);
    assert_eq!(
        sent[0].body["message"]["data"]["id"],
        sent[1].body["message"]["data"]["id"]
    );
    app.finish().await;
}
