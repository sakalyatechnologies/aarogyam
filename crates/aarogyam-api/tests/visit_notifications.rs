//! Staff notifications for the visit journey on a real database (migrations 0678, 0679): what
//! is written and when, who sees it (assigned doctor, doctors on duty, the fallback, the desk),
//! when it counts as handled and unread, `payments.collect`, and the clinic wall.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

fn uuid_of(text: &str) -> Uuid {
    text.parse().unwrap()
}

async fn call(
    app: &TestApp,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, ALPHA, path, Some(token), body).await
}

async fn post_ok(app: &TestApp, token: &str, path: &str, body: Option<Value>) -> Value {
    let (status, value) = call(app, token, Method::POST, path, body).await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn get_ok(app: &TestApp, token: &str, path: &str) -> Value {
    let (status, value) = call(app, token, Method::GET, path, None).await;
    assert_eq!(status, StatusCode::OK, "GET {path}: {value}");
    value
}

async fn n(app: &TestApp, sql: &'static str, id: Uuid) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .bind(id)
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

/// How many rows of `kind` are about the token.
async fn token_rows(app: &TestApp, token: &str, kind: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "select count(*) from aarogyam.staff_notifications where queue_token_id = $1 and kind = $2",
    )
    .bind(uuid_of(token))
    .bind(kind)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

/// How many rows of `kind` are about the visit's bills.
async fn bill_rows(app: &TestApp, visit: &str, kind: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "select count(*) from aarogyam.staff_notifications n
         join aarogyam.invoices i on i.org_id = n.org_id and i.id = n.invoice_id
         where i.encounter_id = $1 and n.kind = $2",
    )
    .bind(uuid_of(visit))
    .bind(kind)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn register(app: &TestApp, token: &str, name: &str) -> String {
    let (status, patient) = call(
        app,
        token,
        Method::POST,
        "/api/v1/patients",
        Some(json!({ "full_name": name, "sex": "female", "age_years": 34 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    id_of(&patient)
}

async fn walk_in(app: &TestApp, token: &str, patient: &str, doctor: Option<Uuid>) -> String {
    let (status, queued) = call(
        app,
        token,
        Method::POST,
        "/api/v1/queue",
        Some(json!({ "patient_id": patient, "practitioner_id": doctor })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{queued}");
    id_of(&queued)
}

async fn start_visit(app: &TestApp, token: &str, queue_token: &str) -> String {
    let started = post_ok(
        app,
        token,
        &format!("/api/v1/queue/{queue_token}/start-visit"),
        Some(json!({})),
    )
    .await;
    started["visit"]["id"].as_str().unwrap().to_owned()
}

/// The member's feed; empty for a role that sees no notifications at all.
async fn feed(app: &TestApp, token: &str) -> Vec<Value> {
    let (status, body) = call(
        app,
        token,
        Method::GET,
        "/api/v1/notifications?limit=100",
        None,
    )
    .await;
    if status == StatusCode::FORBIDDEN {
        return Vec::new();
    }
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"].as_array().unwrap().clone()
}

async fn count(app: &TestApp, token: &str) -> i64 {
    get_ok(app, token, "/api/v1/notifications/count").await["unread"]
        .as_i64()
        .unwrap()
}

async fn badge(app: &TestApp, token: &str) -> i64 {
    get_ok(app, token, "/api/v1/me/badges").await["notifications_unread"]
        .as_i64()
        .unwrap()
}

/// The feed rows of `kind` about the queue token.
fn about_token(items: &[Value], kind: &str, token: &str) -> Vec<Value> {
    items
        .iter()
        .filter(|item| item["kind"] == kind && item["queue_token"]["id"] == token)
        .cloned()
        .collect()
}

fn about_bill(items: &[Value], kind: &str, bill: &str) -> Vec<Value> {
    items
        .iter()
        .filter(|item| item["kind"] == kind && item["invoice"]["id"] == bill)
        .cloned()
        .collect()
}

fn unread(items: &[Value]) -> usize {
    items
        .iter()
        .filter(|item| {
            let actionable = [
                "patient_waiting",
                "send_in",
                "collect_payment",
                "arrival",
                "payment_due",
            ]
            .contains(&item["kind"].as_str().unwrap());
            item["read"] == false && !(actionable && item["handled"].is_object())
        })
        .count()
}

/// The badge and the count agree with the list, for everyone given.
async fn assert_counts_match_lists(app: &TestApp, tokens: &[&str]) {
    for token in tokens {
        let items = feed(app, token).await;
        let expected = i64::try_from(unread(&items)).unwrap();
        assert_eq!(count(app, token).await, expected, "count vs list");
        assert_eq!(badge(app, token).await, expected, "badge vs list");
    }
}

async fn membership_of(app: &TestApp, clinic: Uuid, auth_uid: Uuid) -> Uuid {
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

/// A new member of `role_key`; their token and membership.
async fn new_member(app: &TestApp, clinic: Uuid, role_key: &str) -> (String, Uuid) {
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
    let role_id: Uuid =
        sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = $2")
            .bind(clinic)
            .bind(role_key)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let member: Uuid = sqlx::query_scalar(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         values ($1, $2, $3, 'active') returning id",
    )
    .bind(clinic)
    .bind(user)
    .bind(role_id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    (app.token(auth_uid), member)
}

async fn branch(app: &TestApp, clinic: Uuid) -> Uuid {
    sqlx::query_scalar(
        "select id from aarogyam.branches where org_id = $1 order by created_at limit 1",
    )
    .bind(clinic)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn second_branch(app: &TestApp, clinic: Uuid) -> Uuid {
    sqlx::query_scalar(
        "insert into aarogyam.branches (org_id, slug, name)
         values ($1, 'b' || substr(md5(random()::text), 1, 8), 'Another branch') returning id",
    )
    .bind(clinic)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

/// A practitioner row for a member, with hours today (the clinic's weekday) at the branch.
async fn on_rota(app: &TestApp, clinic: Uuid, member: Uuid, branch: Uuid, name: &str) -> Uuid {
    let practitioner: Uuid = sqlx::query_scalar(
        "insert into aarogyam.practitioners (org_id, membership_id, display_name)
         values ($1, $2, $3) returning id",
    )
    .bind(clinic)
    .bind(member)
    .bind(name)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    hours(app, clinic, practitioner, branch, 0).await;
    practitioner
}

/// Working hours at the branch `days_from_today` after today's weekday.
async fn hours(
    app: &TestApp,
    clinic: Uuid,
    practitioner: Uuid,
    branch: Uuid,
    days_from_today: i32,
) {
    sqlx::query(
        "insert into aarogyam.working_hours (org_id, practitioner_id, branch_id, weekday, starts, ends)
         select $1, $2, $3,
                (extract(isodow from app.clinic_local_date(now(), o.timezone))::int - 1 + $4) % 7 + 1,
                '00:00', '23:59'
         from aarogyam.organizations o where o.id = $1",
    )
    .bind(clinic)
    .bind(practitioner)
    .bind(branch)
    .bind(days_from_today)
    .execute(&app.owner)
    .await
    .unwrap();
}

/// A token written straight into the table, for branches and days the API doesn't reach.
async fn token_at(
    app: &TestApp,
    clinic: Uuid,
    branch: Uuid,
    patient: &str,
    doctor: Option<Uuid>,
) -> String {
    let id: Uuid = sqlx::query_scalar(
        "insert into aarogyam.queue_tokens
           (org_id, branch_id, day, token_number, patient_id, practitioner_id)
         select $1, $2, app.clinic_local_date(now(), o.timezone),
                (select coalesce(max(token_number), 0) + 1 from aarogyam.queue_tokens
                 where org_id = $1 and branch_id = $2),
                $3, $4
         from aarogyam.organizations o where o.id = $1
         returning id",
    )
    .bind(clinic)
    .bind(branch)
    .bind(uuid_of(patient))
    .bind(doctor)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    id.to_string()
}

async fn sees(app: &TestApp, token: &str, kind: &str, queue_token: &str) -> bool {
    !about_token(&feed(app, token).await, kind, queue_token).is_empty()
}

async fn collect_bill(app: &TestApp, owner: &str, patient: &str, visit: &str, fee: i64) -> String {
    let (status, bill) = call(
        app,
        owner,
        Method::POST,
        "/api/v1/invoices",
        Some(json!({ "patient_id": patient, "encounter_id": visit,
                     "items": [{ "description": "Consultation", "unit_price_paise": fee }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{bill}");
    id_of(&bill)
}

async fn pay(
    app: &TestApp,
    token: &str,
    patient: &str,
    bill: &str,
    key: &str,
    paise: i64,
) -> (StatusCode, Value) {
    app.send_with(
        Method::POST,
        ALPHA,
        "/api/v1/payments",
        Some(token),
        Some(
            json!({ "patient_id": patient, "method": "cash", "amount_paise": paise,
                     "allocations": [{ "invoice_id": bill, "amount_paise": paise }] }),
        ),
        &[("idempotency-key", key)],
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one scenario walks each write in turn"
)]
async fn each_step_of_the_journey_writes_once() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner, "Meera Shah").await;

    // A walk-in writes patient_waiting straight away, for the doctors, with its link.
    let token = walk_in(&app, &owner, &patient, None).await;
    assert_eq!(token_rows(&app, &token, "patient_waiting").await, 1);
    let row = about_token(&feed(&app, &owner).await, "patient_waiting", &token);
    assert_eq!(row[0]["href"], "/queue");
    assert_eq!(row[0]["audience"], "doctor");
    assert!(row[0]["queue_token"]["number"].is_number());
    assert!(row[0]["handled"].is_null());
    // Rows never hold a patient's name.
    let leaked: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.staff_notifications n
         where n::text ilike '%Meera%' or n::text ilike '%Shah%'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(leaked, 0);
    assert!(!feed(&app, &owner).await[0].to_string().contains("Meera"));

    // The doctor calls the patient in: send_in is written and patient_waiting is handled.
    post_ok(&app, &owner, &format!("/api/v1/queue/{token}/call"), None).await;
    assert_eq!(token_rows(&app, &token, "send_in").await, 1);
    let items = feed(&app, &owner).await;
    assert!(about_token(&items, "patient_waiting", &token)[0]["handled"].is_object());
    assert!(about_token(&items, "send_in", &token)[0]["handled"].is_null());
    // The same status again, and the chair after the call, add nothing.
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/queue/{token}/status"),
        Some(json!({ "status": "in_chair" })),
    )
    .await;
    assert_eq!(token_rows(&app, &token, "send_in").await, 1);
    assert_eq!(token_rows(&app, &token, "patient_waiting").await, 1);

    // A check-in writes patient_waiting and no arrival.
    let doctor_row = sqlx::query_scalar::<_, Uuid>(
        "insert into aarogyam.practitioners (org_id, display_name) values ($1, 'Dr Rao') returning id",
    )
    .bind(clinic)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let appointment: Uuid = sqlx::query_scalar(
        "insert into aarogyam.appointments
           (org_id, patient_id, practitioner_id, branch_id, starts_at, ends_at, status)
         select p.org_id, p.id, $2, b.id, now() + interval '10 minutes',
                now() + interval '40 minutes', 'confirmed'
         from aarogyam.patients p
         join lateral (select id from aarogyam.branches where org_id = p.org_id limit 1) b on true
         where p.id = $1 returning id",
    )
    .bind(uuid_of(&patient))
    .bind(doctor_row)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let checked = post_ok(
        &app,
        &owner,
        &format!("/api/v1/appointments/{appointment}/check-in"),
        Some(json!({ "no_known_allergies": true })),
    )
    .await;
    let checked_token = checked["queue_token_id"].as_str().unwrap().to_owned();
    assert_eq!(token_rows(&app, &checked_token, "patient_waiting").await, 1);
    let arrivals = n(
        &app,
        "select count(*) from aarogyam.staff_notifications where kind = 'arrival' and appointment_id = $1",
        appointment,
    )
    .await;
    assert_eq!(arrivals, 0, "a check-in writes no arrival");

    // Send for payment with a token: one collect_payment for the bill, about the bill, and the
    // bill's own payment_due is not written twice.
    let queued = walk_in(&app, &owner, &patient, None).await;
    let visit = start_visit(&app, &owner, &queued).await;
    let closed = call(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({ "fee_paise": 50_000, "queue_status": "ready_to_bill" })),
    )
    .await;
    assert_eq!(closed.0, StatusCode::OK, "{}", closed.1);
    assert_eq!(bill_rows(&app, &visit, "collect_payment").await, 1);
    let bill: Uuid = sqlx::query_scalar("select id from aarogyam.invoices where encounter_id = $1")
        .bind(uuid_of(&visit))
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let items = feed(&app, &owner).await;
    let collect = about_bill(&items, "collect_payment", &bill.to_string());
    assert_eq!(collect[0]["audience"], "front_desk");
    assert_eq!(collect[0]["invoice"]["total_paise"], 50_000);
    assert_eq!(collect[0]["invoice"]["balance_paise"], 50_000);
    assert_eq!(collect[0]["href"], format!("/billing/invoices/{bill}"));
    // Asking again (the bill's lines, the token's move) writes nothing new.
    let again: i32 = sqlx::query_scalar("select app.write_collect_payment($1, $2)")
        .bind(clinic)
        .bind(uuid_of(&visit))
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(again, 0);
    assert_eq!(bill_rows(&app, &visit, "collect_payment").await, 1);

    // A visit without a token, sent for payment on finish, writes one too.
    let tokenless: String = id_of(
        &call(
            &app,
            &owner,
            Method::POST,
            &format!("/api/v1/patients/{patient}/visits"),
            Some(json!({ "chief_complaint": "Pain" })),
        )
        .await
        .1,
    );
    let (status, finished) = call(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{tokenless}/finish"),
        Some(json!({ "fee_paise": 30_000, "queue_status": "ready_to_bill" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{finished}");
    assert_eq!(bill_rows(&app, &tokenless, "collect_payment").await, 1);

    // The same by close, without a fee: no bill, so nothing to collect.
    let bare = id_of(
        &call(
            &app,
            &owner,
            Method::POST,
            &format!("/api/v1/patients/{patient}/visits"),
            Some(json!({ "chief_complaint": "Check" })),
        )
        .await
        .1,
    );
    let (status, _) = call(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{bare}/close"),
        Some(json!({ "queue_status": "ready_to_bill" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bill_rows(&app, &bare, "collect_payment").await, 0);

    // The desk bills a visit the doctor sent over without a fee: the lines come after the bill
    // row, and still ask for the money.
    let queued = walk_in(&app, &owner, &patient, None).await;
    let late = start_visit(&app, &owner, &queued).await;
    let (status, _) = call(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{late}/close"),
        Some(json!({ "queue_status": "ready_to_bill" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bill_rows(&app, &late, "collect_payment").await, 0);
    collect_bill(&app, &owner, &patient, &late, 20_000).await;
    assert_eq!(bill_rows(&app, &late, "collect_payment").await, 1);

    // Done writes none: the doctor collects the money themselves.
    let queued = walk_in(&app, &owner, &patient, None).await;
    let done = start_visit(&app, &owner, &queued).await;
    collect_bill(&app, &owner, &patient, &done, 40_000).await;
    let (status, _) = call(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{done}/close"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bill_rows(&app, &done, "collect_payment").await, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one matrix read top to bottom")]
async fn the_doctors_who_are_told_follow_the_assignment_and_the_rota() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let nothing = app.token(ALPHA_NOTHING);
    let (doc_a, member_a) = new_member(&app, clinic, "doctor").await;
    let (doc_b, member_b) = new_member(&app, clinic, "doctor").await;
    let (doc_c, member_c) = new_member(&app, clinic, "doctor").await;
    let branch_one = branch(&app, clinic).await;
    let patient = register(&app, &owner, "Meera Shah").await;
    let a = on_rota(&app, clinic, member_a, branch_one, "Dr A").await;
    let b = on_rota(&app, clinic, member_b, branch_one, "Dr B").await;
    // C works another weekday only: off hours today.
    let c: Uuid = sqlx::query_scalar(
        "insert into aarogyam.practitioners (org_id, membership_id, display_name)
         values ($1, $2, 'Dr C') returning id",
    )
    .bind(clinic)
    .bind(member_c)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    hours(&app, clinic, c, branch_one, 1).await;

    // Assigned to A: A sees it; B, with the same role, does not; neither does anyone else.
    let assigned = walk_in(&app, &owner, &patient, Some(a)).await;
    assert!(sees(&app, &doc_a, "patient_waiting", &assigned).await);
    for token in [&doc_b, &doc_c, &assistant, &desk, &nothing, &owner] {
        assert!(!sees(&app, token, "patient_waiting", &assigned).await);
    }
    // Reassigned to B: the audience follows at once, with no rewrite.
    sqlx::query("update aarogyam.queue_tokens set practitioner_id = $1 where id = $2")
        .bind(b)
        .bind(uuid_of(&assigned))
        .execute(&app.owner)
        .await
        .unwrap();
    assert!(sees(&app, &doc_b, "patient_waiting", &assigned).await);
    assert!(!sees(&app, &doc_a, "patient_waiting", &assigned).await);

    // Unassigned: only the doctors on duty (A and B), not C (off hours), the owner (no
    // practitioner row), the assistant or the desk.
    let open = walk_in(&app, &owner, &patient, None).await;
    assert!(sees(&app, &doc_a, "patient_waiting", &open).await);
    assert!(sees(&app, &doc_b, "patient_waiting", &open).await);
    for token in [&doc_c, &owner, &assistant, &desk, &nothing] {
        assert!(!sees(&app, token, "patient_waiting", &open).await);
    }

    // Approved time off and leave take a doctor off the rota; pending time off does not.
    sqlx::query(
        "insert into aarogyam.leave_blocks (org_id, practitioner_id, starts_at, ends_at)
         values ($1, $2, now() - interval '1 hour', now() + interval '1 hour')",
    )
    .bind(clinic)
    .bind(b)
    .execute(&app.owner)
    .await
    .unwrap();
    assert!(sees(&app, &doc_a, "patient_waiting", &open).await);
    assert!(!sees(&app, &doc_b, "patient_waiting", &open).await);
    sqlx::query("delete from aarogyam.leave_blocks where practitioner_id = $1")
        .bind(b)
        .execute(&app.owner)
        .await
        .unwrap();
    for (status, expect) in [("pending", true), ("approved", false)] {
        sqlx::query("delete from aarogyam.time_off_requests where membership_id = $1")
            .bind(member_b)
            .execute(&app.owner)
            .await
            .unwrap();
        sqlx::query(
            "insert into aarogyam.time_off_requests
               (org_id, membership_id, kind, starts_at, ends_at, status, decided_by, decided_at)
             values ($1, $2, 'sick', now() - interval '1 hour', now() + interval '1 hour', $3,
                     case when $3 = 'approved' then $2 end,
                     case when $3 = 'approved' then now() end)",
        )
        .bind(clinic)
        .bind(member_b)
        .bind(status)
        .execute(&app.owner)
        .await
        .unwrap();
        assert_eq!(
            sees(&app, &doc_b, "patient_waiting", &open).await,
            expect,
            "{status} time off"
        );
    }
    sqlx::query("delete from aarogyam.time_off_requests where membership_id = $1")
        .bind(member_b)
        .execute(&app.owner)
        .await
        .unwrap();

    // Several branches: A works the second branch only, B the first.
    let branch_two = second_branch(&app, clinic).await;
    sqlx::query("delete from aarogyam.working_hours where practitioner_id = $1")
        .bind(a)
        .execute(&app.owner)
        .await
        .unwrap();
    hours(&app, clinic, a, branch_two, 0).await;
    let first = token_at(&app, clinic, branch_one, &patient, None).await;
    let second = token_at(&app, clinic, branch_two, &patient, None).await;
    assert!(sees(&app, &doc_b, "patient_waiting", &first).await);
    assert!(!sees(&app, &doc_a, "patient_waiting", &first).await);
    assert!(sees(&app, &doc_a, "patient_waiting", &second).await);
    assert!(!sees(&app, &doc_b, "patient_waiting", &second).await);

    // Nobody on duty at a branch: every clinical.write holder, doctors and the owner alike,
    // but still not the assistant, the desk or a role with nothing.
    let branch_three = second_branch(&app, clinic).await;
    let nobody = token_at(&app, clinic, branch_three, &patient, None).await;
    for token in [&doc_a, &doc_b, &doc_c, &owner] {
        assert!(sees(&app, token, "patient_waiting", &nobody).await);
    }
    for token in [&assistant, &desk, &nothing] {
        assert!(!sees(&app, token, "patient_waiting", &nobody).await);
    }

    // A doctor who is also the owner: on the rota, the owner is told as a doctor.
    let owner_member = membership_of(&app, clinic, ALPHA_OWNER).await;
    on_rota(&app, clinic, owner_member, branch_one, "Dr Asha").await;
    let again = token_at(&app, clinic, branch_one, &patient, None).await;
    assert!(sees(&app, &owner, "patient_waiting", &again).await);
    assert!(sees(&app, &doc_b, "patient_waiting", &again).await);
    assert!(!sees(&app, &doc_a, "patient_waiting", &again).await);

    // send_in has the same audience as patient_waiting.
    post_ok(&app, &doc_b, &format!("/api/v1/queue/{again}/call"), None).await;
    assert!(sees(&app, &doc_b, "send_in", &again).await);
    assert!(sees(&app, &owner, "send_in", &again).await);
    assert!(!sees(&app, &doc_a, "send_in", &again).await);
    assert!(!sees(&app, &desk, "send_in", &again).await);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one scenario walks the handled states in turn"
)]
async fn handled_rows_stop_counting_and_the_badge_matches_the_list() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (doc, member) = new_member(&app, clinic, "doctor").await;
    let branch = branch(&app, clinic).await;
    let doctor = on_rota(&app, clinic, member, branch, "Dr A").await;
    let patient = register(&app, &owner, "Meera Shah").await;

    // A patient waits: one unread for the doctor, the same in the count, the badge and the list.
    let token = walk_in(&app, &desk, &patient, Some(doctor)).await;
    assert_counts_match_lists(&app, &[&doc, &owner, &assistant, &desk]).await;
    assert_eq!(count(&app, &doc).await, 1);
    assert_eq!(count(&app, &desk).await, 0);
    let unread_only = get_ok(&app, &doc, "/api/v1/notifications?unread_only=true").await;
    assert_eq!(unread_only["items"].as_array().unwrap().len(), 1);

    // Calling the patient handles the waiting row; the send_in row is the one left unread.
    post_ok(&app, &doc, &format!("/api/v1/queue/{token}/call"), None).await;
    let items = feed(&app, &doc).await;
    let waiting = &about_token(&items, "patient_waiting", &token)[0];
    assert!(waiting["handled"].is_object());
    assert_eq!(
        waiting["read"], false,
        "still unread for the member, but handled"
    );
    assert_eq!(count(&app, &doc).await, 1, "only send_in counts");
    assert_counts_match_lists(&app, &[&doc, &owner, &assistant, &desk]).await;
    let unread_only = get_ok(&app, &doc, "/api/v1/notifications?unread_only=true").await;
    assert_eq!(unread_only["items"].as_array().unwrap().len(), 1);
    // Mark-all-read clears the list and the count together.
    post_ok(&app, &doc, "/api/v1/notifications/read-all", None).await;
    assert_eq!(count(&app, &doc).await, 0);
    assert_counts_match_lists(&app, &[&doc]).await;

    // The visit goes for payment: the desk and the assistant are told, the doctor, who holds
    // billing.read only, is not, and the owner (billing.write) is.
    let visit = start_visit(&app, &doc, &token).await;
    // The owner sends it: a fee needs billing.write, which the doctor role lacks.
    let (status, closed) = call(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({ "fee_paise": 50_000, "queue_status": "ready_to_bill" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    let bill: Uuid = sqlx::query_scalar("select id from aarogyam.invoices where encounter_id = $1")
        .bind(uuid_of(&visit))
        .fetch_one(&app.owner)
        .await
        .unwrap();
    let bill = bill.to_string();
    for token in [&desk, &assistant, &owner] {
        let items = feed(&app, token).await;
        let rows = about_bill(&items, "collect_payment", &bill);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["invoice"]["balance_paise"], 50_000);
    }
    assert_eq!(
        about_bill(&feed(&app, &doc).await, "collect_payment", &bill).len(),
        0
    );
    assert_counts_match_lists(&app, &[&doc, &owner, &assistant, &desk]).await;
    let before = count(&app, &desk).await;
    assert_eq!(before, 1);

    // A part payment leaves it open; the rest handles it, and then it stops counting.
    let (status, part) = pay(&app, &assistant, &patient, &bill, "part-0000-0001", 20_000).await;
    assert_eq!(status, StatusCode::CREATED, "{part}");
    let items = feed(&app, &desk).await;
    let row = &about_bill(&items, "collect_payment", &bill)[0];
    assert!(row["handled"].is_null(), "part paid: {row}");
    assert_eq!(row["invoice"]["balance_paise"], 30_000);
    assert_eq!(count(&app, &desk).await, 1);
    let (status, rest) = pay(&app, &assistant, &patient, &bill, "part-0000-0002", 30_000).await;
    assert_eq!(status, StatusCode::CREATED, "{rest}");
    let items = feed(&app, &desk).await;
    let row = &about_bill(&items, "collect_payment", &bill)[0];
    assert!(row["handled"].is_object());
    assert_eq!(row["invoice"]["balance_paise"], 0);
    assert_eq!(count(&app, &desk).await, 0);
    assert_counts_match_lists(&app, &[&doc, &owner, &assistant, &desk]).await;
    // The token goes done: nothing is left open for anyone.
    post_ok(
        &app,
        &desk,
        &format!("/api/v1/queue/{token}/status"),
        Some(json!({ "status": "done" })),
    )
    .await;
    assert_eq!(count(&app, &owner).await, 0);

    // A voided bill is handled, not collected.
    let queued = walk_in(&app, &desk, &patient, Some(doctor)).await;
    let second = start_visit(&app, &doc, &queued).await;
    call(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/visits/{second}/close"),
        Some(json!({ "fee_paise": 10_000, "queue_status": "ready_to_bill" })),
    )
    .await;
    let voided: Uuid =
        sqlx::query_scalar("select id from aarogyam.invoices where encounter_id = $1")
            .bind(uuid_of(&second))
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let voided = voided.to_string();
    assert_eq!(bill_rows(&app, &second, "collect_payment").await, 1);
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/invoices/{voided}/void"),
        Some(json!({ "reason": "Entered twice" })),
    )
    .await;
    let items = feed(&app, &desk).await;
    assert!(about_bill(&items, "collect_payment", &voided)[0]["handled"].is_object());
    assert_counts_match_lists(&app, &[&owner, &desk]).await;

    // A token that leaves the queue handles what was open about it, and one put back to
    // waiting reopens the waiting row.
    let leaver = walk_in(&app, &desk, &patient, Some(doctor)).await;
    post_ok(
        &app,
        &desk,
        &format!("/api/v1/queue/{leaver}/status"),
        Some(json!({ "status": "left" })),
    )
    .await;
    assert!(
        about_token(&feed(&app, &doc).await, "patient_waiting", &leaver)[0]["handled"].is_object()
    );
    sqlx::query(
        "update aarogyam.queue_tokens set status = 'waiting', done_at = null where id = $1",
    )
    .bind(uuid_of(&leaver))
    .execute(&app.owner)
    .await
    .unwrap();
    assert!(
        about_token(&feed(&app, &doc).await, "patient_waiting", &leaver)[0]["handled"].is_null()
    );
    assert_eq!(token_rows(&app, &leaver, "patient_waiting").await, 1);
    assert_counts_match_lists(&app, &[&doc, &owner, &desk]).await;
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one matrix read top to bottom")]
async fn payments_collect_takes_payment_and_nothing_else() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let (doctor, _) = new_member(&app, clinic, "doctor").await;
    let patient = register(&app, &owner, "Meera Shah").await;
    let queued = walk_in(&app, &owner, &patient, None).await;
    let visit = start_visit(&app, &owner, &queued).await;
    let draft = collect_bill(&app, &owner, &patient, &visit, 50_000).await;

    // The assistant holds payments.collect and nothing of billing.
    let (status, session) = call(&app, &assistant, Method::GET, "/api/v1/session", None).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    let permissions = session["membership"]["permissions"].to_string();
    assert!(permissions.contains("payments.collect"));
    assert!(!permissions.contains("billing.read"));
    assert!(!permissions.contains("billing.write"));

    // What to collect, read only: a draft shows its preview total and no number.
    let summary = get_ok(
        &app,
        &assistant,
        &format!("/api/v1/invoices/{draft}/collect-summary"),
    )
    .await;
    assert_eq!(summary["status"], "draft");
    assert_eq!(summary["total_paise"], 50_000);
    assert_eq!(summary["balance_paise"], 50_000);
    assert_eq!(summary["patient"]["id"], patient);
    assert!(summary["number"].is_null());
    // A doctor with billing.read may read it too; a role with nothing may not.
    get_ok(
        &app,
        &doctor,
        &format!("/api/v1/invoices/{draft}/collect-summary"),
    )
    .await;
    let (status, _) = call(
        &app,
        &nothing,
        Method::GET,
        &format!("/api/v1/invoices/{draft}/collect-summary"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Another clinic gets a 404, with and without the permission.
    let (status, _) = app
        .send(
            Method::GET,
            BETA,
            &format!("/api/v1/invoices/{draft}/collect-summary"),
            Some(&app.token(BETA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // The assistant collects against the draft: it is issued and paid in one request.
    let (status, paid) = pay(
        &app,
        &assistant,
        &patient,
        &draft,
        "collect-000-0001",
        50_000,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    let state: String = sqlx::query_scalar("select status from aarogyam.invoices where id = $1")
        .bind(uuid_of(&draft))
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(state, "issued");
    // A retry with the same key returns the first payment.
    let (status, _) = pay(
        &app,
        &assistant,
        &patient,
        &draft,
        "collect-000-0001",
        50_000,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // Nothing is left to collect: the summary and a second payment are refused.
    let (status, _) = call(
        &app,
        &assistant,
        Method::GET,
        &format!("/api/v1/invoices/{draft}/collect-summary"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = pay(&app, &assistant, &patient, &draft, "collect-000-0002", 100).await;
    assert!(status.is_client_error(), "{status}");

    // An issued bill with a balance, paid by part.
    let issued = collect_bill(&app, &owner, &patient, &visit, 80_000).await;
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/invoices/{issued}/issue"),
        None,
    )
    .await;
    let summary = get_ok(
        &app,
        &assistant,
        &format!("/api/v1/invoices/{issued}/collect-summary"),
    )
    .await;
    assert!(summary["number"].is_string());
    let (status, _) = pay(
        &app,
        &assistant,
        &patient,
        &issued,
        "collect-000-0003",
        30_000,
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let summary = get_ok(
        &app,
        &assistant,
        &format!("/api/v1/invoices/{issued}/collect-summary"),
    )
    .await;
    assert_eq!(summary["balance_paise"], 50_000);

    // What it does not open: advances, other patients' bills, voids, new bills, the lists.
    let (status, _) = app
        .send_with(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(&assistant),
            Some(json!({ "patient_id": patient, "method": "cash", "amount_paise": 100 })),
            &[("idempotency-key", "advance-0000-0001")],
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "an advance names no bill");
    let other = register(&app, &owner, "Ravi Pawar").await;
    let (status, _) = pay(&app, &assistant, &other, &issued, "collect-000-0004", 100).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "another patient's bill");
    let voided = collect_bill(&app, &owner, &patient, &visit, 1_000).await;
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/invoices/{voided}/void"),
        Some(json!({ "reason": "Entered twice" })),
    )
    .await;
    let (status, _) = pay(
        &app,
        &assistant,
        &patient,
        &voided,
        "collect-000-0005",
        1_000,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "a void bill takes no payment");
    for (method, path, body) in [
        (
            Method::POST,
            format!("/api/v1/invoices/{issued}/void"),
            Some(json!({ "reason": "No" })),
        ),
        (
            Method::POST,
            "/api/v1/invoices".to_owned(),
            Some(
                json!({ "patient_id": patient, "items": [{ "description": "X", "unit_price_paise": 100 }] }),
            ),
        ),
        (Method::GET, "/api/v1/invoices".to_owned(), None),
        (Method::GET, format!("/api/v1/invoices/{issued}"), None),
        (Method::GET, "/api/v1/payments".to_owned(), None),
        (
            Method::POST,
            format!("/api/v1/invoices/{issued}/issue"),
            None,
        ),
    ] {
        let (status, body) = call(&app, &assistant, method.clone(), &path, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}: {body}");
    }
    // The existing billing.write path is unchanged: it still refuses a draft.
    let draft_again = collect_bill(&app, &owner, &patient, &visit, 2_000).await;
    let (status, _) = pay(
        &app,
        &owner,
        &patient,
        &draft_again,
        "collect-000-0006",
        2_000,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_sees_nothing_and_cannot_read_the_rows() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner, "Meera Shah").await;
    let queued = walk_in(&app, &owner, &patient, None).await;
    let visit = start_visit(&app, &owner, &queued).await;
    post_ok(
        &app,
        &owner,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({ "fee_paise": 50_000, "queue_status": "ready_to_bill" })),
    )
    .await;
    let alpha_rows: Vec<Uuid> = sqlx::query_scalar(
        "select id from aarogyam.staff_notifications where org_id = $1
           and kind in ('patient_waiting', 'collect_payment')",
    )
    .bind(clinic)
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(alpha_rows.len(), 2);
    let beta = app.token(BETA_OWNER);
    let (status, body) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/notifications",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["items"].as_array().unwrap().len(), 0);
    let (status, body) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/notifications/count",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["unread"], 0);
    for id in alpha_rows {
        let (status, _) = app
            .send(
                Method::POST,
                BETA,
                &format!("/api/v1/notifications/{id}/read"),
                Some(&beta),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    // The wall also holds at the member level: the doctor not on the rota, the desk and the
    // assistant cannot mark a row that is not theirs.
    let (doctor, _) = new_member(&app, clinic, "doctor").await;
    let waiting: Uuid = sqlx::query_scalar(
        "select id from aarogyam.staff_notifications where org_id = $1 and kind = 'collect_payment'",
    )
    .bind(clinic)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let (status, _) = call(
        &app,
        &doctor,
        Method::POST,
        &format!("/api/v1/notifications/{waiting}/read"),
        None,
    )
    .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "a billing.read doctor is not told to collect"
    );
    app.finish().await;
}

/// What a role's session lists, as one string to search.
async fn permissions_of(app: &TestApp, token: &str) -> String {
    let (status, session) = call(app, token, Method::GET, "/api/v1/session", None).await;
    assert_eq!(status, StatusCode::OK, "{session}");
    session["membership"]["permissions"].to_string()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one scenario walks each write in turn"
)]
async fn the_seeded_assistant_runs_the_front_of_the_visit() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let (doctor, member) = new_member(&app, clinic, "doctor").await;
    let practitioner = on_rota(&app, clinic, member, branch(&app, clinic).await, "Dr Rao").await;

    // The assistant holds what the front needs and nothing of billing.
    let permissions = permissions_of(&app, &assistant).await;
    for key in [
        "appointments.write",
        "patients.write",
        "intake.write",
        "payments.collect",
    ] {
        assert!(permissions.contains(key), "{key}");
    }
    for key in [
        "billing.read",
        "billing.write",
        "finance.view",
        "patients.contact",
    ] {
        assert!(!permissions.contains(key), "{key}");
    }

    // Registers a walk-in in one step: the doctor it is for is told.
    let (status, walk) = call(
        &app,
        &assistant,
        Method::POST,
        "/api/v1/walk-ins",
        Some(
            json!({ "patient": { "full_name": "Ramesh Jadhav" }, "no_known_allergies": true,
                     "practitioner_id": practitioner }),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{walk}");
    let token = walk["token"]["id"].as_str().unwrap().to_owned();
    assert_eq!(token_rows(&app, &token, "patient_waiting").await, 1);
    assert!(sees(&app, &doctor, "patient_waiting", &token).await);

    // Adds a registered patient to the queue.
    let patient = register(&app, &owner, "Meera Shah").await;
    let queued = walk_in(&app, &assistant, &patient, Some(practitioner)).await;
    assert!(sees(&app, &doctor, "patient_waiting", &queued).await);

    // Checks in a booked patient: the doctor is told.
    let booked = register(&app, &owner, "Kavya Rao").await;
    let appointment: Uuid = sqlx::query_scalar(
        "insert into aarogyam.appointments
           (org_id, patient_id, practitioner_id, branch_id, starts_at, ends_at, status)
         select p.org_id, p.id, $2, b.id, now() + interval '10 minutes',
                now() + interval '40 minutes', 'confirmed'
         from aarogyam.patients p
         join lateral (select id from aarogyam.branches where org_id = p.org_id limit 1) b on true
         where p.id = $1 returning id",
    )
    .bind(uuid_of(&booked))
    .bind(practitioner)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let checked = post_ok(
        &app,
        &assistant,
        &format!("/api/v1/appointments/{appointment}/check-in"),
        Some(json!({ "no_known_allergies": true })),
    )
    .await;
    let checked_token = checked["queue_token_id"].as_str().unwrap().to_owned();
    assert_eq!(token_rows(&app, &checked_token, "patient_waiting").await, 1);
    assert!(sees(&app, &doctor, "patient_waiting", &checked_token).await);

    // Still no bills, no reports, no clinical writing; a role with nothing still gets 403.
    for (method, path, body) in [
        (Method::GET, "/api/v1/invoices", None),
        (
            Method::POST,
            "/api/v1/invoices",
            Some(
                json!({ "patient_id": patient, "items": [{ "description": "x", "unit_price_paise": 100 }] }),
            ),
        ),
        (Method::GET, "/api/v1/price-items", None),
    ] {
        let (status, _) = call(&app, &assistant, method, path, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "assistant {path}");
    }
    let (status, _) = call(
        &app,
        &nothing,
        Method::POST,
        "/api/v1/walk-ins",
        Some(json!({ "patient": { "full_name": "A" } })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic sees none of it, and cannot check in Alpha's appointment.
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &format!("/api/v1/appointments/{appointment}/check-in"),
            Some(&app.token(BETA_OWNER)),
            Some(json!({})),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let rows: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.queue_tokens t join aarogyam.organizations o on o.id = t.org_id
         where o.id <> $1",
    )
    .bind(clinic)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(rows, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one scenario walks each write in turn"
)]
async fn a_hired_doctor_sends_for_payment_and_the_desk_collects() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let (doctor, member) = new_member(&app, clinic, "doctor").await;
    let practitioner = on_rota(&app, clinic, member, branch(&app, clinic).await, "Dr Rao").await;
    let patient = register(&app, &owner, "Meera Shah").await;

    // The doctor holds no billing.write and no payments.collect.
    let permissions = permissions_of(&app, &doctor).await;
    assert!(!permissions.contains("billing.write"));
    assert!(!permissions.contains("payments.collect"));
    assert!(permissions.contains("clinical.write"));

    // Assistant queues, doctor treats and closes with a fee: a draft bill, and the desk is told.
    let queued = walk_in(&app, &assistant, &patient, Some(practitioner)).await;
    let visit = start_visit(&app, &doctor, &queued).await;
    let (status, closed) = call(
        &app,
        &doctor,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({ "fee_paise": 50_000, "queue_status": "ready_to_bill" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    let bill = closed["invoice"]["id"].as_str().unwrap().to_owned();
    assert_eq!(closed["invoice"]["status"], "draft");
    assert_eq!(bill_rows(&app, &visit, "collect_payment").await, 1);
    assert_eq!(
        about_bill(&feed(&app, &assistant).await, "collect_payment", &bill).len(),
        1
    );

    // Itemised lines on that draft: the doctor may edit its lines, and start a visit's draft,
    // but not discount, move it to another visit or touch the place of supply.
    let (status, edited) = call(
        &app,
        &doctor,
        Method::PATCH,
        &format!("/api/v1/invoices/{bill}"),
        Some(json!({ "items": [
            { "description": "Consultation", "unit_price_paise": 40_000 },
            { "description": "Scaling", "unit_price_paise": 10_000, "quantity": 2 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["items"].as_array().unwrap().len(), 2);
    for body in [
        json!({ "items": [{ "description": "x", "unit_price_paise": 100, "discount_paise": 10 }] }),
        json!({ "place_of_supply": "27" }),
        json!({ "encounter_id": Uuid::new_v4().to_string() }),
    ] {
        let (status, _) = call(
            &app,
            &doctor,
            Method::PATCH,
            &format!("/api/v1/invoices/{bill}"),
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    }
    // A bill that belongs to no visit is not the doctor's to edit.
    let loose = collect_bill_without_visit(&app, &owner, &patient).await;
    let (status, _) = call(
        &app,
        &doctor,
        Method::PATCH,
        &format!("/api/v1/invoices/{loose}"),
        Some(json!({ "items": [{ "description": "x", "unit_price_paise": 100 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Creating a draft needs a visit of that patient.
    let items = json!([{ "description": "Review", "unit_price_paise": 200 }]);
    let other = register(&app, &owner, "Kavya Rao").await;
    for (body, expected) in [
        (
            json!({ "patient_id": patient, "items": items }),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({ "patient_id": other, "encounter_id": visit, "items": items }),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({ "patient_id": patient, "encounter_id": Uuid::new_v4().to_string(), "items": items }),
            StatusCode::NOT_FOUND,
        ),
        (
            json!({ "patient_id": patient, "encounter_id": visit, "items": [
                { "description": "x", "unit_price_paise": 100, "discount_paise": 5 }] }),
            StatusCode::FORBIDDEN,
        ),
        (
            json!({ "patient_id": patient, "encounter_id": visit, "items": items }),
            StatusCode::CREATED,
        ),
    ] {
        let (status, got) = call(
            &app,
            &doctor,
            Method::POST,
            "/api/v1/invoices",
            Some(body.clone()),
        )
        .await;
        assert_eq!(status, expected, "{body} {got}");
    }

    // Everything past the draft stays the desk's: the doctor cannot issue, void, take payment
    // or record a refund; reading bills works as before (billing.read).
    let (status, _) = call(
        &app,
        &doctor,
        Method::POST,
        &format!("/api/v1/invoices/{bill}/issue"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        &doctor,
        Method::POST,
        &format!("/api/v1/invoices/{bill}/void"),
        Some(json!({ "reason": "mistake" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = pay(&app, &doctor, &patient, &bill, "doctor-000-0001", 50_000).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let state: String = sqlx::query_scalar("select status from aarogyam.invoices where id = $1")
        .bind(uuid_of(&bill))
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(state, "draft");

    // The assistant collects: issued and paid in one request, with no billing access.
    let (status, paid) = pay(&app, &assistant, &patient, &bill, "assist-000-0001", 50_000).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    // Once issued the doctor cannot change the bill.
    let (status, _) = call(
        &app,
        &doctor,
        Method::PATCH,
        &format!("/api/v1/invoices/{bill}"),
        Some(json!({ "items": [{ "description": "x", "unit_price_paise": 1 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Another clinic cannot see or change the bill.
    let beta = app.token(BETA_OWNER);
    for (method, body) in [
        (Method::GET, None),
        (Method::PATCH, Some(json!({ "notes": "x" }))),
    ] {
        let (status, _) = app
            .send(
                method,
                BETA,
                &format!("/api/v1/invoices/{bill}"),
                Some(&beta),
                body,
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    app.finish().await;
}

async fn collect_bill_without_visit(app: &TestApp, owner: &str, patient: &str) -> String {
    let (status, bill) = call(
        app,
        owner,
        Method::POST,
        "/api/v1/invoices",
        Some(json!({ "patient_id": patient,
                     "items": [{ "description": "Walk-in", "unit_price_paise": 1_000 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{bill}");
    id_of(&bill)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn remind_re_raises_the_doctors_notification_once_a_minute() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let (doctor, member) = new_member(&app, clinic, "doctor").await;
    let practitioner = on_rota(&app, clinic, member, branch(&app, clinic).await, "Dr Rao").await;
    let patient = register(&app, &owner, "Meera Shah").await;
    let token = walk_in(&app, &owner, &patient, Some(practitioner)).await;
    let path = format!("/api/v1/queue/{token}/remind");

    // The doctor reads everything: nothing is unread.
    post_ok(&app, &doctor, "/api/v1/notifications/read-all", None).await;
    assert_eq!(count(&app, &doctor).await, 0);

    // The assistant presses remind: the same row is unread again, not a second one.
    let reminded = post_ok(&app, &assistant, &path, None).await;
    assert_eq!(reminded["id"], token.as_str());
    assert_eq!(reminded["status"], "waiting");
    assert!(reminded["reminded_at"].is_string());
    assert_eq!(token_rows(&app, &token, "patient_waiting").await, 1);
    assert_eq!(count(&app, &doctor).await, 1);
    assert_eq!(badge(&app, &doctor).await, 1);
    let row = about_token(&feed(&app, &doctor).await, "patient_waiting", &token);
    assert_eq!(row.len(), 1);
    assert_eq!(row[0]["read"], false);
    assert!(row[0]["handled"].is_null());

    // A second press inside the minute is refused, with the wait.
    let (status, body) = call(&app, &assistant, Method::POST, &path, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "remind_too_soon");
    let wait = body["error"]["retry_after_seconds"].as_i64().unwrap();
    assert!((1..=60).contains(&wait), "{wait}");

    // After the minute the doctor, who has read it again, is re-raised once more.
    post_ok(&app, &doctor, "/api/v1/notifications/read-all", None).await;
    assert_eq!(count(&app, &doctor).await, 0);
    sqlx::query(
        "update aarogyam.queue_tokens set last_reminded_at = now() - interval '61 seconds' where id = $1",
    )
    .bind(uuid_of(&token))
    .execute(&app.owner)
    .await
    .unwrap();
    post_ok(&app, &owner, &path, None).await;
    assert_eq!(count(&app, &doctor).await, 1);

    // A role without either permission can't; another clinic gets a 404.
    let (status, _) = call(&app, &nothing, Method::POST, &path, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &path,
            Some(&app.token(BETA_OWNER)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // A called token can't be reminded about.
    post_ok(&app, &owner, &format!("/api/v1/queue/{token}/call"), None).await;
    let (status, body) = call(&app, &assistant, Method::POST, &path, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["error"]["code"], "not_waiting");

    app.finish().await;
}
