//! Staff chat on a real database: direct conversations are one per pair, only active members
//! see a conversation (through the API and directly under row-level security), cursors page,
//! unread counts and badges add up, and patient references stay within reach and are logged.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{ActorKind, DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::{Uuid, uuid};

/// Users (not sign-in ids) in the test seed.
const ASHA_USER: Uuid = uuid!("01900000-0000-7000-8000-0000000000a1");
const ARUN_USER: Uuid = uuid!("01900000-0000-7000-8000-0000000000a2");
const FARAH_USER: Uuid = uuid!("01900000-0000-7000-8000-0000000000a3");

/// The membership id of the member called `name` at `host`.
async fn membership(app: &TestApp, host: &str, owner: &str, name: &str) -> String {
    let (status, staff) = app
        .send(Method::GET, host, "/api/v1/staff", Some(owner), None)
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

async fn start(app: &TestApp, token: &str, body: Value) -> (StatusCode, String) {
    let (status, value) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/conversations",
            Some(token),
            Some(body),
        )
        .await;
    (status, value["id"].as_str().unwrap_or_default().to_owned())
}

async fn post(app: &TestApp, token: &str, conversation: &str, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        ALPHA,
        &format!("/api/v1/conversations/{conversation}/messages"),
        Some(token),
        Some(body),
    )
    .await
}

async fn say(app: &TestApp, token: &str, conversation: &str, text: &str) -> String {
    let body = json!({ "client_id": Uuid::now_v7(), "body": text });
    let (status, message) = post(app, token, conversation, body).await;
    assert_eq!(status, StatusCode::CREATED, "{message}");
    message["id"].as_str().unwrap().to_owned()
}

async fn get(app: &TestApp, token: &str, uri: &str) -> (StatusCode, Value) {
    app.send(Method::GET, ALPHA, uri, Some(token), None).await
}

fn ids(page: &Value) -> Vec<String> {
    page["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

/// Rows of each chat table a user sees directly, under row-level security, as staff.
async fn visible(app: &TestApp, user: Uuid) -> [i64; 3] {
    let alpha = app.clinic_id("alpha").await;
    let scope = Scope::tenant(alpha)
        .with_user(user)
        .with_actor_kind(ActorKind::new("staff").unwrap());
    app.api_db()
        .scoped(&scope, async |tx| {
            sqlx::query_as::<_, (i64, i64, i64)>(
                "select (select count(*) from aarogyam.conversations),
                        (select count(*) from aarogyam.conversation_members),
                        (select count(*) from aarogyam.chat_messages)",
            )
            .fetch_one(tx.conn())
            .await
            .map(|(a, b, c)| [a, b, c])
            .map_err(DbError::from)
        })
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_direct_conversation_is_one_per_pair_and_private() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun = app.token(ALPHA_ASSISTANT);
    let farah = app.token(ALPHA_FRONT_DESK);
    let arun_id = membership(&app, ALPHA, &owner, "Arun Assistant").await;
    let asha_id = membership(&app, ALPHA, &owner, "Asha Owner").await;

    let direct = |with: &str| json!({ "kind": "direct", "membership_id": with });
    let (status, id) = start(&app, &owner, direct(&arun_id)).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(
        start(&app, &owner, direct(&arun_id)).await,
        (StatusCode::OK, id.clone())
    );
    // From the other side too.
    assert_eq!(
        start(&app, &arun, direct(&asha_id)).await,
        (StatusCode::OK, id.clone())
    );
    assert_eq!(
        start(&app, &owner, direct(&asha_id)).await.0,
        StatusCode::BAD_REQUEST
    );
    let beta_owner = membership(&app, BETA, &app.token(BETA_OWNER), "Bina Owner").await;
    assert_eq!(
        start(&app, &owner, direct(&beta_owner)).await.0,
        StatusCode::NOT_FOUND
    );
    let message = say(&app, &owner, &id, "Is chair 2 free at 4?").await;

    let (_, list) = get(&app, &arun, "/api/v1/conversations").await;
    assert_eq!(ids(&list), std::slice::from_ref(&id));
    assert_eq!(list["items"][0]["with"]["name"], "Asha Owner");
    assert_eq!(list["items"][0]["unread"], 1);
    assert_eq!(list["items"][0]["last_message_id"], message.as_str());

    // Someone else at the clinic gets nothing.
    let (_, theirs) = get(&app, &farah, "/api/v1/conversations").await;
    assert_eq!(ids(&theirs), Vec::<String>::new());
    let paths = [
        format!("/api/v1/conversations/{id}"),
        format!("/api/v1/conversations/{id}/messages"),
    ];
    for path in &paths {
        assert_eq!(
            get(&app, &farah, path).await.0,
            StatusCode::NOT_FOUND,
            "{path}"
        );
        let (status, _) = app
            .send(Method::GET, BETA, path, Some(&app.token(BETA_OWNER)), None)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path} from Beta");
    }
    let hello = json!({ "client_id": Uuid::now_v7(), "body": "hello" });
    assert_eq!(
        post(&app, &farah, &id, hello.clone()).await.0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &format!("/api/v1/conversations/{id}/messages"),
            Some(&app.token(BETA_OWNER)),
            Some(hello),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let read = json!({ "message_id": message });
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/conversations/{id}/read"),
            Some(&farah),
            Some(read),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(visible(&app, FARAH_USER).await, [0, 0, 0]);
    assert_eq!(visible(&app, ARUN_USER).await, [1, 2, 1]);

    // Without chat.use: refused before anything is read.
    let nothing = app.token(ALPHA_NOTHING);
    for path in ["/api/v1/conversations", "/api/v1/me/badges"] {
        assert_eq!(
            get(&app, &nothing, path).await.0,
            StatusCode::FORBIDDEN,
            "{path}"
        );
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn cursors_page_and_unread_counts_add_up() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun = app.token(ALPHA_ASSISTANT);
    let arun_id = membership(&app, ALPHA, &owner, "Arun Assistant").await;
    let (_, id) = start(
        &app,
        &owner,
        json!({ "kind": "direct", "membership_id": arun_id }),
    )
    .await;
    let mut sent = Vec::new();
    for n in 1..=5 {
        sent.push(say(&app, &owner, &id, &format!("Message {n}")).await);
    }
    let messages = format!("/api/v1/conversations/{id}/messages");

    let (_, newest) = get(&app, &arun, &format!("{messages}?limit=2")).await;
    assert_eq!(ids(&newest), sent[3..]);
    let (_, older) = get(
        &app,
        &arun,
        &format!("{messages}?limit=2&before={}", sent[3]),
    )
    .await;
    assert_eq!(ids(&older), sent[1..3]);
    let (_, newer) = get(&app, &arun, &format!("{messages}?after={}", sent[2])).await;
    assert_eq!(ids(&newer), sent[3..]);
    let (_, none) = get(&app, &arun, &format!("{messages}?after={}", sent[4])).await;
    assert_eq!(ids(&none), Vec::<String>::new());
    let both = format!("{messages}?after={}&before={}", sent[0], sent[4]);
    assert_eq!(get(&app, &arun, &both).await.0, StatusCode::BAD_REQUEST);
    assert_eq!(newest["items"][1]["body"], "Message 5");

    let unread = async |token: &str| {
        let (_, list) = get(&app, token, "/api/v1/conversations").await;
        let (_, badges) = get(&app, token, "/api/v1/me/badges").await;
        (
            list["items"][0]["unread"].as_i64().unwrap(),
            badges["chat_unread"].as_i64().unwrap(),
        )
    };
    assert_eq!(unread(&arun).await, (5, 5));
    // One's own messages are never unread.
    assert_eq!(unread(&owner).await, (0, 0));
    let read_up_to = async |message: &str| {
        app.send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/conversations/{id}/read"),
            Some(&arun),
            Some(json!({ "message_id": message })),
        )
        .await
        .0
    };
    assert_eq!(read_up_to(&sent[2]).await, StatusCode::NO_CONTENT);
    assert_eq!(unread(&arun).await, (2, 2));
    // The pointer never moves back.
    assert_eq!(read_up_to(&sent[0]).await, StatusCode::NO_CONTENT);
    assert_eq!(unread(&arun).await, (2, 2));
    let mute = |muted: bool| json!({ "muted": muted });
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/conversations/{id}/mute"),
            Some(&arun),
            Some(mute(true)),
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(unread(&arun).await, (2, 0));
    assert_eq!(read_up_to(&sent[4]).await, StatusCode::NO_CONTENT);
    assert_eq!(unread(&arun).await.0, 0);
    assert_eq!(
        read_up_to(&Uuid::now_v7().to_string()).await,
        StatusCode::NOT_FOUND
    );

    // The badge carries the bell's number too, the same as GET /notifications/count.
    let (_, badges) = get(&app, &owner, "/api/v1/me/badges").await;
    let (_, bell) = get(&app, &owner, "/api/v1/notifications/count").await;
    assert_eq!(badges["notifications_unread"], bell["unread"]);

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn leavers_removed_and_deactivated_members_lose_access() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun = app.token(ALPHA_ASSISTANT);
    let farah = app.token(ALPHA_FRONT_DESK);
    let arun_id = membership(&app, ALPHA, &owner, "Arun Assistant").await;
    let farah_id = membership(&app, ALPHA, &owner, "Farah Desk").await;
    let group = json!({ "kind": "group", "title": " Front desk ", "member_ids": [arun_id] });
    let (status, id) = start(&app, &owner, group).await;
    assert_eq!(status, StatusCode::CREATED);
    let members = format!("/api/v1/conversations/{id}/members");
    let add = |who: &str| Some(json!({ "membership_ids": [who] }));
    // Only an admin adds people.
    let (status, _) = app
        .send(Method::POST, ALPHA, &members, Some(&arun), add(&farah_id))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, added) = app
        .send(Method::POST, ALPHA, &members, Some(&owner), add(&farah_id))
        .await;
    assert_eq!((status, added["added"].as_i64()), (StatusCode::OK, Some(1)));
    let (_, detail) = get(&app, &farah, &format!("/api/v1/conversations/{id}")).await;
    assert_eq!(detail["title"], "Front desk");
    assert_eq!(detail["members"].as_array().unwrap().len(), 3);
    say(&app, &owner, &id, "Lunch at 2").await;

    // Farah leaves: the group is gone for her, through the API and directly.
    let leave = format!("/api/v1/conversations/{id}/leave");
    let (status, _) = app
        .send(Method::POST, ALPHA, &leave, Some(&farah), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let messages = format!("/api/v1/conversations/{id}/messages");
    assert_eq!(get(&app, &farah, &messages).await.0, StatusCode::NOT_FOUND);
    assert_eq!(visible(&app, FARAH_USER).await, [0, 0, 0]);
    let hello = json!({ "client_id": Uuid::now_v7(), "body": "Still here?" });
    assert_eq!(
        post(&app, &farah, &id, hello).await.0,
        StatusCode::NOT_FOUND
    );

    // The owner removes Arun; he loses it too.
    let remove = format!("{members}/{arun_id}");
    let (status, _) = app
        .send(Method::DELETE, ALPHA, &remove, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(get(&app, &arun, &messages).await.0, StatusCode::NOT_FOUND);
    // Added back, he joins again as a member.
    let (status, _) = app
        .send(Method::POST, ALPHA, &members, Some(&owner), add(&arun_id))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(get(&app, &arun, &messages).await.0, StatusCode::OK);
    // The owner, the last admin, leaves: Arun takes over.
    let (status, _) = app
        .send(Method::POST, ALPHA, &leave, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, detail) = get(&app, &arun, &format!("/api/v1/conversations/{id}")).await;
    assert_eq!(detail["members"][0]["role"], "admin", "{detail}");
    assert_eq!(visible(&app, ASHA_USER).await[0], 0);

    // A direct conversation can't be left; a deactivated member loses it all the same.
    let (_, direct) = start(
        &app,
        &arun,
        json!({ "kind": "direct", "membership_id": farah_id }),
    )
    .await;
    let direct_leave = format!("/api/v1/conversations/{direct}/leave");
    let (status, _) = app
        .send(Method::POST, ALPHA, &direct_leave, Some(&farah), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    say(&app, &arun, &direct, "See you tomorrow").await;
    assert_eq!(visible(&app, FARAH_USER).await, [1, 2, 1]);
    sqlx::query("update aarogyam.memberships set status = 'suspended' where id = $1::uuid")
        .bind(&farah_id)
        .execute(&app.owner)
        .await
        .unwrap();
    let direct_messages = format!("/api/v1/conversations/{direct}/messages");
    assert_eq!(
        get(&app, &farah, &direct_messages).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(visible(&app, FARAH_USER).await, [0, 0, 0]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patient_references_stay_in_reach_and_reading_them_is_recorded() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun = app.token(ALPHA_ASSISTANT);
    let arun_id = membership(&app, ALPHA, &owner, "Arun Assistant").await;
    let (_, id) = start(
        &app,
        &owner,
        json!({ "kind": "direct", "membership_id": arun_id }),
    )
    .await;
    let patient_body =
        json!({ "full_name": "Ravi Kumar", "age_years": 40, "phone": "+919876543210" });
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&owner),
            Some(patient_body.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let patient = patient["id"].as_str().unwrap().to_owned();
    let (_, theirs) = app
        .send(
            Method::POST,
            BETA,
            "/api/v1/patients",
            Some(&app.token(BETA_OWNER)),
            Some(patient_body),
        )
        .await;

    let about = |who: &str| json!({ "client_id": Uuid::now_v7(), "body": "Crown ready?", "patient_id": who });
    let (status, message) = post(&app, &owner, &id, about(&patient)).await;
    assert_eq!(status, StatusCode::CREATED, "{message}");
    // Another clinic's patient is out of anyone's reach here.
    let beta_patient = theirs["id"].as_str().unwrap();
    assert_eq!(
        post(&app, &owner, &id, about(beta_patient)).await.0,
        StatusCode::NOT_FOUND
    );
    say(&app, &owner, &id, "And lunch?").await;

    let logged = async || {
        sqlx::query_scalar::<_, i64>(
            "select count(*) from audit.access_log where resource = 'chat' and resource_id = $1::uuid",
        )
        .bind(&id)
        .fetch_one(&app.owner)
        .await
        .unwrap()
    };
    let messages = format!("/api/v1/conversations/{id}/messages");
    assert_eq!(logged().await, 0);
    let (_, page) = get(&app, &arun, &messages).await;
    assert_eq!(page["items"][0]["patient_id"], patient.as_str());
    get(&app, &arun, &messages).await;
    // Once per reader, patient, conversation and day.
    assert_eq!(logged().await, 1);
    get(&app, &owner, &messages).await;
    assert_eq!(logged().await, 2);

    // Only the author deletes; the text and patient go, the message stays as deleted.
    let message_id = message["id"].as_str().unwrap();
    let one = format!("{messages}/{message_id}");
    let (status, _) = app
        .send(Method::DELETE, ALPHA, &one, Some(&arun), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    for _ in 0..2 {
        let (status, _) = app
            .send(Method::DELETE, ALPHA, &one, Some(&owner), None)
            .await;
        assert_eq!(status, StatusCode::NO_CONTENT);
    }
    let (_, page) = get(&app, &arun, &messages).await;
    let deleted = &page["items"][0];
    assert_eq!(
        (deleted["deleted"].as_bool(), &deleted["body"]),
        (Some(true), &Value::Null)
    );
    assert_eq!(deleted["patient_id"], Value::Null);

    // The change history never holds the text.
    let history: Vec<String> = sqlx::query_scalar(
        "select coalesce(changes::text, '') from audit.audit_events where table_name = 'aarogyam.chat_messages'",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert!(history.len() >= 2, "{history:?}");
    assert!(
        history.iter().all(|row| !row.contains("Crown")),
        "{history:?}"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn posting_is_idempotent_and_checked() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun_id = membership(&app, ALPHA, &owner, "Arun Assistant").await;
    let (_, id) = start(
        &app,
        &owner,
        json!({ "kind": "direct", "membership_id": arun_id }),
    )
    .await;
    // A retried post returns the first message; the same key with other text is refused.
    let key = Uuid::now_v7();
    let first = post(
        &app,
        &owner,
        &id,
        json!({ "client_id": key, "body": "Once" }),
    )
    .await;
    assert_eq!(first.0, StatusCode::CREATED);
    let again = post(
        &app,
        &owner,
        &id,
        json!({ "client_id": key, "body": "Once" }),
    )
    .await;
    assert_eq!((again.0, &again.1["id"]), (StatusCode::OK, &first.1["id"]));
    let other = post(
        &app,
        &owner,
        &id,
        json!({ "client_id": key, "body": "Twice" }),
    )
    .await;
    assert_eq!(other.0, StatusCode::CONFLICT);
    for bad in ["", "   ", &"x".repeat(4001)] {
        let body = json!({ "client_id": Uuid::now_v7(), "body": bad });
        assert_eq!(
            post(&app, &owner, &id, body).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_access_record_keeps_every_earlier_resource_and_adds_chat() {
    let app = TestApp::start().await;
    let rule: String = sqlx::query_scalar(
        "select pg_get_constraintdef(oid) from pg_constraint
         where conname = 'access_log_resource_check'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    for resource in [
        "chart",
        "visit",
        "note",
        "attachment",
        "prescription",
        "invoice",
        "export",
        "appointment",
        "chat",
    ] {
        assert!(
            rule.contains(&format!("'{resource}'")),
            "{resource}: {rule}"
        );
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_chat_with_someone_who_cannot_use_chat_is_refused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let nikhil = membership(&app, ALPHA, &owner, "Nikhil Nothing").await;
    let arun = membership(&app, ALPHA, &owner, "Arun Assistant").await;
    let (status, _) = start(
        &app,
        &owner,
        json!({ "kind": "direct", "membership_id": nikhil }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let group = json!({ "kind": "group", "title": "Team", "member_ids": [arun, nikhil] });
    assert_eq!(start(&app, &owner, group).await.0, StatusCode::FORBIDDEN);
    let (status, id) = start(
        &app,
        &owner,
        json!({ "kind": "group", "title": "Team", "member_ids": [arun] }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/conversations/{id}/members"),
            Some(&owner),
            Some(json!({ "membership_ids": [nikhil] })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_group_holds_at_most_100_members_in_the_database() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    // 99 more people: with the owner they fill a group of 100.
    sqlx::query(
        "with u as (insert into aarogyam.users (auth_uid, display_name, email)
                    select gen_random_uuid(), 'Extra ' || n, 'extra' || n || '@alpha.test'
                    from generate_series(1, 99) n returning id)
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, u.id, r.id, 'active'
         from aarogyam.organizations o, u, aarogyam.roles r
         where o.slug = 'alpha' and r.org_id = o.id and r.key = 'doctor'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let all: Vec<Uuid> = sqlx::query_scalar(
        "select m.id from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
         where u.display_name like 'Extra %' order by u.display_name",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(all.len(), 99);
    let first = &all;
    let group = json!({ "kind": "group", "title": "Everyone", "member_ids": first });
    let (status, id) = start(&app, &owner, group).await;
    assert_eq!(status, StatusCode::CREATED, "owner plus 99 makes 100");
    // One more is refused by the API's add and by the table itself.
    let arun = membership(&app, ALPHA, &owner, "Arun Assistant").await;
    let (status, value) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/conversations/{id}/members"),
            Some(&owner),
            Some(json!({ "membership_ids": [arun] })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{value}");
    let direct = sqlx::query(
        "insert into aarogyam.conversation_members (org_id, conversation_id, membership_id)
         select org_id, $1::uuid, $2::uuid from aarogyam.conversations where id = $1::uuid",
    )
    .bind(&id)
    .bind(arun.parse::<Uuid>().unwrap())
    .execute(&app.owner)
    .await;
    assert!(
        direct.is_err(),
        "the 101st member is refused by the database"
    );
    // Someone leaving makes room.
    sqlx::query("update aarogyam.conversation_members set left_at = now() where conversation_id = $1::uuid and membership_id = $2")
        .bind(&id)
        .bind(first[0])
        .execute(&app.owner)
        .await
        .unwrap();
    let (status, value) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/conversations/{id}/members"),
            Some(&owner),
            Some(json!({ "membership_ids": [arun] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    app.finish().await;
}
