//! Who sees the staff-operations notifications (tasks, time off, stock) on a real database: an
//! audience matrix per kind, only the newest step of a task in the feed and the count, and the
//! clinic wall. The older kinds are covered by `notifications.rs`, which stays as it was.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn membership(app: &TestApp, clinic: Uuid, auth_uid: Uuid) -> Uuid {
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

async fn role(app: &TestApp, clinic: Uuid, key: &str) -> Uuid {
    sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = $2")
        .bind(clinic)
        .bind(key)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

/// A second member of `role_key`, signed in.
async fn another_member(app: &TestApp, clinic: Uuid, role_key: &str) -> String {
    let auth_uid = Uuid::new_v4();
    let user: Uuid = sqlx::query_scalar(
        "insert into aarogyam.users (auth_uid, display_name, email) values ($1, 'Extra Member', $2)
         returning id",
    )
    .bind(auth_uid)
    .bind(format!("{auth_uid}@alpha.test"))
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let role_id = role(app, clinic, role_key).await;
    sqlx::query(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         values ($1, $2, $3, 'active')",
    )
    .bind(clinic)
    .bind(user)
    .bind(role_id)
    .execute(&app.owner)
    .await
    .unwrap();
    app.token(auth_uid)
}

/// A task occurrence for `role_id` or `member`, as the generator makes one.
async fn occurrence(
    app: &TestApp,
    clinic: Uuid,
    owner: &str,
    role_id: Option<Uuid>,
    member: Option<Uuid>,
) -> Uuid {
    let (status, task) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/tasks",
            Some(owner),
            Some(json!({
                "title": "Close up",
                "assignee_role_id": role_id.filter(|_| member.is_none()),
                "assignee_membership_id": member,
                "action": "none",
                "schedule": { "kind": "daily", "due_time": "19:45" }
            })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    let template: Uuid = task["id"].as_str().unwrap().parse().unwrap();
    let due = OffsetDateTime::now_utc() - Duration::hours(1);
    sqlx::query_scalar(
        "insert into aarogyam.task_occurrences
           (org_id, template_id, title, action, assignee_membership_id, assignee_role_id,
            local_date, due_at)
         values ($1, $2, 'Close up', 'none', $3, $4,
                 (select ($5 at time zone o.timezone)::date from aarogyam.organizations o
                  where o.id = $1), $5) returning id",
    )
    .bind(clinic)
    .bind(template)
    .bind(member)
    .bind(role_id.filter(|_| member.is_none()))
    .bind(due)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

/// One step of a task, written the way the reminder job writes it.
async fn step(app: &TestApp, clinic: Uuid, occurrence: Uuid, kind: &str, step_no: i32) -> Uuid {
    sqlx::query_scalar(
        "insert into aarogyam.staff_notifications (org_id, kind, task_occurrence_id, step_no, href)
         values ($1, $2, $3, $4, '/today') returning id",
    )
    .bind(clinic)
    .bind(kind)
    .bind(occurrence)
    .bind(step_no)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn time_off(app: &TestApp, clinic: Uuid, requester: Uuid, kind: &str) -> Uuid {
    let request: Uuid = sqlx::query_scalar(
        "insert into aarogyam.time_off_requests
           (org_id, membership_id, kind, starts_at, ends_at, reason)
         values ($1, $2, 'vacation', now() + interval '2 days', now() + interval '4 days',
                 'Family wedding in Pune') returning id",
    )
    .bind(clinic)
    .bind(requester)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    sqlx::query(
        "insert into aarogyam.staff_notifications (org_id, kind, time_off_request_id, href)
         values ($1, $2, $3, '/time-off')",
    )
    .bind(clinic)
    .bind(kind)
    .bind(request)
    .execute(&app.owner)
    .await
    .unwrap();
    request
}

async fn stock_alert(app: &TestApp, clinic: Uuid, name: &str) -> (Uuid, Uuid) {
    let item: Uuid = sqlx::query_scalar(
        "insert into aarogyam.inventory_items (org_id, name) values ($1, $2) returning id",
    )
    .bind(clinic)
    .bind(name)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let notification: Uuid = sqlx::query_scalar(
        "insert into aarogyam.staff_notifications
           (org_id, kind, inventory_item_id, alert_on, stock_on_hand, stock_days_cover,
            stock_reason, href)
         values ($1, 'stock_alert', $2, current_date, 4, 3.5, 'low', '/stock') returning id",
    )
    .bind(clinic)
    .bind(item)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    (item, notification)
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> Value {
    let (status, body) = app.send(Method::GET, host, path, Some(token), None).await;
    assert_eq!(status, StatusCode::OK, "GET {path}: {body}");
    body
}

async fn feed(app: &TestApp, token: &str) -> Vec<Value> {
    get(app, ALPHA, token, "/api/v1/notifications").await["items"]
        .as_array()
        .unwrap()
        .clone()
}

async fn count(app: &TestApp, token: &str) -> i64 {
    get(app, ALPHA, token, "/api/v1/notifications/count").await["unread"]
        .as_i64()
        .unwrap()
}

async fn badge(app: &TestApp, token: &str) -> i64 {
    get(app, ALPHA, token, "/api/v1/me/badges").await["notifications_unread"]
        .as_i64()
        .unwrap()
}

fn kinds(items: &[Value]) -> BTreeSet<String> {
    items
        .iter()
        .map(|item| item["kind"].as_str().unwrap().to_owned())
        .collect()
}

fn set(names: &[&str]) -> BTreeSet<String> {
    names.iter().map(|name| (*name).to_owned()).collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one matrix read top to bottom")]
async fn each_kind_reaches_only_its_audience() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let nothing = app.token(ALPHA_NOTHING);
    let desk_two = another_member(&app, clinic, "front_desk").await;
    let finance = another_member(&app, clinic, "finance").await;
    let desk_role = role(&app, clinic, "front_desk").await;
    let assistant_member = membership(&app, clinic, ALPHA_ASSISTANT).await;
    let owner_member = membership(&app, clinic, ALPHA_OWNER).await;

    // A task for the front-desk role, a task for the assistant alone, and an escalated one.
    let for_role = occurrence(&app, clinic, &owner, Some(desk_role), None).await;
    step(&app, clinic, for_role, "task_due", 0).await;
    let for_member = occurrence(&app, clinic, &owner, None, Some(assistant_member)).await;
    step(&app, clinic, for_member, "task_due", 0).await;
    step(&app, clinic, for_member, "task_reminder", 1).await;
    let escalated = occurrence(&app, clinic, &owner, Some(desk_role), None).await;
    step(&app, clinic, escalated, "task_escalated", 1).await;
    // The assistant asked for time off; the owner decided it.
    time_off(&app, clinic, assistant_member, "time_off_requested").await;
    time_off(&app, clinic, assistant_member, "time_off_decided").await;
    // Someone else's request: its decision is not the assistant's.
    time_off(&app, clinic, owner_member, "time_off_decided").await;
    stock_alert(&app, clinic, "Composite resin A2").await;

    let ops = |items: &[Value]| -> BTreeSet<String> {
        kinds(items)
            .into_iter()
            .filter(|kind| {
                kind.starts_with("task_")
                    || kind.starts_with("time_off_")
                    || kind.as_str() == "stock_alert"
            })
            .collect()
    };
    // The role task reaches everyone in the role, not the owner, who sees escalations.
    let owner_feed = feed(&app, &owner).await;
    assert_eq!(
        ops(&owner_feed),
        set(&[
            "task_escalated",
            "time_off_requested",
            "time_off_decided",
            "stock_alert"
        ])
    );
    // The owner is the requester of one decision and not of the other.
    assert_eq!(
        owner_feed
            .iter()
            .filter(|item| item["kind"] == "time_off_decided")
            .count(),
        1
    );
    for (who, token) in [("desk", &desk), ("second desk", &desk_two)] {
        let items = feed(&app, token).await;
        assert_eq!(ops(&items), set(&["task_due", "stock_alert"]), "{who}");
        assert_eq!(
            items
                .iter()
                .filter(|item| item["kind"] == "task_due")
                .count(),
            1,
            "{who}: the assistant's own task is theirs alone"
        );
    }
    let assistant_feed = feed(&app, &assistant).await;
    assert_eq!(
        ops(&assistant_feed),
        set(&["task_reminder", "time_off_decided", "stock_alert"])
    );
    // Their own task: only the newest step, the reminder; the role task is not theirs.
    assert_eq!(
        assistant_feed
            .iter()
            .filter(|item| item["kind"] == "task_due")
            .count(),
        0
    );
    // Finance holds tasks.use but no inventory.read and no time_off.manage; nothing assigned.
    assert_eq!(ops(&feed(&app, &finance).await), set(&[]));
    // A role with nothing gets nothing, as before.
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/notifications",
            Some(&nothing),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The bell and the badge count what the feed lists, for every audience.
    for (who, token) in [
        ("owner", &owner),
        ("desk", &desk),
        ("second desk", &desk_two),
        ("assistant", &assistant),
        ("finance", &finance),
    ] {
        let listed = i64::try_from(feed(&app, token).await.len()).unwrap();
        assert_eq!(count(&app, token).await, listed, "{who}: bell");
        assert_eq!(badge(&app, token).await, listed, "{who}: badge");
    }

    // What the items carry: ids and titles, no person and no reason.
    let task = owner_feed
        .iter()
        .find(|item| item["kind"] == "task_escalated")
        .unwrap();
    assert_eq!(task["task_occurrence_id"], escalated.to_string());
    assert_eq!(task["title"], "Close up");
    assert!(task["due_at"].is_string());
    assert_eq!(task["href"], "/today");
    let stock = owner_feed
        .iter()
        .find(|item| item["kind"] == "stock_alert")
        .unwrap();
    assert_eq!(stock["item_name"], "Composite resin A2");
    assert!(stock["item_id"].is_string());
    assert!((stock["days_cover"].as_f64().unwrap() - 3.5).abs() < 1e-9);
    let leave = owner_feed
        .iter()
        .find(|item| item["kind"] == "time_off_requested")
        .unwrap();
    assert!(leave["time_off_request_id"].is_string());
    let text = serde_json::to_string(&owner_feed).unwrap();
    assert!(!text.contains("Family wedding"), "the reason stays private");
    assert!(
        !text.contains("Asha") && !text.contains("Arun"),
        "no names: {text}"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_task_shows_only_its_newest_step_in_the_feed_and_the_count() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let desk_role = role(&app, clinic, "front_desk").await;
    let occ = occurrence(&app, clinic, &owner, Some(desk_role), None).await;
    step(&app, clinic, occ, "task_due", 0).await;
    step(&app, clinic, occ, "task_reminder", 1).await;
    step(&app, clinic, occ, "task_reminder", 2).await;
    // The escalation takes the step of the last reminder and outranks it, for the owners.
    step(&app, clinic, occ, "task_escalated", 2).await;

    let desk_items = feed(&app, &desk).await;
    assert_eq!(kinds(&desk_items), set(&["task_reminder"]));
    assert_eq!(desk_items.len(), 1, "one row, the newest step they can see");
    assert_eq!(count(&app, &desk).await, 1);
    assert_eq!(badge(&app, &desk).await, 1);
    let owner_items = feed(&app, &owner).await;
    assert_eq!(kinds(&owner_items), set(&["task_escalated"]));
    assert_eq!(owner_items.len(), 1);
    assert_eq!(count(&app, &owner).await, 1);

    // Reading the newest step clears the bell; the next reminder is new again.
    let newest = desk_items[0]["id"].as_str().unwrap().to_owned();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/notifications/{newest}/read"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(count(&app, &desk).await, 0);
    step(&app, clinic, occ, "task_reminder", 3).await;
    assert_eq!(count(&app, &desk).await, 1);
    let desk_items = feed(&app, &desk).await;
    assert_eq!(desk_items.len(), 1);
    assert_eq!(desk_items[0]["read"], false);
    // The owners' newest step is still the escalation: the reminder is not theirs.
    assert_eq!(kinds(&feed(&app, &owner).await), set(&["task_escalated"]));
    assert_eq!(count(&app, &owner).await, 1);

    // Unread-only paging agrees.
    let unread = get(&app, ALPHA, &desk, "/api/v1/notifications?unread_only=true").await;
    assert_eq!(unread["items"].as_array().unwrap().len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_ops_notifications_stay_in_their_clinic() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let beta = app.clinic_id("beta").await;
    let alpha_owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    let (_, alpha_alert) = stock_alert(&app, alpha, "Alpha gloves").await;
    let (_, beta_alert) = stock_alert(&app, beta, "Beta gloves").await;
    let beta_owner_member = membership(&app, beta, BETA_OWNER).await;
    time_off(&app, beta, beta_owner_member, "time_off_requested").await;

    let alpha_items = feed(&app, &alpha_owner).await;
    assert_eq!(kinds(&alpha_items), set(&["stock_alert"]));
    assert_eq!(alpha_items[0]["item_name"], "Alpha gloves");
    assert_eq!(count(&app, &alpha_owner).await, 1);
    let beta_items = get(&app, BETA, &beta_owner, "/api/v1/notifications").await;
    assert_eq!(
        kinds(beta_items["items"].as_array().unwrap()),
        set(&["stock_alert", "time_off_requested"])
    );
    // Another clinic's notification is not there to read.
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/notifications/{beta_alert}/read"),
            Some(&alpha_owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/notifications/{alpha_alert}/read"),
            Some(&alpha_owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    app.finish().await;
}
