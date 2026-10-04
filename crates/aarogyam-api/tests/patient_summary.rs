//! The patient list and record carry money, the next booking and recalls, and the list filters.
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

async fn register(app: &TestApp, token: &str, name: &str) -> String {
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn issued_bill(app: &TestApp, token: &str, patient: &str, paise: i64) -> String {
    let items = json!([{ "description": "Work", "unit_price_paise": paise }]);
    let (status, bill) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/invoices",
            Some(token),
            Some(json!({ "patient_id": patient, "items": items })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{bill}");
    let id = bill["id"].as_str().unwrap().to_owned();
    let (status, bill) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/invoices/{id}/issue"),
            Some(token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{bill}");
    id
}

async fn pay(
    app: &TestApp,
    token: &str,
    key: &str,
    patient: &str,
    bill: &str,
    paise: i64,
) -> String {
    let body = json!({ "patient_id": patient, "method": "cash", "amount_paise": paise,
                       "allocations": [{ "invoice_id": bill, "amount_paise": paise }] });
    let (status, payment) = app
        .send_with(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(token),
            Some(body),
            &[("idempotency-key", key)],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{payment}");
    payment["id"].as_str().unwrap().to_owned()
}

async fn post(app: &TestApp, token: &str, path: &str, body: Option<Value>) -> Value {
    let (status, value) = app.send(Method::POST, ALPHA, path, Some(token), body).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    value
}

async fn list(app: &TestApp, token: &str, path: &str, body: Option<Value>) -> Vec<Value> {
    let method = if body.is_some() {
        Method::POST
    } else {
        Method::GET
    };
    let (status, value) = app.send(method, ALPHA, path, Some(token), body).await;
    assert_eq!(status, StatusCode::OK, "{value}");
    value["items"].as_array().unwrap().clone()
}

fn find<'a>(items: &'a [Value], id: &str) -> Option<&'a Value> {
    items.iter().find(|item| item["id"] == id)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn summaries_count_bills_payments_voids_bookings_and_recalls() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let priya = register(&app, &owner, "Priya Sharma").await;
    let ravi = register(&app, &owner, "Ravi Kumar").await;
    let meera = register(&app, &owner, "Meera Shah").await;

    // Priya: bills of 1,000 and 500 (void) and 300; pays 400 and 200 (void) and 100.
    let bill = issued_bill(&app, &owner, &priya, 100_000).await;
    let voided = issued_bill(&app, &owner, &priya, 50_000).await;
    let third = issued_bill(&app, &owner, &priya, 30_000).await;
    pay(&app, &desk, "key-0000-0001", &priya, &bill, 40_000).await;
    let mistake = pay(&app, &desk, "key-0000-0002", &priya, &third, 20_000).await;
    pay(&app, &desk, "key-0000-0003", &priya, &third, 10_000).await;
    post(
        &app,
        &owner,
        &format!("/api/v1/payments/{mistake}/void"),
        Some(json!({ "reason": "Entered twice" })),
    )
    .await;
    post(
        &app,
        &owner,
        &format!("/api/v1/invoices/{voided}/void"),
        Some(json!({ "reason": "Wrong patient" })),
    )
    .await;
    // Ravi is settled in full.
    let paid = issued_bill(&app, &owner, &ravi, 20_000).await;
    pay(&app, &desk, "key-0000-0004", &ravi, &paid, 20_000).await;

    // A next booking for Priya (a cancelled earlier one and a past one don't count), and a recall for Meera.
    sqlx::raw_sql(
        "insert into aarogyam.practitioners (org_id, id, display_name)
           select id, '01900000-0000-7000-8000-00000000d001', 'Dr Arun Rao'
           from aarogyam.organizations where slug = 'alpha'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    sqlx::query(
        "insert into aarogyam.appointments (org_id, patient_id, practitioner_id, branch_id, starts_at, ends_at, status, cancel_reason)
           select o.id, $1::uuid, '01900000-0000-7000-8000-00000000d001',
                  (select id from aarogyam.branches b where b.org_id = o.id limit 1), t.starts, t.starts + interval '30 minutes', t.status,
                  case when t.status = 'cancelled' then 'x' end
           from aarogyam.organizations o,
                (values (now() + interval '2 days', 'cancelled'),
                        (now() + interval '9 days', 'confirmed'),
                        (now() + interval '5 days', 'booked'),
                        (now() - interval '3 days', 'booked')) as t(starts, status)
           where o.slug = 'alpha';",
    )
    .bind(&priya)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, recall) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{meera}/recalls"),
            Some(&desk),
            Some(json!({ "due_on": "2020-01-01", "reason": "Cleaning" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{recall}");

    let items = list(&app, &desk, "/api/v1/patients", None).await;
    let p = find(&items, &priya).unwrap();
    assert_eq!(p["balance_paise"], 100_000 + 30_000 - 40_000 - 10_000);
    assert_eq!(p["lifetime_paid_paise"], 40_000 + 10_000);
    assert_eq!(p["next_appointment"]["practitioner"], "Dr Arun Rao");
    assert!(p["next_appointment"]["starts_at"].is_string());
    assert_eq!(p["recall_due"], false);
    let r = find(&items, &ravi).unwrap();
    assert_eq!(r["balance_paise"], 0);
    assert_eq!(r["lifetime_paid_paise"], 20_000);
    assert_eq!(r["next_appointment"], Value::Null);
    assert_eq!(find(&items, &meera).unwrap()["recall_due"], true);

    // The record and the search carry the same numbers.
    let (status, record) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{priya}"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(record["balance_paise"], 80_000);
    assert_eq!(record["next_appointment"]["practitioner"], "Dr Arun Rao");
    let found = list(
        &app,
        &desk,
        "/api/v1/patients/search",
        Some(json!({ "q": "Priya" })),
    )
    .await;
    assert_eq!(found[0]["balance_paise"], 80_000);

    // Filters, in the list and in the search.
    let ids = |items: &[Value]| -> Vec<String> {
        items
            .iter()
            .map(|i| i["id"].as_str().unwrap().to_owned())
            .collect()
    };
    let owing = list(&app, &desk, "/api/v1/patients?with_balance=true", None).await;
    assert_eq!(ids(&owing), vec![priya.clone()]);
    let due = list(&app, &desk, "/api/v1/patients?recalls_due=true", None).await;
    assert_eq!(ids(&due), vec![meera.clone()]);
    let month = list(&app, &desk, "/api/v1/patients?new_this_month=true", None).await;
    assert_eq!(month.len(), 3);
    let both = list(
        &app,
        &desk,
        "/api/v1/patients/search",
        Some(json!({ "with_balance": true, "recalls_due": true })),
    )
    .await;
    assert_eq!(both.len(), 0);
    let named = list(
        &app,
        &desk,
        "/api/v1/patients/search",
        Some(json!({ "q": "Ravi", "with_balance": true })),
    )
    .await;
    assert_eq!(named.len(), 0);
    let named = list(
        &app,
        &desk,
        "/api/v1/patients/search",
        Some(json!({ "q": "Priya", "with_balance": true })),
    )
    .await;
    assert_eq!(named.len(), 1);

    // Registered last month: not new this month.
    sqlx::raw_sql(
        "alter table aarogyam.patients disable trigger user;
         update aarogyam.patients set created_at = now() - interval '70 days' where full_name = 'Ravi Kumar';
         alter table aarogyam.patients enable trigger user;",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let month = list(&app, &desk, "/api/v1/patients?new_this_month=true", None).await;
    assert_eq!(month.len(), 2);
    assert!(find(&month, &ravi).is_none());

    // Without billing.read the money stays hidden and the balance filter is refused.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/patients?with_balance=true",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&nothing), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Another clinic never sees Priya.
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(
            Method::GET,
            BETA,
            &format!("/api/v1/patients/{priya}"),
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}
