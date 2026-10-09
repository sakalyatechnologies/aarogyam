//! Labs on a real database: labs and contacts, lab orders and their moves, costs hidden without
//! `finance.view`, payments that record and void a `lab` expense, the reminder job (once per
//! day, never naming the patient), scopes, permissions, and that none of it crosses clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, Time, UtcOffset};
use uuid::{Uuid, uuid};

const DOCTOR_A: Uuid = uuid!("a0000000-0000-4000-8000-0000000000da");
const DOCTOR_B: Uuid = uuid!("a0000000-0000-4000-8000-0000000000db");
const READER: Uuid = uuid!("a0000000-0000-4000-8000-0000000000dc");

fn ist() -> UtcOffset {
    UtcOffset::from_hms(5, 30, 0).unwrap()
}

fn today() -> Date {
    OffsetDateTime::now_utc().to_offset(ist()).date()
}

/// 10:00 in the clinic on `day`: inside the reminder job's hours.
fn morning(day: Date) -> OffsetDateTime {
    day.with_time(Time::from_hms(10, 0, 0).unwrap())
        .assume_offset(ist())
}

async fn send(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, ALPHA, path, Some(token), body).await
}

async fn post_ok(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = send(app, token, Method::POST, path, Some(body)).await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_owned()
}

/// A lab with one contact who has an email. Returns (lab, contact).
async fn lab(app: &TestApp, owner: &str, name: &str) -> (String, String) {
    let vendor = post_ok(app, owner, "/api/v1/lab-vendors", json!({ "name": name })).await;
    let contact = post_ok(
        app,
        owner,
        &format!("/api/v1/lab-vendors/{}/contacts", id(&vendor)),
        json!({ "name": "Suresh", "role": "Manager", "email": "suresh@lab.test", "phone": "9876500001" }),
    )
    .await;
    (id(&vendor), id(&contact))
}

async fn patient(app: &TestApp, owner: &str, name: &str) -> String {
    id(&post_ok(app, owner, "/api/v1/patients", json!({ "full_name": name })).await)
}

/// A crown on 36, sent now, due on `due`.
async fn order(app: &TestApp, token: &str, vendor: &str, patient: &str, due: Date) -> Value {
    post_ok(
        app,
        token,
        "/api/v1/lab-orders",
        json!({
            "vendor_id": vendor, "patient_id": patient, "send": true, "due_on": due.to_string(),
            "instructions": "Match the neighbouring tooth",
            "items": [{ "work_type": "Crown", "teeth": [36], "shade": "A2", "material": "Zirconia",
                        "unit_cost_paise": 250_000 }],
        }),
    )
    .await
}

/// Adds a doctor to Alpha with a sign-in. Returns the membership.
async fn doctor(app: &TestApp, auth_uid: Uuid, name: &str) -> Uuid {
    sqlx::query_scalar(
        "with u as (insert into aarogyam.users (auth_uid, display_name, email)
                    values ($1, $2, $1::text || '@alpha.test') returning id)
         insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, u.id, r.id, 'active' from aarogyam.organizations o, u, aarogyam.roles r
         where o.slug = 'alpha' and r.org_id = o.id and r.key = 'doctor'
         returning id",
    )
    .bind(auth_uid)
    .bind(name)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn outbox(app: &TestApp) -> Vec<(String, Value)> {
    sqlx::query_as(
        "select recipient, payload from aarogyam.outbox_events
         where event_key = 'lab_order.reminder' order by created_at, id",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn labs_contacts_and_orders_move_through_their_statuses() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, contact) = lab(&app, &owner, "Precision Dental Lab").await;

    let (status, _) = send(
        &app,
        &owner,
        Method::POST,
        "/api/v1/lab-vendors",
        Some(json!({ "name": " precision dental lab " })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    for bad in [
        json!({}),
        json!({ "name": "X", "email": "nope" }),
        json!({ "name": "X", "phone": "12" }),
    ] {
        let (status, body) = send(
            &app,
            &owner,
            Method::POST,
            "/api/v1/lab-vendors",
            Some(bad.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    let path = format!("/api/v1/lab-vendors/{vendor}/contacts");
    for bad in [
        json!({ "name": "No way to reach" }),
        json!({ "name": "A", "whatsapp": true }),
        json!({ "name": "A", "phone": "9876500002", "preferred_channel": "email" }),
    ] {
        let (status, body) = send(&app, &owner, Method::POST, &path, Some(bad.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    let changed = send(
        &app,
        &owner,
        Method::PATCH,
        &format!("/api/v1/lab-contacts/{contact}"),
        Some(json!({ "role": "" })),
    )
    .await;
    assert_eq!(changed.0, StatusCode::OK, "{}", changed.1);
    assert!(changed.1["role"].is_null());
    assert_eq!(changed.1["preferred_channel"], "email");
    let (_, labs) = send(&app, &owner, Method::GET, "/api/v1/lab-vendors", None).await;
    assert_eq!(labs["items"][0]["kind"], "dental_lab");
    assert_eq!(labs["items"][0]["contacts"][0]["phone"], "+919876500001");

    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let due = today() + Duration::days(7);
    let made = order(&app, &owner, &vendor, &ravi, due).await;
    let order_id = id(&made);
    assert!(made["number"].as_str().unwrap().starts_with("LAB-"));
    assert_eq!(made["status"], "sent");
    assert!(made["sent_at"].is_string());
    assert_eq!(made["patient_name"], "Ravi Kumar");
    assert_eq!(made["items"][0]["teeth"], json!([36]));
    assert_eq!(made["items"][0]["unit_cost_paise"], 250_000);
    assert_eq!(made["events"][0]["kind"], "created");

    for bad in [
        json!({ "vendor_id": vendor, "patient_id": ravi, "items": [] }),
        json!({ "vendor_id": vendor, "patient_id": ravi, "items": [{ "work_type": "Crown", "teeth": [19] }] }),
        json!({ "vendor_id": vendor, "patient_id": ravi, "items": [{ "work_type": "Crown", "qty": 0 }] }),
        json!({ "vendor_id": vendor, "patient_id": ravi, "items": [{ "work_type": " " }] }),
        json!({ "vendor_id": Uuid::now_v7(), "patient_id": ravi, "items": [{ "work_type": "Crown" }] }),
        json!({ "vendor_id": vendor, "patient_id": ravi, "contact_id": Uuid::now_v7(), "items": [{ "work_type": "Crown" }] }),
    ] {
        let (status, body) = send(
            &app,
            &owner,
            Method::POST,
            "/api/v1/lab-orders",
            Some(bad.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    let (status, _) = send(&app, &owner, Method::POST, "/api/v1/lab-orders",
        Some(json!({ "vendor_id": vendor, "patient_id": Uuid::now_v7(), "items": [{ "work_type": "Crown" }] }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Status moves: forward only; received stamps when it came back.
    let status_path = format!("/api/v1/lab-orders/{order_id}/status");
    let (status, _) = send(
        &app,
        &owner,
        Method::POST,
        &status_path,
        Some(json!({ "status": "fitted" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let moved = post_ok(
        &app,
        &owner,
        &status_path,
        json!({ "status": "in_progress", "stage": "Wax try-in" }),
    )
    .await;
    assert_eq!(moved["stage"], "Wax try-in");
    let changed = send(&app, &owner, Method::PATCH, &format!("/api/v1/lab-orders/{order_id}"),
        Some(json!({ "stage": "Bisque", "contact_id": contact, "due_on": (due + Duration::days(1)).to_string() }))).await;
    assert_eq!(changed.0, StatusCode::OK, "{}", changed.1);
    assert_eq!(changed.1["contact_name"], "Suresh");
    let kinds: Vec<&str> = changed.1["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["kind"].as_str().unwrap())
        .collect();
    // Both changes in one statement; their order among themselves isn't meaningful.
    let mut kinds = kinds;
    kinds[2..].sort_unstable();
    assert_eq!(
        kinds,
        ["created", "status_changed", "due_changed", "stage_changed"]
    );
    let received = post_ok(&app, &owner, &status_path, json!({ "status": "received" })).await;
    assert!(received["received_at"].is_string());
    post_ok(
        &app,
        &owner,
        &status_path,
        json!({ "status": "returned_for_rework", "note": "Shade off" }),
    )
    .await;
    let (status, _) = send(
        &app,
        &owner,
        Method::PATCH,
        &format!("/api/v1/lab-orders/{order_id}"),
        Some(json!({ "stage": "x" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The remake points at the first order, of the same patient only.
    let remake = post_ok(&app, &owner, "/api/v1/lab-orders",
        json!({ "vendor_id": vendor, "patient_id": ravi, "rework_of_id": order_id, "items": [{ "work_type": "Crown", "teeth": [36] }] })).await;
    assert_eq!(remake["status"], "draft");
    assert_eq!(remake["rework_of_id"], order_id.as_str());
    let meera = patient(&app, &owner, "Meera Iyer").await;
    let (status, _) = send(&app, &owner, Method::POST, "/api/v1/lab-orders",
        Some(json!({ "vendor_id": vendor, "patient_id": meera, "rework_of_id": order_id, "items": [{ "work_type": "Crown" }] }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (_, list) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-orders?vendor_id={vendor}&status=draft"),
        None,
    )
    .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    let (_, mine) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/patients/{ravi}/lab-orders"),
        None,
    )
    .await;
    assert_eq!(mine["items"].as_array().unwrap().len(), 2);
    let (_, none) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/patients/{meera}/lab-orders"),
        None,
    )
    .await;
    assert_eq!(none["items"], json!([]));
    let (status, _) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/patients/{}/lab-orders", Uuid::now_v7()),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Overdue: work at the lab past its due date.
    let late = order(&app, &owner, &vendor, &meera, today() - Duration::days(1)).await;
    let (_, overdue) = send(
        &app,
        &owner,
        Method::GET,
        "/api/v1/lab-orders?overdue=true",
        None,
    )
    .await;
    let ids: Vec<&str> = overdue["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [late["id"].as_str().unwrap()]);

    // Removing a lab keeps its orders.
    let (status, _) = send(
        &app,
        &owner,
        Method::DELETE,
        &format!("/api/v1/lab-vendors/{vendor}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-vendors/{vendor}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-orders/{order_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    app.finish().await;
}

/// The reminder job's run at 10:00 clinic time on `day`.
async fn run_on(app: &TestApp, day: Date) -> aarogyam_notify::LabReminderReport {
    aarogyam_notify::remind_labs(&app.api_db(), morning(day))
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn labs_are_reminded_once_per_step_and_never_told_the_patient() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, _) = lab(&app, &owner, "Precision Dental Lab").await;
    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let day = today();
    let made = order(&app, &owner, &vendor, &ravi, day + Duration::days(2)).await;
    let order_id = id(&made);

    // Out of hours nothing goes; in hours, due in two days: one reminder, once.
    let night = day
        .with_time(Time::from_hms(23, 0, 0).unwrap())
        .assume_offset(ist());
    let quiet = aarogyam_notify::remind_labs(&app.api_db(), night)
        .await
        .unwrap();
    assert_eq!(quiet.reminded, 0);
    assert_eq!(run_on(&app, day).await.reminded, 1);
    assert_eq!(run_on(&app, day).await.reminded, 0);
    assert_eq!(run_on(&app, day + Duration::days(1)).await.reminded, 0);
    // Two at once still remind once.
    let (a, b) = tokio::join!(
        run_on(&app, day + Duration::days(2)),
        run_on(&app, day + Duration::days(2))
    );
    assert_eq!(a.reminded + b.reminded, 1, "due today, once");
    let sent = outbox(&app).await;
    assert_eq!(sent.len(), 2);
    for (recipient, payload) in &sent {
        assert_eq!(recipient, "suresh@lab.test");
        assert_eq!(payload["clinic_name"], "Alpha Dental");
        assert_eq!(payload["order_number"], made["number"]);
        assert_eq!(
            payload["items"][0],
            json!({ "work_type": "Crown", "teeth": [36], "shade": "A2" })
        );
        let text = payload.to_string();
        assert!(!text.contains("Ravi") && !text.contains(&ravi), "{text}");
    }
    assert_eq!(sent[0].1["reminder"], "due_soon");
    assert_eq!(sent[1].1["reminder"], "due_today");

    // Past due: flagged once, no email.
    let late = run_on(&app, day + Duration::days(3)).await;
    assert_eq!((late.reminded, late.overdue), (0, 1));
    assert_eq!(run_on(&app, day + Duration::days(4)).await.overdue, 0);

    // A new due date runs the steps again.
    let path = format!("/api/v1/lab-orders/{order_id}");
    let new_due = day + Duration::days(10);
    let (status, _) = send(
        &app,
        &owner,
        Method::PATCH,
        &path,
        Some(json!({ "due_on": new_due.to_string() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(run_on(&app, new_due - Duration::days(1)).await.reminded, 1);
    let (_, detail) = send(&app, &owner, Method::GET, &path, None).await;
    let reminders = detail["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["kind"] == "reminded")
        .count();
    assert_eq!(reminders, 3);

    // Back from the lab: no more reminders.
    post_ok(
        &app,
        &owner,
        &format!("{path}/status"),
        json!({ "status": "received" }),
    )
    .await;
    assert_eq!(run_on(&app, new_due).await.reminded, 0);
    let (status, _) = send(&app, &owner, Method::POST, &format!("{path}/remind"), None).await;
    assert_eq!(status, StatusCode::CONFLICT);

    // A lab with no email: the step is recorded as skipped, and asking to remind is refused.
    let quiet_lab = id(&post_ok(
        &app,
        &owner,
        "/api/v1/lab-vendors",
        json!({ "name": "Phone Only Lab" }),
    )
    .await);
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/lab-vendors/{quiet_lab}/contacts"),
        json!({ "name": "Ramesh", "phone": "9876500003" }),
    )
    .await;
    let other = order(&app, &owner, &quiet_lab, &ravi, day).await;
    assert_eq!(run_on(&app, day).await.skipped, 1);
    let (status, body) = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/lab-orders/{}/remind", id(&other)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");

    // Asking now: one email, queued with the change.
    let again = order(&app, &owner, &vendor, &ravi, day + Duration::days(20)).await;
    let (status, queued) = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/lab-orders/{}/remind", id(&again)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{queued}");
    let last = outbox(&app).await.pop().unwrap();
    assert_eq!(last.1["reminder"], "manual");
    assert!(!last.1.to_string().contains("Ravi"));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn payments_record_and_void_their_lab_expense() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, _) = lab(&app, &owner, "Precision Dental Lab").await;
    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let made = order(&app, &owner, &vendor, &ravi, today()).await;
    let day = today().to_string();

    let (_, balance) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-vendors/{vendor}/balance"),
        None,
    )
    .await;
    assert_eq!(
        (
            balance["orders"].as_i64(),
            balance["billed_paise"].as_i64(),
            balance["due_paise"].as_i64()
        ),
        (Some(1), Some(250_000), Some(250_000))
    );

    for bad in [
        json!({ "vendor_id": vendor, "paid_on": day, "amount_paise": 0 }),
        json!({ "vendor_id": vendor, "paid_on": (today() + Duration::days(2)).to_string(), "amount_paise": 100 }),
        json!({ "vendor_id": vendor, "paid_on": day, "amount_paise": 100, "lab_order_id": Uuid::now_v7() }),
    ] {
        let (status, body) = send(
            &app,
            &owner,
            Method::POST,
            "/api/v1/lab-payments",
            Some(bad.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    let paid = post_ok(&app, &owner, "/api/v1/lab-payments", json!({
        "vendor_id": vendor, "lab_order_id": made["id"], "paid_on": day, "amount_paise": 200_000,
        "lab_invoice_ref": "PDL/118", "note": "Crown",
    })).await;
    assert_eq!(paid["status"], "recorded");
    let expense_id = paid["expense_id"].as_str().unwrap();
    let (_, expenses) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/expenses?from={day}&to={day}"),
        None,
    )
    .await;
    let expense = expenses["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == expense_id)
        .unwrap()
        .clone();
    assert_eq!(expense["category"], "lab");
    assert_eq!(expense["amount_paise"], 200_000);
    assert_eq!(expense["note"], "Lab: Precision Dental Lab, bill PDL/118");
    let (_, balance) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-vendors/{vendor}/balance"),
        None,
    )
    .await;
    assert_eq!(balance["due_paise"], 50_000);
    let (_, list) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-payments?vendor_id={vendor}"),
        None,
    )
    .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1);

    // The expense goes only with its payment.
    let reason = json!({ "reason": "Entered twice" });
    let (status, _) = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/expenses/{expense_id}/void"),
        Some(reason.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let path = format!("/api/v1/lab-payments/{}/void", id(&paid));
    let voided = post_ok(&app, &owner, &path, reason.clone()).await;
    assert_eq!(voided["status"], "void");
    let (status, _) = send(&app, &owner, Method::POST, &path, Some(reason.clone())).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, expenses) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/expenses?from={day}&to={day}"),
        None,
    )
    .await;
    let expense = expenses["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["id"] == expense_id)
        .unwrap()
        .clone();
    assert_eq!(expense["status"], "void");
    let (_, balance) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-vendors/{vendor}/balance"),
        None,
    )
    .await;
    assert_eq!(balance["paid_paise"], 0);

    // Lab turnaround in the Analytics report: sent to received.
    sqlx::query("update aarogyam.lab_orders set sent_at = now() - interval '3 days' where id = $1")
        .bind(Uuid::parse_str(made["id"].as_str().unwrap()).unwrap())
        .execute(&app.owner)
        .await
        .unwrap();
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/lab-orders/{}/status", id(&made)),
        json!({ "status": "received" }),
    )
    .await;
    let (status, report) = send(&app, &owner, Method::GET, "/api/v1/reports/analytics", None).await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["lab_turnaround"]["orders_received"], 1);
    assert_eq!(report["lab_turnaround"]["average_days"], 3.0);
    app.finish().await;
}

/// Every lab route, with the records it acts on.
fn routes(
    vendor: &str,
    contact: &str,
    order: &str,
    patient: &str,
    payment: &str,
    item: &str,
) -> Vec<(Method, String, Option<Value>)> {
    let body = Some(json!({}));
    vec![
        (Method::GET, "/api/v1/lab-vendors".into(), None),
        (
            Method::POST,
            "/api/v1/lab-vendors".into(),
            Some(json!({ "name": "New Lab" })),
        ),
        (Method::GET, format!("/api/v1/lab-vendors/{vendor}"), None),
        (
            Method::PATCH,
            format!("/api/v1/lab-vendors/{vendor}"),
            body.clone(),
        ),
        (
            Method::POST,
            format!("/api/v1/lab-vendors/{vendor}/contacts"),
            Some(json!({ "name": "B", "email": "b@lab.test" })),
        ),
        (
            Method::GET,
            format!("/api/v1/lab-vendors/{vendor}/balance"),
            None,
        ),
        (
            Method::PATCH,
            format!("/api/v1/lab-contacts/{contact}"),
            body.clone(),
        ),
        (Method::GET, "/api/v1/lab-orders".into(), None),
        (Method::GET, format!("/api/v1/lab-orders/{order}"), None),
        (Method::PATCH, format!("/api/v1/lab-orders/{order}"), body),
        (
            Method::POST,
            format!("/api/v1/lab-orders/{order}/status"),
            Some(json!({ "status": "in_progress" })),
        ),
        (
            Method::POST,
            format!("/api/v1/lab-orders/{order}/remind"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/lab-orders/{order}/items"),
            Some(json!({ "work_type": "Crown" })),
        ),
        (
            Method::POST,
            format!("/api/v1/lab-orders/{order}/contacts-log"),
            Some(json!({ "channel": "call" })),
        ),
        (
            Method::PATCH,
            format!("/api/v1/lab-order-items/{item}"),
            Some(json!({ "qty": 2 })),
        ),
        (
            Method::DELETE,
            format!("/api/v1/lab-order-items/{item}"),
            None,
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{patient}/lab-orders"),
            None,
        ),
        (Method::GET, "/api/v1/lab-payments".into(), None),
        (
            Method::POST,
            format!("/api/v1/lab-payments/{payment}/void"),
            Some(json!({ "reason": "Wrong lab" })),
        ),
        (
            Method::DELETE,
            format!("/api/v1/lab-contacts/{contact}"),
            None,
        ),
        (
            Method::DELETE,
            format!("/api/v1/lab-vendors/{vendor}"),
            None,
        ),
    ]
}

/// A lab, contact, patient, order, payment and the order's item at Alpha.
async fn alpha_world(
    app: &TestApp,
    owner: &str,
) -> (String, String, String, String, String, String) {
    let (vendor, contact) = lab(app, owner, "Precision Dental Lab").await;
    let ravi = patient(app, owner, "Ravi Kumar").await;
    let made = order(app, owner, &vendor, &ravi, today() + Duration::days(5)).await;
    let item = id(&made["items"][0]);
    let made = id(&made);
    let paid = post_ok(
        app,
        owner,
        "/api/v1/lab-payments",
        json!({ "vendor_id": vendor, "paid_on": today().to_string(), "amount_paise": 1000 }),
    )
    .await;
    (vendor, contact, made, ravi, id(&paid), item)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn lab_records_stay_in_their_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, contact, made, ravi, paid, item) = alpha_world(&app, &owner).await;
    let beta = app.token(BETA_OWNER);
    for (method, path, body) in routes(&vendor, &contact, &made, &ravi, &paid, &item) {
        let (status, value) = app
            .send(method.clone(), BETA, &path, Some(&beta), body)
            .await;
        if path == "/api/v1/lab-vendors"
            || path == "/api/v1/lab-orders"
            || path == "/api/v1/lab-payments"
        {
            assert!(status.is_success(), "{method} {path}: {status}");
            if method == Method::GET {
                assert_eq!(value["items"], json!([]), "{method} {path}");
            }
        } else {
            assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}: {value}");
        }
    }
    // A Beta payment can't name Alpha's lab, and its order can't name Alpha's patient.
    let (status, _) = app.send(Method::POST, BETA, "/api/v1/lab-payments", Some(&beta),
        Some(json!({ "vendor_id": vendor, "paid_on": today().to_string(), "amount_paise": 1000 }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let beta_lab = id(&app
        .send(
            Method::POST,
            BETA,
            "/api/v1/lab-vendors",
            Some(&beta),
            Some(json!({ "name": "Beta Lab" })),
        )
        .await
        .1);
    let (status, _) = app.send(Method::POST, BETA, "/api/v1/lab-orders", Some(&beta),
        Some(json!({ "vendor_id": beta_lab, "patient_id": ravi, "items": [{ "work_type": "Crown" }] }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Row-level security hides Alpha's rows from Beta even in a direct query.
    let beta_id = app.clinic_id("beta").await;
    let seen: i64 = app
        .api_db()
        .scoped(&sakalya_db::Scope::tenant(beta_id), async |tx| {
            sqlx::query_scalar(
                "select (select count(*) from aarogyam.lab_vendors where org_id <> $1)
                      + (select count(*) from aarogyam.lab_contacts where org_id <> $1)
                      + (select count(*) from aarogyam.lab_orders where org_id <> $1)
                      + (select count(*) from aarogyam.lab_order_items where org_id <> $1)
                      + (select count(*) from aarogyam.lab_order_events where org_id <> $1)
                      + (select count(*) from aarogyam.lab_payments where org_id <> $1)",
            )
            .bind(beta_id)
            .fetch_one(tx.conn())
            .await
            .map_err(sakalya_db::DbError::from)
        })
        .await
        .unwrap();
    assert_eq!(seen, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn labs_need_their_permissions_and_costs_need_finance() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, contact, made, ravi, paid, item) = alpha_world(&app, &owner).await;

    // No permissions at all: every route refuses.
    let nobody = app.token(ALPHA_NOTHING);
    for (method, path, body) in routes(&vendor, &contact, &made, &ravi, &paid, &item) {
        let (status, _) = send(&app, &nobody, method.clone(), &path, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}");
    }
    let (status, _) = send(
        &app,
        &nobody,
        Method::POST,
        "/api/v1/lab-payments",
        Some(json!({ "vendor_id": vendor, "paid_on": today().to_string(), "amount_paise": 1000 })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The front desk keeps labs and orders, but sees and sets no costs and pays no labs.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, seen) = send(
        &app,
        &desk,
        Method::GET,
        &format!("/api/v1/lab-orders/{made}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(seen["items"][0]["unit_cost_paise"].is_null());
    assert_eq!(seen["costs_visible"], false);
    let (status, _) = send(&app, &desk, Method::POST, "/api/v1/lab-orders", Some(json!({
        "vendor_id": vendor, "patient_id": ravi, "items": [{ "work_type": "Crown", "unit_cost_paise": 100 }] }))).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(
        &app,
        &desk,
        Method::POST,
        "/api/v1/lab-orders",
        Some(json!({
        "vendor_id": vendor, "patient_id": ravi, "items": [{ "work_type": "Crown" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    for path in [
        format!("/api/v1/lab-vendors/{vendor}/balance"),
        "/api/v1/lab-payments".into(),
    ] {
        let (status, _) = send(&app, &desk, Method::GET, &path, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
    let (status, _) = send(
        &app,
        &desk,
        Method::POST,
        "/api/v1/lab-payments",
        Some(json!({ "vendor_id": vendor, "paid_on": today().to_string(), "amount_paise": 1000 })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // labs.read alone reads but changes nothing.
    sqlx::raw_sql(
        "do $$ declare o uuid := (select id from aarogyam.organizations where slug = 'alpha');
                       r uuid; u uuid;
         begin
           insert into aarogyam.roles (org_id, key, name) values (o, 'lab_reader', 'Lab reader')
             returning id into r;
           insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
             values (o, r, 'labs.read', 'all');
           insert into aarogyam.users (auth_uid, display_name, email)
             values ('a0000000-0000-4000-8000-0000000000dc', 'Lab Reader', 'reader@alpha.test')
             returning id into u;
           insert into aarogyam.memberships (org_id, user_id, role_id, status) values (o, u, r, 'active');
         end $$",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let reader = app.token(READER);
    let (status, _) = send(&app, &reader, Method::GET, "/api/v1/lab-orders", None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = send(
        &app,
        &reader,
        Method::POST,
        &format!("/api/v1/lab-orders/{made}/remind"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn doctors_at_own_scope_reach_only_their_lab_orders() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let a = doctor(&app, DOCTOR_A, "Dr Anil").await;
    doctor(&app, DOCTOR_B, "Dr Bela").await;
    sqlx::query(
        "update aarogyam.role_permissions rp set scope = 'own' from aarogyam.roles r
         where r.id = rp.role_id and r.key = 'doctor' and rp.permission in ('labs.read', 'labs.write')",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let (vendor, _) = lab(&app, &owner, "Precision Dental Lab").await;
    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    // The owner records an order with Dr Anil as its doctor.
    let anils = post_ok(
        &app,
        &owner,
        "/api/v1/lab-orders",
        json!({
        "vendor_id": vendor, "patient_id": ravi, "doctor_id": a, "send": true,
        "items": [{ "work_type": "Crown", "teeth": [36] }] }),
    )
    .await;
    let theirs = order(&app, &owner, &vendor, &ravi, today()).await;

    let anil = app.token(DOCTOR_A);
    let bela = app.token(DOCTOR_B);
    let (_, list) = send(&app, &anil, Method::GET, "/api/v1/lab-orders", None).await;
    let ids: Vec<&str> = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [anils["id"].as_str().unwrap()]);
    for path in [
        format!("/api/v1/lab-orders/{}", id(&theirs)),
        format!("/api/v1/lab-orders/{}", id(&anils)),
    ] {
        let (status, _) = send(&app, &bela, Method::GET, &path, None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let (status, _) = send(
        &app,
        &bela,
        Method::POST,
        &format!("/api/v1/lab-orders/{}/status", id(&anils)),
        Some(json!({ "status": "in_progress" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        &anil,
        Method::POST,
        &format!("/api/v1/lab-orders/{}/status", id(&anils)),
        Some(json!({ "status": "in_progress" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Items and the contact log follow the order's reach.
    let anils_item = id(&anils["items"][0]);
    for (method, path, body) in [
        (
            Method::POST,
            format!("/api/v1/lab-orders/{}/items", id(&anils)),
            Some(json!({ "work_type": "Crown" })),
        ),
        (
            Method::PATCH,
            format!("/api/v1/lab-order-items/{anils_item}"),
            Some(json!({ "qty": 2 })),
        ),
        (
            Method::DELETE,
            format!("/api/v1/lab-order-items/{anils_item}"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/lab-orders/{}/contacts-log", id(&anils)),
            Some(json!({ "channel": "call" })),
        ),
    ] {
        let (status, _) = send(&app, &bela, method.clone(), &path, body.clone()).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}");
        let (status, _) = send(&app, &anil, method.clone(), &path, body).await;
        let expected = if method == Method::DELETE {
            StatusCode::OK
        } else {
            StatusCode::CREATED
        };
        let expected = if method == Method::PATCH {
            StatusCode::OK
        } else {
            expected
        };
        assert_eq!(status, expected, "{method} {path}");
    }
    // Ravi isn't Dr Bela's patient: no orders for him, nor a new one.
    let (status, _) = send(
        &app,
        &bela,
        Method::GET,
        &format!("/api/v1/patients/{ravi}/lab-orders"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        &bela,
        Method::POST,
        "/api/v1/lab-orders",
        Some(
            json!({ "vendor_id": vendor, "patient_id": ravi, "items": [{ "work_type": "Crown" }] }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // The owner, at `all`, reaches both.
    let (_, all) = send(&app, &owner, Method::GET, "/api/v1/lab-orders", None).await;
    assert_eq!(all["items"].as_array().unwrap().len(), 2);
    app.finish().await;
}

async fn history_rows(app: &TestApp, row: &str) -> i64 {
    sqlx::query_scalar("select count(*) from audit.audit_events where row_id = $1::uuid")
        .bind(row)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

fn last_event(order: &Value) -> &Value {
    order["events"].as_array().unwrap().last().unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn lab_order_items_change_until_the_order_is_final() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, _) = lab(&app, &owner, "Precision Dental Lab").await;
    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let made = order(&app, &owner, &vendor, &ravi, today() + Duration::days(5)).await;
    let order_id = id(&made);
    let first = id(&made["items"][0]);
    let items_path = format!("/api/v1/lab-orders/{order_id}/items");

    let added = post_ok(
        &app,
        &owner,
        &items_path,
        json!({
        "work_type": "Bridge", "teeth": [13, 11, 12], "unit_cost_paise": 500_000 }),
    )
    .await;
    assert_eq!(added["items"].as_array().unwrap().len(), 2);
    assert_eq!(added["items"][1]["line_no"], 2);
    assert_eq!(added["items"][1]["teeth"], json!([11, 12, 13]));
    assert_eq!(last_event(&added)["kind"], "item_added");
    assert_eq!(last_event(&added)["line_no"], 2);
    let second = id(&added["items"][1]);
    for bad in [
        json!({ "work_type": "Crown", "teeth": [19] }),
        json!({ "work_type": "Crown", "qty": 0 }),
        json!({ "work_type": " " }),
    ] {
        let (status, body) = send(&app, &owner, Method::POST, &items_path, Some(bad.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }

    let item_path = format!("/api/v1/lab-order-items/{second}");
    let (status, changed) = send(
        &app,
        &owner,
        Method::PATCH,
        &item_path,
        Some(json!({ "shade": "A3", "teeth": [21] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["items"][1]["shade"], "A3");
    assert_eq!(changed["items"][1]["teeth"], json!([21]));
    assert_eq!(changed["items"][1]["unit_cost_paise"], 500_000);
    assert_eq!(changed["items"][1]["work_type"], "Bridge");
    assert_eq!(last_event(&changed)["kind"], "item_changed");
    for bad in [
        json!({ "qty": 101 }),
        json!({ "teeth": [11, 11] }),
        json!({ "unit_cost_paise": -1 }),
    ] {
        let (status, body) = send(&app, &owner, Method::PATCH, &item_path, Some(bad.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    assert!(
        history_rows(&app, &second).await >= 2,
        "added and changed are audited"
    );

    // The front desk changes work but never costs: a cost it can't see stays.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, seen) = send(
        &app,
        &desk,
        Method::PATCH,
        &item_path,
        Some(json!({ "qty": 2 })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(seen["items"][1]["unit_cost_paise"].is_null());
    for body in [
        json!({ "unit_cost_paise": 1 }),
        json!({ "unit_cost_paise": null }),
    ] {
        let (status, _) = send(&app, &desk, Method::PATCH, &item_path, Some(body.clone())).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
    let (status, _) = send(
        &app,
        &desk,
        Method::POST,
        &items_path,
        Some(json!({ "work_type": "Crown", "unit_cost_paise": 1 })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, kept) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-orders/{order_id}"),
        None,
    )
    .await;
    assert_eq!(kept["items"][1]["qty"], 2);
    assert_eq!(kept["items"][1]["unit_cost_paise"], 500_000);
    let (status, cleared) = send(
        &app,
        &owner,
        Method::PATCH,
        &item_path,
        Some(json!({ "unit_cost_paise": null })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(cleared["items"][1]["unit_cost_paise"].is_null());

    let (status, removed) = send(
        &app,
        &owner,
        Method::DELETE,
        &format!("/api/v1/lab-order-items/{first}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(removed["items"].as_array().unwrap().len(), 1);
    assert_eq!(last_event(&removed)["kind"], "item_removed");
    assert_eq!(last_event(&removed)["line_no"], 1);
    let (status, _) = send(&app, &owner, Method::DELETE, &item_path, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "an order keeps one item");
    let (status, _) = send(
        &app,
        &owner,
        Method::DELETE,
        &format!("/api/v1/lab-order-items/{first}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Fitted or cancelled: items no longer change.
    let status_path = format!("/api/v1/lab-orders/{order_id}/status");
    post_ok(&app, &owner, &status_path, json!({ "status": "received" })).await;
    post_ok(&app, &owner, &status_path, json!({ "status": "fitted" })).await;
    let cancelled = order(&app, &owner, &vendor, &ravi, today()).await;
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/lab-orders/{}/status", id(&cancelled)),
        json!({ "status": "cancelled" }),
    )
    .await;
    for (method, path, body) in [
        (
            Method::POST,
            items_path.clone(),
            Some(json!({ "work_type": "Crown" })),
        ),
        (Method::PATCH, item_path.clone(), Some(json!({ "qty": 1 }))),
        (Method::DELETE, item_path.clone(), None),
        (
            Method::POST,
            format!("/api/v1/lab-orders/{}/items", id(&cancelled)),
            Some(json!({ "work_type": "Crown" })),
        ),
    ] {
        let (status, _) = send(&app, &owner, method.clone(), &path, body).await;
        assert_eq!(status, StatusCode::CONFLICT, "{method} {path}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn contacting_the_lab_is_logged_and_can_move_the_due_date() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, contact) = lab(&app, &owner, "Precision Dental Lab").await;
    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let made = order(&app, &owner, &vendor, &ravi, today() + Duration::days(1)).await;
    let order_id = id(&made);
    assert!(made["last_contacted_at"].is_null());
    let path = format!("/api/v1/lab-orders/{order_id}/contacts-log");
    // The reminder job already ran for the old date.
    sqlx::query("update aarogyam.lab_orders set contact_id = $2::uuid, due_soon_reminded_on = current_date where id = $1::uuid")
        .bind(&order_id).bind(&contact).execute(&app.owner).await.unwrap();

    let promised = today() + Duration::days(4);
    let logged = post_ok(
        &app,
        &owner,
        &path,
        json!({
        "channel": "call", "contact_id": contact, "outcome": "promised_date",
        "note": "Suresh says the crown is in glazing", "promised_on": promised.to_string() }),
    )
    .await;
    assert!(logged["last_contacted_at"].is_string());
    assert!(logged["last_contacted_by"].is_string());
    assert!(logged["last_contacted_by_name"].is_string());
    assert_eq!(logged["due_on"], promised.to_string());
    assert_eq!(logged["contact_phone"], "+919876500001");
    assert_eq!(logged["contact_email"], "suresh@lab.test");
    assert_eq!(logged["contact_whatsapp"], false);
    let event = last_event(&logged);
    assert_eq!(event["kind"], "contacted");
    assert_eq!(event["channel"], "call");
    assert_eq!(event["outcome"], "promised_date");
    assert_eq!(event["contact_id"], contact.as_str());
    assert_eq!(event["due_on"], promised.to_string());
    assert_eq!(event["actor_id"], logged["last_contacted_by"]);
    let reminded: Option<Date> = sqlx::query_scalar(
        "select due_soon_reminded_on from aarogyam.lab_orders where id = $1::uuid",
    )
    .bind(&order_id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(reminded, None, "a promised date restarts the reminders");
    let (_, list) = send(&app, &owner, Method::GET, "/api/v1/lab-orders", None).await;
    assert_eq!(
        list["items"][0]["last_contacted_by"],
        logged["last_contacted_by"]
    );
    assert_eq!(list["items"][0]["contact_phone"], "+919876500001");

    // A message without a date leaves the due date alone.
    let again = post_ok(&app, &owner, &path, json!({ "channel": "whatsapp" })).await;
    assert_eq!(again["due_on"], promised.to_string());
    assert!(last_event(&again)["outcome"].is_null());
    let (_, other_contact) = lab(&app, &owner, "Other Lab").await;
    let long = "x".repeat(501);
    for bad in [
        json!({ "channel": "fax" }),
        json!({}),
        json!({ "channel": "call", "note": long }),
        json!({ "channel": "call", "contact_id": other_contact }),
        json!({ "channel": "call", "promised_on": "soon" }),
    ] {
        let (status, body) = send(&app, &owner, Method::POST, &path, Some(bad.clone())).await;
        assert!(
            status.is_client_error() && status != StatusCode::NOT_FOUND,
            "{bad}: {status} {body}"
        );
    }

    // A manual reminder counts as contact.
    let fresh = order(&app, &owner, &vendor, &ravi, today() + Duration::days(9)).await;
    let (status, _) = send(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/lab-orders/{}/remind", id(&fresh)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let (_, fresh) = send(
        &app,
        &owner,
        Method::GET,
        &format!("/api/v1/lab-orders/{}", id(&fresh)),
        None,
    )
    .await;
    assert!(fresh["last_contacted_at"].is_string());

    // A final order logs contact but has no due date to move.
    let fresh_path = format!("/api/v1/lab-orders/{}", id(&fresh));
    post_ok(
        &app,
        &owner,
        &format!("{fresh_path}/status"),
        json!({ "status": "cancelled" }),
    )
    .await;
    let (status, _) = send(
        &app,
        &owner,
        Method::POST,
        &format!("{fresh_path}/contacts-log"),
        Some(json!({ "channel": "call", "promised_on": promised.to_string() })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    post_ok(
        &app,
        &owner,
        &format!("{fresh_path}/contacts-log"),
        json!({ "channel": "visit" }),
    )
    .await;

    // Without labs.write, no contact log.
    let nobody = app.token(ALPHA_NOTHING);
    let (status, _) = send(
        &app,
        &nobody,
        Method::POST,
        &path,
        Some(json!({ "channel": "call" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Erasing the patient clears the notes on the order's history.
    let notes: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.lab_order_events where lab_order_id = $1::uuid and note is not null")
        .bind(&order_id).fetch_one(&app.owner).await.unwrap();
    assert_eq!(notes, 1);
    let erased: bool = sqlx::query_scalar(
        "select app.erase_patient(p.org_id, p.id, gen_random_uuid()) from aarogyam.patients p where p.id = $1::uuid")
        .bind(&ravi).fetch_one(&app.owner).await.unwrap();
    assert!(erased);
    let notes: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.lab_order_events where lab_order_id = $1::uuid and note is not null")
        .bind(&order_id).fetch_one(&app.owner).await.unwrap();
    assert_eq!(notes, 0);
    app.finish().await;
}
