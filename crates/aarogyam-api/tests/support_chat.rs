//! Sakalya support under a grant never reads staff chat, what the clinic sent its patients, or
//! the patients' contact preferences: chat routes refuse it, and row-level security shows it
//! none of those rows even where a route (the patient's message list) is open to it.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{ActorKind, DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use uuid::{Uuid, uuid};

const ASHA_USER: Uuid = uuid!("01900000-0000-7000-8000-0000000000a1");
const STAFF_USER: Uuid = uuid!("01900000-0000-7000-8000-0000000000c1");

async fn ok(app: &TestApp, method: Method, path: &str, token: &str, body: Value) -> Value {
    let (status, value) = app.send(method, ALPHA, path, Some(token), Some(body)).await;
    assert!(status.is_success(), "{path}: {status} {value}");
    value
}

/// Rows of chat, patient messages, their events and contact preferences a user sees directly.
async fn visible(app: &TestApp, user: Uuid, kind: &'static str) -> [i64; 5] {
    let scope = Scope::tenant(app.clinic_id("alpha").await)
        .with_user(user)
        .with_actor_kind(ActorKind::new(kind).unwrap());
    app.api_db()
        .scoped(&scope, async |tx| {
            sqlx::query_as::<_, (i64, i64, i64, i64, i64)>(
                "select (select count(*) from aarogyam.conversations),
                        (select count(*) from aarogyam.chat_messages),
                        (select count(*) from aarogyam.messages),
                        (select count(*) from aarogyam.message_events),
                        (select count(*) from aarogyam.contact_preferences)",
            )
            .fetch_one(tx.conn())
            .await
            .map(|(a, b, c, d, e)| [a, b, c, d, e])
            .map_err(DbError::from)
        })
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one story: set up, grant, then every refusal"
)]
async fn support_never_reads_chat_patient_messages_or_contact_preferences() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let staff = app.token(STAFF);
    let arun: Uuid = sqlx::query_scalar(
        "select m.id from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
         where u.display_name = 'Arun Assistant'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let patient = ok(
        &app,
        Method::POST,
        "/api/v1/patients",
        &owner,
        json!({ "full_name": "Kavya Rao", "email": "k@example.test" }),
    )
    .await;
    let patient = patient["id"].as_str().unwrap().to_owned();
    let chat = ok(
        &app,
        Method::POST,
        "/api/v1/conversations",
        &owner,
        json!({ "kind": "direct", "membership_id": arun }),
    )
    .await;
    let chat = chat["id"].as_str().unwrap().to_owned();
    let talk = format!("/api/v1/conversations/{chat}/messages");
    let said = ok(
        &app,
        Method::POST,
        &talk,
        &owner,
        json!({ "client_id": Uuid::now_v7(), "body": "About Kavya", "patient_id": patient }),
    )
    .await;
    let said = said["id"].as_str().unwrap().to_owned();
    let note = json!({ "patient_ids": [patient], "channel": "email", "template_key": "care.note", "variables": { "subject": "Visit" }, "body": "Bring reports." });
    ok(&app, Method::POST, "/api/v1/messages", &owner, note).await;
    let prefs = json!({ "channel": "email", "category": "promotional", "opted_out": true });
    ok(
        &app,
        Method::POST,
        &format!("/api/v1/patients/{patient}/contact-preferences"),
        &owner,
        prefs,
    )
    .await;

    let ends = (OffsetDateTime::now_utc() + Duration::hours(4))
        .format(&Rfc3339)
        .unwrap();
    let grant =
        json!({ "staff_email": "staff@sakalya.test", "reason": "Help with chat", "ends_at": ends });
    ok(&app, Method::POST, "/api/v1/support-grants", &owner, grant).await;
    // The grant works: support reads patients.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&staff), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Every chat route refuses support, for reads and writes alike.
    let base = format!("/api/v1/conversations/{chat}");
    let routes = [
        (Method::GET, "/api/v1/conversations".to_owned()),
        (Method::POST, "/api/v1/conversations".to_owned()),
        (Method::GET, base.clone()),
        (Method::POST, format!("{base}/members")),
        (Method::DELETE, format!("{base}/members/{arun}")),
        (Method::POST, format!("{base}/leave")),
        (Method::PUT, format!("{base}/mute")),
        (Method::GET, talk.clone()),
        (Method::POST, talk.clone()),
        (Method::POST, format!("{base}/read")),
        (Method::DELETE, format!("{base}/messages/{said}")),
        (Method::GET, "/api/v1/me/badges".to_owned()),
    ];
    for (method, path) in routes {
        let (status, value) = app
            .send(method.clone(), ALPHA, &path, Some(&staff), Some(json!({})))
            .await;
        assert!(
            matches!(status, StatusCode::FORBIDDEN | StatusCode::NOT_FOUND),
            "{method} {path}: {status} {value}"
        );
        assert!(!value.to_string().contains("About Kavya"), "{value}");
    }

    // Decision: support reads no patient messages or contact preferences. The patient's message
    // list is open to anyone with patients.read, so the rows themselves are closed to support.
    let (status, list) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/messages"),
            Some(&staff),
            None,
        )
        .await;
    assert!(
        status == StatusCode::FORBIDDEN || list["items"].as_array().is_some_and(Vec::is_empty),
        "{status} {list}"
    );
    let owners = app.token(ALPHA_OWNER);
    let (_, list) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/messages"),
            Some(&owners),
            None,
        )
        .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1, "{list}");

    // And in the database: staff of the clinic see rows, support sees none.
    assert_eq!(visible(&app, ASHA_USER, "staff").await, [1, 1, 1, 0, 1]);
    assert_eq!(visible(&app, STAFF_USER, "support").await, [0; 5]);
    app.finish().await;
}
