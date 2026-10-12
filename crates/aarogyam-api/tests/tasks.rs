//! Recurring staff tasks on a real database: who may call what, the role-shared completion,
//! materials used when finishing, the standard tasks, the preview against the generator, the
//! photo count, and that none of it crosses clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_dal::task_jobs::{materialize, seed_defaults};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn call(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

async fn alpha_id(app: &TestApp) -> Uuid {
    app.clinic_id("alpha").await
}

async fn member(app: &TestApp, clinic: Uuid, auth_uid: Uuid) -> Uuid {
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

/// A second member in `role_key`, with a token of their own.
async fn another_member(app: &TestApp, clinic: Uuid, role_key: &str) -> String {
    let auth_uid = Uuid::new_v4();
    let user: Uuid = sqlx::query_scalar(
        "insert into aarogyam.users (auth_uid, display_name, email) values ($1, 'Second Desk', $2)
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

/// An occurrence made the way the generator makes one, due `hours_ago` hours ago.
async fn occurrence(
    app: &TestApp,
    clinic: Uuid,
    template: Uuid,
    role_id: Option<Uuid>,
    membership: Option<Uuid>,
    action: &str,
) -> Uuid {
    let due = OffsetDateTime::now_utc() - Duration::hours(1);
    sqlx::query_scalar(
        "insert into aarogyam.task_occurrences
           (org_id, template_id, title, action, assignee_membership_id, assignee_role_id,
            local_date, due_at)
         values ($1, $2, 'Close up', $3, $4, $5,
                 (select ($6 at time zone o.timezone)::date from aarogyam.organizations o
                  where o.id = $1), $6) returning id",
    )
    .bind(clinic)
    .bind(template)
    .bind(action)
    .bind(membership)
    .bind(role_id)
    .bind(due)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn make_task(app: &TestApp, token: &str, body: Value) -> Value {
    let (status, task) = call(app, Method::POST, ALPHA, "/api/v1/tasks", token, Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{task}");
    task
}

fn daily(title: &str, role_id: Uuid, action: &str) -> Value {
    json!({
        "title": title,
        "assignee_role_id": role_id,
        "action": action,
        "schedule": { "kind": "daily", "due_time": "19:45" }
    })
}

fn tid(task: &Value) -> Uuid {
    task["id"].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one matrix read top to bottom")]
async fn permissions_and_clinic_walls() {
    let app = TestApp::start().await;
    let clinic = alpha_id(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let nothing = app.token(ALPHA_NOTHING);
    let beta_owner = app.token(BETA_OWNER);
    let desk_role = role(&app, clinic, "front_desk").await;
    let task = make_task(&app, &owner, daily("Lock up", desk_role, "none")).await;
    let template = tid(&task);
    let occ = occurrence(&app, clinic, template, Some(desk_role), None, "none").await;

    let id = template.to_string();
    let oid = occ.to_string();
    let manage: Vec<(Method, String, Option<Value>)> = vec![
        (Method::GET, "/api/v1/tasks".into(), None),
        (
            Method::POST,
            "/api/v1/tasks".into(),
            Some(daily("Another", desk_role, "none")),
        ),
        (Method::GET, format!("/api/v1/tasks/{id}"), None),
        (
            Method::PATCH,
            format!("/api/v1/tasks/{id}"),
            Some(json!({ "title": "Lock up well" })),
        ),
        (Method::GET, format!("/api/v1/tasks/{id}/preview"), None),
        (Method::GET, "/api/v1/tasks/history".into(), None),
        (
            Method::POST,
            format!("/api/v1/tasks/occurrences/{oid}/reopen"),
            None,
        ),
    ];
    for (method, path, body) in &manage {
        for (who, token) in [
            ("assistant", &assistant),
            ("front desk", &desk),
            ("nothing", &nothing),
        ] {
            let (status, value) =
                call(&app, method.clone(), ALPHA, path, token, body.clone()).await;
            assert_eq!(
                status,
                StatusCode::FORBIDDEN,
                "{who} {method} {path}: {value}"
            );
        }
        let (status, value) = call(&app, method.clone(), ALPHA, path, &owner, body.clone()).await;
        assert!(
            status.is_success(),
            "owner {method} {path}: {status} {value}"
        );
    }
    // Delete last: the owner may, the others may not.
    let (status, _) = call(
        &app,
        Method::DELETE,
        ALPHA,
        &format!("/api/v1/tasks/{id}"),
        &desk,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // tasks.use: everyone but the role with nothing.
    for (who, token, expected) in [
        ("owner", &owner, StatusCode::OK),
        ("assistant", &assistant, StatusCode::OK),
        ("front desk", &desk, StatusCode::OK),
        ("nothing", &nothing, StatusCode::FORBIDDEN),
    ] {
        let (status, value) =
            call(&app, Method::GET, ALPHA, "/api/v1/tasks/mine", token, None).await;
        assert_eq!(status, expected, "{who}: {value}");
    }
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/tasks/occurrences/{oid}/complete"),
        &nothing,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic's member is not a member here, and our ids do not exist there.
    for (method, path, body) in &manage {
        let (status, _) = call(&app, method.clone(), ALPHA, path, &beta_owner, body.clone()).await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "{method} {path} as a stranger"
        );
    }
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/tasks/mine",
        &beta_owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let foreign: Vec<(Method, String, Option<Value>)> = vec![
        (Method::GET, format!("/api/v1/tasks/{id}"), None),
        (
            Method::PATCH,
            format!("/api/v1/tasks/{id}"),
            Some(json!({ "active": false })),
        ),
        (Method::DELETE, format!("/api/v1/tasks/{id}"), None),
        (Method::GET, format!("/api/v1/tasks/{id}/preview"), None),
        (
            Method::POST,
            format!("/api/v1/tasks/occurrences/{oid}/reopen"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/tasks/occurrences/{oid}/complete"),
            Some(json!({})),
        ),
    ];
    for (method, path, body) in foreign {
        let (status, value) = call(&app, method.clone(), BETA, &path, &beta_owner, body).await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "{method} {path} in beta: {value}"
        );
    }
    // Beta's list holds none of Alpha's tasks.
    let (_, list) = call(&app, Method::GET, BETA, "/api/v1/tasks", &beta_owner, None).await;
    assert!(
        list["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|t| t["id"] != json!(id))
    );
    let (status, _) = call(
        &app,
        Method::DELETE,
        ALPHA,
        &format!("/api/v1/tasks/{id}"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn a_role_task_is_closed_by_the_first_to_finish_it() {
    let app = TestApp::start().await;
    let clinic = alpha_id(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let desk_two = another_member(&app, clinic, "front_desk").await;
    let desk_role = role(&app, clinic, "front_desk").await;
    let task = make_task(&app, &owner, daily("Lock up", desk_role, "none")).await;
    let occ = occurrence(&app, clinic, tid(&task), Some(desk_role), None, "none").await;
    let path = format!("/api/v1/tasks/occurrences/{occ}/complete");

    // Both desks see it; the assistant does not.
    for token in [&desk, &desk_two] {
        let (_, mine) = call(&app, Method::GET, ALPHA, "/api/v1/tasks/mine", token, None).await;
        assert_eq!(mine["items"].as_array().unwrap().len(), 1, "{mine}");
    }
    let (_, mine) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/tasks/mine",
        &assistant,
        None,
    )
    .await;
    assert_eq!(mine["items"].as_array().unwrap().len(), 0);
    let (_, badges) = call(&app, Method::GET, ALPHA, "/api/v1/me/badges", &desk, None).await;
    assert_eq!(badges["tasks_open"], 1, "{badges}");

    // Someone who does not hold the role may not finish it, even with the permission.
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &path,
        &assistant,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(&app, Method::POST, ALPHA, &path, &owner, Some(json!({}))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, done) = call(
        &app,
        Method::POST,
        ALPHA,
        &path,
        &desk,
        Some(json!({ "note": "all locked" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["status"], "done");
    assert_eq!(done["note"], "all locked");
    // Again as the same person: fine, and unchanged.
    let (status, again) = call(
        &app,
        Method::POST,
        ALPHA,
        &path,
        &desk,
        Some(json!({ "note": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["completed_at"], done["completed_at"]);
    assert_eq!(again["note"], "all locked");
    // The other desk is told it is already done.
    let (status, value) = call(&app, Method::POST, ALPHA, &path, &desk_two, Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT, "{value}");
    let (_, badges) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/me/badges",
        &desk_two,
        None,
    )
    .await;
    assert_eq!(badges["tasks_open"], 0);

    // The owner can open it again; then the other desk may finish it.
    let reopen = format!("/api/v1/tasks/occurrences/{occ}/reopen");
    let (status, open) = call(&app, Method::POST, ALPHA, &reopen, &owner, None).await;
    assert_eq!(status, StatusCode::OK, "{open}");
    assert_eq!(open["status"], "open");
    let (status, _) = call(&app, Method::POST, ALPHA, &path, &desk_two, Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK);

    // A note over 300 characters is refused.
    let personal = make_task(&app, &owner, daily("Personal", desk_role, "none")).await;
    let assistant_member = member(&app, clinic, ALPHA_ASSISTANT).await;
    let second = occurrence(
        &app,
        clinic,
        tid(&personal),
        None,
        Some(assistant_member),
        "none",
    )
    .await;
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &format!("/api/v1/tasks/occurrences/{second}/complete"),
        &assistant,
        Some(json!({ "note": "n".repeat(301) })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn materials_used_come_off_the_shelf_with_the_task_and_a_shortage_cancels_it() {
    let app = TestApp::start().await;
    let clinic = alpha_id(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let assistant_role = role(&app, clinic, "assistant").await;

    let (status, item) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/inventory-items",
        &owner,
        Some(json!({ "name": "Gloves", "unit": "box", "reorder_level": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{item}");
    let item = item["id"].as_str().unwrap().to_owned();
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/receive",
        &owner,
        Some(json!({ "item_id": item, "quantity": 10 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    // The assistant has tasks.use and inventory.read only.
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/use",
        &assistant,
        Some(json!({ "item_id": item, "quantity": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let task = make_task(
        &app,
        &owner,
        daily("Record materials", assistant_role, "record_usage"),
    )
    .await;
    let template = tid(&task);
    let occ = occurrence(
        &app,
        clinic,
        template,
        Some(assistant_role),
        None,
        "record_usage",
    )
    .await;
    sqlx::query(
        "insert into aarogyam.staff_notifications (org_id, kind, task_occurrence_id, step_no, href)
         values ($1, 'task_due', $2, 0, '/today')",
    )
    .bind(clinic)
    .bind(occ)
    .execute(&app.owner)
    .await
    .unwrap();

    // Too much: nothing is taken and the task stays open.
    let path = format!("/api/v1/tasks/occurrences/{occ}/complete");
    let (status, value) = call(
        &app,
        Method::POST,
        ALPHA,
        &path,
        &assistant,
        Some(json!({ "usage": [{ "item_id": item, "quantity": 4 }, { "item_id": item, "quantity": 100 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{value}");
    let (open, moved): (String, i64) = sqlx::query_as(
        "select o.status, (select count(*) from aarogyam.stock_movements m
                           where m.task_occurrence_id = o.id)
         from aarogyam.task_occurrences o where o.id = $1",
    )
    .bind(occ)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((open.as_str(), moved), ("open", 0));
    let on_hand: i64 = sqlx::query_scalar(
        "select sum(quantity)::bigint from aarogyam.stock_batches where item_id = $1::uuid",
    )
    .bind(&item)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(on_hand, 10);
    let unhandled: i64 = sqlx::query_scalar("select count(*) from aarogyam.staff_notifications where task_occurrence_id = $1 and handled_at is null")
        .bind(occ)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(unhandled, 1);

    // Enough: the movements carry the occurrence and the reason, and the notice is handled.
    let (status, value) = call(
        &app,
        Method::POST,
        ALPHA,
        &path,
        &assistant,
        Some(json!({ "usage": [{ "item_id": item, "quantity": 4 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{value}");
    let taken: Vec<(String, i64, Option<String>)> = sqlx::query_as(
        "select kind, quantity, reason from aarogyam.stock_movements where task_occurrence_id = $1",
    )
    .bind(occ)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        taken,
        vec![("use".to_owned(), -4, Some("end-of-day usage".to_owned()))]
    );
    let on_hand: i64 = sqlx::query_scalar(
        "select sum(quantity)::bigint from aarogyam.stock_batches where item_id = $1::uuid",
    )
    .bind(&item)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(on_hand, 6);
    let unhandled: i64 = sqlx::query_scalar("select count(*) from aarogyam.staff_notifications where task_occurrence_id = $1 and handled_at is null")
        .bind(occ)
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(unhandled, 0);
    // A repeat does not take stock again.
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &path,
        &assistant,
        Some(json!({ "usage": [{ "item_id": item, "quantity": 4 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let on_hand: i64 = sqlx::query_scalar(
        "select sum(quantity)::bigint from aarogyam.stock_batches where item_id = $1::uuid",
    )
    .bind(&item)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(on_hand, 6);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn standard_tasks_cannot_be_deleted_only_switched_off_and_on() {
    let app = TestApp::start().await;
    let clinic = alpha_id(&app).await;
    let owner = app.token(ALPHA_OWNER);
    seed_defaults(&app.owner, clinic).await.unwrap();
    let (status, list) = call(&app, Method::GET, ALPHA, "/api/v1/tasks", &owner, None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let defaults: Vec<&Value> = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["is_default"] == true)
        .collect();
    assert_eq!(defaults.len(), 3, "{list}");
    let id = defaults[0]["id"].as_str().unwrap().to_owned();

    let (status, value) = call(
        &app,
        Method::DELETE,
        ALPHA,
        &format!("/api/v1/tasks/{id}"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{value}");
    let (status, off) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/tasks/{id}"),
        &owner,
        Some(json!({ "active": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{off}");
    assert_eq!(off["active"], false);
    let before: OffsetDateTime =
        sqlx::query_scalar("select activated_at from aarogyam.task_templates where id = $1::uuid")
            .bind(&id)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let (_, preview) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/tasks/{id}/preview"),
        &owner,
        None,
    )
    .await;
    assert!(
        preview["items"].as_array().unwrap().is_empty(),
        "switched off: {preview}"
    );
    let (status, on) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &format!("/api/v1/tasks/{id}"),
        &owner,
        Some(json!({ "active": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{on}");
    let after: OffsetDateTime =
        sqlx::query_scalar("select activated_at from aarogyam.task_templates where id = $1::uuid")
            .bind(&id)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert!(after > before, "switching on restarts activated_at");

    // A task of our own can be deleted, and then it is gone.
    let desk_role = role(&app, clinic, "front_desk").await;
    let own = make_task(&app, &owner, daily("Own", desk_role, "none")).await;
    let own_id = own["id"].as_str().unwrap().to_owned();
    let (status, _) = call(
        &app,
        Method::DELETE,
        ALPHA,
        &format!("/api/v1/tasks/{own_id}"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/tasks/{own_id}"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Checks on the way in.
    for body in [
        json!({ "title": "", "assignee_role_id": desk_role, "schedule": { "kind": "daily", "due_time": "08:00" } }),
        json!({ "title": "x", "schedule": { "kind": "daily", "due_time": "08:00" } }),
        json!({ "title": "x", "assignee_role_id": Uuid::new_v4(), "schedule": { "kind": "daily", "due_time": "08:00" } }),
        json!({ "title": "x", "assignee_role_id": desk_role, "schedule": { "kind": "every_n_days", "due_time": "08:00" } }),
        json!({ "title": "x", "assignee_role_id": desk_role, "schedule": { "kind": "weekdays", "weekdays": [8], "due_time": "08:00" } }),
        json!({ "title": "x", "assignee_role_id": desk_role, "schedule": { "kind": "once", "once_at": "2001-01-01T00:00:00Z" } }),
    ] {
        let (status, value) = call(
            &app,
            Method::POST,
            ALPHA,
            "/api/v1/tasks",
            &owner,
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {value}");
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_preview_is_what_the_generator_makes() {
    let app = TestApp::start().await;
    let clinic = alpha_id(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let desk_role = role(&app, clinic, "front_desk").await;
    let today = OffsetDateTime::now_utc().date();
    let task = make_task(
        &app,
        &owner,
        json!({
            "title": "Every third day",
            "assignee_role_id": desk_role,
            "schedule": { "kind": "every_n_days", "interval_days": 3, "due_time": "10:00",
                          "starts_on": today.to_string() }
        }),
    )
    .await;
    let id = tid(&task);
    let (status, preview) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/tasks/{id}/preview"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let items = preview["items"].as_array().unwrap();
    assert_eq!(items.len(), 5, "{preview}");
    for item in items {
        let due = OffsetDateTime::parse(
            item["due_at"].as_str().unwrap(),
            &time::format_description::well_known::Rfc3339,
        )
        .unwrap();
        // The generator, run a minute after each due time, makes exactly that occurrence.
        let made = materialize(&app.owner, due + Duration::minutes(1), 100)
            .await
            .unwrap();
        assert_eq!(made, 1, "{item}");
        let (date, at): (time::Date, OffsetDateTime) = sqlx::query_as(
            "select local_date, due_at from aarogyam.task_occurrences
             where template_id = $1 order by due_at desc limit 1",
        )
        .bind(id)
        .fetch_one(&app.owner)
        .await
        .unwrap();
        assert_eq!(date.to_string(), item["local_date"].as_str().unwrap());
        assert_eq!(at, due);
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn confirm_photos_counts_patients_whose_visit_has_no_photo_and_history_filters() {
    let app = TestApp::start().await;
    let clinic = alpha_id(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let desk_role = role(&app, clinic, "front_desk").await;
    let task = make_task(
        &app,
        &owner,
        daily("Check photos", desk_role, "confirm_photos"),
    )
    .await;
    let template = tid(&task);
    let occ = occurrence(
        &app,
        clinic,
        template,
        Some(desk_role),
        None,
        "confirm_photos",
    )
    .await;
    let plain = occurrence_on(&app, clinic, template, desk_role, -1).await;

    let mut visits = Vec::new();
    for name in ["Ravi Kumar", "Sita Rao"] {
        let (status, patient) = call(
            &app,
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            &owner,
            Some(json!({ "full_name": name, "sex": "female", "age_years": 30 })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{patient}");
        let patient = patient["id"].as_str().unwrap().to_owned();
        let (status, visit) = call(
            &app,
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/visits"),
            &owner,
            Some(json!({ "chief_complaint": "Pain" })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{visit}");
        visits.push((patient, visit["id"].as_str().unwrap().to_owned()));
    }
    let item_of = |mine: &Value, id: Uuid| -> Value {
        mine["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|i| i["id"] == json!(id))
            .cloned()
            .unwrap()
    };
    let (status, mine) = call(&app, Method::GET, ALPHA, "/api/v1/tasks/mine", &desk, None).await;
    assert_eq!(status, StatusCode::OK, "{mine}");
    assert_eq!(
        item_of(&mine, occ)["patients_without_photos_today"],
        2,
        "{mine}"
    );
    assert!(
        item_of(&mine, plain)
            .get("patients_without_photos_today")
            .is_none()
    );

    // One visit gets a photo.
    let (patient, visit) = &visits[0];
    sqlx::query(
        "insert into aarogyam.attachments
           (org_id, patient_id, encounter_id, kind, storage_key, mime_type, size_bytes, sha256)
         values ($1, $2::uuid, $3::uuid, 'photo', $4, 'image/jpeg', 10, $5)",
    )
    .bind(clinic)
    .bind(patient)
    .bind(visit)
    .bind(format!("{clinic}/{}", Uuid::new_v4()))
    .bind("a".repeat(64))
    .execute(&app.owner)
    .await
    .unwrap();
    let (_, mine) = call(&app, Method::GET, ALPHA, "/api/v1/tasks/mine", &desk, None).await;
    assert_eq!(
        item_of(&mine, occ)["patients_without_photos_today"],
        1,
        "{mine}"
    );

    // History: by status and by task; a long range is refused.
    let (status, history) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/tasks/history",
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{history}");
    assert_eq!(history["items"].as_array().unwrap().len(), 2);
    let (_, done) = call(
        &app,
        Method::GET,
        ALPHA,
        &format!("/api/v1/tasks/history?status=done&template_id={template}"),
        &owner,
        None,
    )
    .await;
    assert_eq!(done["items"].as_array().unwrap().len(), 0);
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/tasks/history?from=2020-01-01&to=2026-01-01",
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/tasks/history?status=bogus",
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

/// An open occurrence for a role on the day `days` from today.
async fn occurrence_on(
    app: &TestApp,
    clinic: Uuid,
    template: Uuid,
    role_id: Uuid,
    days: i64,
) -> Uuid {
    let due = OffsetDateTime::now_utc() + Duration::days(days) - Duration::hours(2);
    sqlx::query_scalar(
        "insert into aarogyam.task_occurrences
           (org_id, template_id, title, action, assignee_role_id, local_date, due_at)
         values ($1, $2, 'Earlier', 'none', $3,
                 (select ($4 at time zone o.timezone)::date from aarogyam.organizations o
                  where o.id = $1), $4) returning id",
    )
    .bind(clinic)
    .bind(template)
    .bind(role_id)
    .bind(due)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}
