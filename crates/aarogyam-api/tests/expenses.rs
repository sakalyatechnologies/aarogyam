//! Expenses and the Analytics report on a real database: who may record, list and void, the
//! system categories every clinic gets, what the report counts, money hidden without
//! `finance.view`, and that none of it crosses clinics.
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
use sakalya_db::{DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Date, Duration, OffsetDateTime, UtcOffset};

fn today() -> Date {
    OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date()
}

async fn record(app: &TestApp, host: &str, token: &str, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        "/api/v1/expenses",
        Some(token),
        Some(body),
    )
    .await
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> String {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value["id"]
        .as_str()
        .or_else(|| value["appointment"]["id"].as_str())
        .unwrap()
        .to_owned()
}

/// Gives Alpha's `nothing` role these permissions.
async fn grant_nothing_role(app: &TestApp, permissions: &[&str]) {
    for permission in permissions {
        sqlx::query(
            "insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
             select r.org_id, r.id, $1, 'all' from aarogyam.roles r
             join aarogyam.organizations o on o.id = r.org_id
             where o.slug = 'alpha' and r.key = 'nothing'",
        )
        .bind(permission)
        .execute(&app.owner)
        .await
        .unwrap();
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn owners_record_list_and_void_expenses() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today().to_string();

    let (status, rent) = record(
        &app,
        ALPHA,
        &owner,
        json!({ "category": "rent", "spent_on": day, "amount_paise": 2_500_000, "note": " October " }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{rent}");
    assert_eq!(rent["category"], "rent");
    assert_eq!(rent["category_name"], "Rent");
    assert_eq!(rent["note"], "October");
    assert_eq!(rent["status"], "recorded");
    let (status, _) = record(
        &app,
        ALPHA,
        &owner,
        json!({ "category": "electricity", "spent_on": day, "amount_paise": 300_000 }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    for bad in [
        json!({ "category": "rent", "spent_on": day, "amount_paise": 0 }),
        json!({ "category": "rent", "spent_on": day, "amount_paise": -5 }),
        json!({ "category": "rent", "spent_on": (today() + Duration::days(2)).to_string(), "amount_paise": 100 }),
        json!({ "category": "rent", "spent_on": "07/10/2026", "amount_paise": 100 }),
        json!({ "category": "rent", "spent_on": day, "amount_paise": 100, "note": "x".repeat(301) }),
    ] {
        let (status, body) = record(&app, ALPHA, &owner, bad.clone()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad} {body}");
    }
    let (status, _) = record(
        &app,
        ALPHA,
        &owner,
        json!({ "category": "travel", "spent_on": day, "amount_paise": 100 }),
    )
    .await;
    assert!(status.is_client_error());

    let path = format!("/api/v1/expenses?from={day}&to={day}");
    let (status, list) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["items"].as_array().unwrap().len(), 2);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/expenses?from={day}&to=2020-01-01"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let id = rent["id"].as_str().unwrap();
    let void = format!("/api/v1/expenses/{id}/void");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &void,
            Some(&owner),
            Some(json!({ "reason": "x" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, voided) = app
        .send(
            Method::POST,
            ALPHA,
            &void,
            Some(&owner),
            Some(json!({ "reason": "Entered twice" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{voided}");
    assert_eq!(voided["status"], "void");
    assert_eq!(voided["void_reason"], "Entered twice");
    assert!(voided["voided_at"].is_string());
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &void,
            Some(&owner),
            Some(json!({ "reason": "Entered twice" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/expenses/01900000-0000-7000-8000-00000000ffff/void",
            Some(&owner),
            Some(json!({ "reason": "Entered twice" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // A voided expense can't be edited back, even by a direct query.
    let error = app
        .api_db()
        .scoped(&Scope::tenant(app.clinic_id("alpha").await), async |tx| {
            sqlx::query("update aarogyam.expenses set amount_paise = 1, status = 'recorded'")
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await;
    assert!(error.is_err());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn expenses_need_their_permissions() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let day = today().to_string();
    let (_, rent) = record(
        &app,
        ALPHA,
        &owner,
        json!({ "category": "rent", "spent_on": day, "amount_paise": 100_000 }),
    )
    .await;
    let void = format!("/api/v1/expenses/{}/void", rent["id"].as_str().unwrap());
    let reason = json!({ "reason": "Entered twice" });
    for person in [ALPHA_FRONT_DESK, ALPHA_ASSISTANT, ALPHA_NOTHING] {
        let token = app.token(person);
        let (status, _) = record(
            &app,
            ALPHA,
            &token,
            json!({ "category": "rent", "spent_on": day, "amount_paise": 100 }),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = app
            .send(Method::GET, ALPHA, "/api/v1/expenses", Some(&token), None)
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = app
            .send(
                Method::POST,
                ALPHA,
                &void,
                Some(&token),
                Some(reason.clone()),
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = app
            .send(
                Method::GET,
                ALPHA,
                "/api/v1/reports/analytics",
                Some(&token),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/expenses", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

/// Beta's owner can't see or void Alpha's expenses, nor see them in Beta's analytics; every
/// clinic has its own six system categories; row-level security hides the rows directly too.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn expenses_stay_in_their_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let day = today().to_string();
    let (_, rent) = record(
        &app,
        ALPHA,
        &owner,
        json!({ "category": "rent", "spent_on": day, "amount_paise": 100_000 }),
    )
    .await;
    let id = rent["id"].as_str().unwrap();
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &format!("/api/v1/expenses/{id}/void"),
            Some(&beta),
            Some(json!({ "reason": "Not ours" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, list) = app
        .send(Method::GET, BETA, "/api/v1/expenses", Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"], json!([]));
    // Alpha's token on Beta's host is not a member there.
    let (status, _) = app
        .send(Method::GET, BETA, "/api/v1/expenses", Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, report) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/reports/analytics",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    let spent: i64 = report["buckets"]
        .as_array()
        .unwrap()
        .iter()
        .map(|b| b["expenses_paise"].as_i64().unwrap())
        .sum();
    assert_eq!(spent, 0);

    let (alpha, beta_id) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();
    for (table, at_alpha, at_beta) in [("expenses", 1, 0), ("expense_categories", 6, 6)] {
        let count = async |clinic| {
            db.scoped(&Scope::tenant(clinic), async |tx| {
                sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                    "select count(*) from aarogyam.{table}"
                )))
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
            })
            .await
            .unwrap()
        };
        assert_eq!(count(alpha).await, at_alpha, "{table} at Alpha");
        assert_eq!(count(beta_id).await, at_beta, "{table} at Beta");
    }
    // Beta can't file an expense under Alpha's category, even directly.
    let alpha_rent: uuid::Uuid = sqlx::query_scalar(
        "select id from aarogyam.expense_categories where org_id = $1 and key = 'rent'",
    )
    .bind(alpha)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let beta_member: uuid::Uuid =
        sqlx::query_scalar("select id from aarogyam.memberships where org_id = $1")
            .bind(beta_id)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let error = db
        .scoped(&Scope::tenant(beta_id), async |tx| {
            sqlx::query(
                "insert into aarogyam.expenses (category_id, spent_on, amount_paise, recorded_by)
                 values ($1, current_date, 100, $2)",
            )
            .bind(alpha_rent)
            .bind(beta_member)
            .execute(tx.conn())
            .await
            .map_err(DbError::from)
        })
        .await;
    assert!(error.is_err());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn analytics_counts_chairs_money_and_patients() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let today = today();
    let tomorrow = today + Duration::days(1);

    let doctor = created(
        &app,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha" }),
    )
    .await;
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "09:00", "ends": "17:00" }))
        .collect();
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{doctor}/working-hours"),
            Some(&owner),
            Some(json!({ "shifts": shifts })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let chair = created(&app, &owner, "/api/v1/rooms", json!({ "name": "Chair 1" })).await;
    let patient = created(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Ravi Kumar", "age_years": 40, "phone": "+919876543210" }),
    )
    .await;
    for (start, end, kind) in [("10:00", "10:30", "new"), ("11:00", "12:00", "procedure")] {
        created(
            &app,
            &owner,
            "/api/v1/appointments",
            json!({
                "patient_id": patient, "practitioner_id": doctor, "room_id": chair, "kind": kind,
                "starts_at": format!("{tomorrow}T{start}:00+05:30"),
                "ends_at": format!("{tomorrow}T{end}:00+05:30")
            }),
        )
        .await;
    }
    let (status, payment) = app
        .send_with(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(&owner),
            Some(json!({ "patient_id": patient, "method": "cash", "amount_paise": 80_000 })),
            &[("idempotency-key", "analytics-test-0001")],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{payment}");
    let item = created(
        &app,
        &owner,
        "/api/v1/inventory-items",
        json!({ "name": "Gloves", "category": "consumable", "unit": "box", "reorder_level": 1 }),
    )
    .await;
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/stock/receive",
            Some(&owner),
            Some(json!({ "item_id": item, "quantity": 3, "unit_cost_paise": 1_000 })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    for (category, amount) in [("material", 500), ("salary", 2_000_000)] {
        let (status, _) = record(
            &app,
            ALPHA,
            &owner,
            json!({ "category": category, "spent_on": today.to_string(), "amount_paise": amount }),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED);
    }

    let path = format!("/api/v1/reports/analytics?from={today}&to={tomorrow}&bucket=week");
    let (status, report) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["bucket"], "week");
    assert_eq!(report["money_visible"], true);
    assert_eq!(report["open_minutes_per_day"], 540);
    assert_eq!(report["chairs"][0]["id"], chair.as_str());
    let buckets = report["buckets"].as_array().unwrap();
    let sum = |field: &str| -> i64 { buckets.iter().map(|b| b[field].as_i64().unwrap()).sum() };
    assert_eq!(sum("income_paise"), 80_000);
    assert_eq!(sum("stock_purchases_paise"), 3_000);
    assert_eq!(sum("expenses_paise"), 2_003_500);
    let material: i64 = buckets
        .iter()
        .flat_map(|b| b["expenses"].as_array().unwrap())
        .filter(|e| e["category"] == "material")
        .map(|e| e["amount_paise"].as_i64().unwrap())
        .sum();
    assert_eq!(material, 3_500);
    let (booked, open): (i64, i64) =
        buckets
            .iter()
            .map(|b| &b["chair_utilization"][0])
            .fold((0, 0), |(m, o), c| {
                (
                    m + c["booked_minutes"].as_i64().unwrap(),
                    o + c["open_minutes"].as_i64().unwrap(),
                )
            });
    assert_eq!(booked, 90);
    assert_eq!(open, 2 * 540);
    let new: i64 = buckets
        .iter()
        .map(|b| b["patients"]["new"].as_i64().unwrap())
        .sum();
    assert_eq!(new, 1);
    let count = |list: &str, key: &str| -> i64 {
        report["patients"][list]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["key"] == key)
            .map(|c| c["count"].as_i64().unwrap())
            .unwrap()
    };
    assert_eq!(count("age_bands", "35_49"), 1);
    assert_eq!(count("visit_kinds", "new"), 1);
    assert_eq!(count("visit_kinds", "procedure"), 1);
    assert_eq!(count("referral_sources", "unknown"), 1);
    let busy: i64 = report["busy_hours"]
        .as_array()
        .unwrap()
        .iter()
        .map(|h| h["visits"].as_i64().unwrap())
        .sum();
    assert_eq!(busy, 2);

    // With analytics.view but not finance.view, the money is null.
    grant_nothing_role(&app, &["analytics.view"]).await;
    let (status, hidden) = app
        .send(
            Method::GET,
            ALPHA,
            &path,
            Some(&app.token(ALPHA_NOTHING)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{hidden}");
    assert_eq!(hidden["money_visible"], false);
    for bucket in hidden["buckets"].as_array().unwrap() {
        for field in [
            "income_paise",
            "payments",
            "expenses",
            "expenses_paise",
            "stock_purchases_paise",
        ] {
            assert!(bucket[field].is_null(), "{field}");
        }
    }
    assert_eq!(hidden["chairs"], report["chairs"]);

    // The default range is twelve months; bad input is refused.
    let (status, default) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/reports/analytics",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(default["buckets"].as_array().unwrap().len(), 12);
    assert_eq!(default["to"], today.to_string());
    for query in [
        "bucket=day",
        "from=2020-01-01&to=2026-01-01",
        "from=2026-02-01&to=2026-01-01",
        "from=yesterday",
    ] {
        let (status, _) = app
            .send(
                Method::GET,
                ALPHA,
                &format!("/api/v1/reports/analytics?{query}"),
                Some(&owner),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}");
    }
    app.finish().await;
}
