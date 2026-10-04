//! Stock on a real database: items and suppliers, deliveries, first-expired-first-out use, the
//! database's own refusal to go below zero, the expiry list, and that none of it crosses
//! clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::{Duration, OffsetDateTime};

fn day(offset: i64) -> String {
    (OffsetDateTime::now_utc() + Duration::days(offset))
        .date()
        .to_string()
}

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

async fn item(app: &TestApp, token: &str, name: &str, reorder: i64) -> String {
    let body =
        json!({ "name": name, "category": "restorative", "unit": "box", "reorder_level": reorder });
    let (status, body) = call(
        app,
        Method::POST,
        ALPHA,
        "/api/v1/inventory-items",
        token,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn receive(
    app: &TestApp,
    token: &str,
    item: &str,
    quantity: i64,
    expiry: Option<String>,
) -> Value {
    let body = json!({ "item_id": item, "quantity": quantity, "expiry": expiry,
                       "unit_cost_paise": 4500, "batch_no": "B-1" });
    let (status, body) = call(
        app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/receive",
        token,
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body
}

async fn use_stock(app: &TestApp, token: &str, item: &str, quantity: i64) -> (StatusCode, Value) {
    let body = json!({ "item_id": item, "quantity": quantity });
    call(
        app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/use",
        token,
        Some(body),
    )
    .await
}

async fn detail(app: &TestApp, token: &str, item: &str) -> Value {
    let path = format!("/api/v1/inventory-items/{item}");
    let (status, body) = call(app, Method::GET, ALPHA, &path, token, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn items_and_suppliers_are_managed_with_permissions() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let composite = item(&app, &owner, "Composite A2", 40).await;

    // A duplicate name conflicts; a bad unit is refused.
    let dup = json!({ "name": "composite a2" });
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/inventory-items",
        &owner,
        Some(dup),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let bad = json!({ "name": "Gauze", "unit": "kg" });
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/inventory-items",
        &owner,
        Some(bad),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let path = format!("/api/v1/inventory-items/{composite}");
    let change = json!({ "reorder_level": 25, "category": "" });
    let (status, body) = call(&app, Method::PATCH, ALPHA, &path, &owner, Some(change)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["reorder_level"], 25);
    assert_eq!(body["category"], Value::Null);

    let supplier =
        json!({ "name": "Pune Dental Depot", "phone": "98200 00001", "gstin": "27AAPFU0939F1ZV" });
    let (status, supplier) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/suppliers",
        &owner,
        Some(supplier),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{supplier}");
    assert_eq!(supplier["phone"], "+919820000001");
    let spath = format!("/api/v1/suppliers/{}", supplier["id"].as_str().unwrap());
    let (status, _) = call(
        &app,
        Method::PATCH,
        ALPHA,
        &spath,
        &owner,
        Some(json!({ "active": false })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let bad = json!({ "name": "X", "gstin": "nonsense" });
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/suppliers",
        &owner,
        Some(bad),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The assistant reads but cannot change; a member with nothing cannot even read.
    for (method, path, body) in [
        (
            Method::POST,
            "/api/v1/inventory-items".to_owned(),
            Some(json!({ "name": "Gauze" })),
        ),
        (
            Method::PATCH,
            path.clone(),
            Some(json!({ "active": false })),
        ),
        (Method::DELETE, path.clone(), None),
        (
            Method::POST,
            "/api/v1/suppliers".to_owned(),
            Some(json!({ "name": "Y" })),
        ),
        (
            Method::PATCH,
            spath.clone(),
            Some(json!({ "active": true })),
        ),
        (Method::DELETE, spath.clone(), None),
        (
            Method::POST,
            "/api/v1/stock/receive".to_owned(),
            Some(json!({ "item_id": composite, "quantity": 1 })),
        ),
        (
            Method::POST,
            "/api/v1/stock/use".to_owned(),
            Some(json!({ "item_id": composite, "quantity": 1 })),
        ),
        (
            Method::POST,
            "/api/v1/stock/adjust".to_owned(),
            Some(json!({ "item_id": composite, "quantity": 1, "reason": "x" })),
        ),
    ] {
        let (status, _) = call(&app, method.clone(), ALPHA, &path, &assistant, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method} {path}");
    }
    for path in [
        "/api/v1/inventory-items",
        "/api/v1/suppliers",
        "/api/v1/stock",
        "/api/v1/stock/low",
        "/api/v1/stock/expiring",
    ] {
        let (status, _) = call(&app, Method::GET, ALPHA, path, &assistant, None).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        let (status, _) = call(&app, Method::GET, ALPHA, path, &nothing, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }

    let (status, _) = call(&app, Method::DELETE, ALPHA, &spath, &owner, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, list) = call(&app, Method::GET, ALPHA, "/api/v1/suppliers", &owner, None).await;
    assert_eq!(list["items"].as_array().unwrap().len(), 0);
    let (status, _) = call(&app, Method::DELETE, ALPHA, &path, &owner, None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = call(&app, Method::GET, ALPHA, &path, &owner, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn use_takes_the_earliest_expiry_first_and_never_goes_negative() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let gloves = item(&app, &owner, "Gloves", 10).await;
    // Later expiry arrives first; the sooner batch must still go first.
    receive(&app, &owner, &gloves, 5, Some(day(200))).await;
    let sooner = receive(&app, &owner, &gloves, 4, Some(day(90))).await;
    let sooner_batch = sooner["movements"][0]["batch_id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(sooner["stock"]["on_hand"], 9);
    assert_eq!(sooner["movements"][0]["kind"], "receive");

    let (status, used) = use_stock(&app, &owner, &gloves, 6).await;
    assert_eq!(status, StatusCode::OK, "{used}");
    let moves = used["movements"].as_array().unwrap();
    assert_eq!(moves.len(), 2);
    assert_eq!(moves[0]["batch_id"], sooner_batch.as_str());
    assert_eq!(moves[0]["quantity"], -4);
    assert_eq!(moves[1]["quantity"], -2);
    assert_eq!(used["stock"]["on_hand"], 3);
    // 3 left against a reorder level of 10: low, not critical (a fifth of 10 is 2).
    assert_eq!(used["stock"]["status"], "low");

    // Asking for more than is there takes nothing.
    let (status, body) = use_stock(&app, &owner, &gloves, 4).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(detail(&app, &owner, &gloves).await["stock"]["on_hand"], 3);
    let (status, _) = use_stock(&app, &owner, &gloves, 0).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, used) = use_stock(&app, &owner, &gloves, 3).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(used["stock"]["status"], "critical");

    // The history is there, newest first, and all of it is append-only.
    let history = detail(&app, &owner, &gloves).await;
    assert_eq!(history["movements"].as_array().unwrap().len(), 5);
    assert_eq!(history["movements"][0]["kind"], "use");

    // The database itself refuses a negative quantity, a rewritten delivery and an edited log.
    let refused = [
        "update aarogyam.stock_batches set quantity = -1",
        "update aarogyam.stock_batches set received_quantity = 99",
        "update aarogyam.stock_batches set unit_cost_paise = 1",
        "update aarogyam.stock_movements set quantity = -9",
        "delete from aarogyam.stock_movements",
    ];
    for statement in refused {
        assert!(
            sqlx::query(statement).execute(&app.owner).await.is_err(),
            "{statement}"
        );
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn expired_stock_is_not_used_and_shows_in_the_expiring_list() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let cartridges = item(&app, &owner, "Anesthetic cartridges", 5).await;
    let expired = receive(&app, &owner, &cartridges, 10, Some(day(-10))).await;
    let expired_batch = expired["movements"][0]["batch_id"]
        .as_str()
        .unwrap()
        .to_owned();
    receive(&app, &owner, &cartridges, 6, Some(day(15))).await;
    receive(&app, &owner, &cartridges, 20, Some(day(400))).await;
    let other = item(&app, &owner, "Polish cups", 1).await;
    receive(&app, &owner, &other, 50, Some(day(100))).await;

    let (status, list) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/stock/expiring",
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let rows = list["items"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["quantity"], 10);
    assert!(rows[0]["days_left"].as_i64().unwrap() < 0);
    assert_eq!(rows[1]["quantity"], 6);
    let (_, wider) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/stock/expiring?days=120",
        &owner,
        None,
    )
    .await;
    assert_eq!(wider["items"].as_array().unwrap().len(), 3);
    let (status, _) = call(
        &app,
        Method::GET,
        ALPHA,
        "/api/v1/stock/expiring?days=-1",
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // 36 on hand but only 26 usable; using 27 fails and 26 works, never touching the expired.
    let (status, _) = use_stock(&app, &owner, &cartridges, 27).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, used) = use_stock(&app, &owner, &cartridges, 8).await;
    assert_eq!(status, StatusCode::OK, "{used}");
    assert_eq!(used["movements"][0]["quantity"], -6);
    assert_eq!(used["stock"]["on_hand"], 28);

    // Write the expired batch off; a batch in date cannot be written off.
    let path = format!("/api/v1/stock/batches/{expired_batch}/expire");
    let (status, off) = call(&app, Method::POST, ALPHA, &path, &owner, Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK, "{off}");
    assert_eq!(off["movements"][0]["kind"], "expire");
    assert_eq!(off["movements"][0]["quantity"], -10);
    assert_eq!(off["movements"][0]["reason"], "expired");
    assert_eq!(off["stock"]["on_hand"], 18);
    let (status, _) = call(&app, Method::POST, ALPHA, &path, &owner, Some(json!({}))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let live = detail(&app, &owner, &cartridges).await["batches"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let live_path = format!("/api/v1/stock/batches/{live}/expire");
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        &live_path,
        &owner,
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn adjustments_summary_and_todays_attention_list() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let front_desk = app.token(ALPHA_FRONT_DESK);
    let composite = item(&app, &owner, "Composite A2", 40).await;
    let gauze = item(&app, &owner, "Gauze", 10).await;
    let cups = item(&app, &owner, "Polish cups", 10).await;
    let drills = item(&app, &owner, "Burs", 0).await;
    receive(&app, &owner, &composite, 4, Some(day(300))).await;
    receive(&app, &owner, &gauze, 8, None).await;
    receive(&app, &owner, &cups, 12, Some(day(10))).await;
    receive(&app, &owner, &drills, 3, None).await;

    let (status, summary) =
        call(&app, Method::GET, ALPHA, "/api/v1/stock", &front_desk, None).await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(
        summary["counts"],
        json!({ "critical": 1, "low": 1, "expiring": 1, "ok": 1 })
    );
    let names: Vec<&str> = summary["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["item"]["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Composite A2", "Gauze", "Polish cups", "Burs"]);
    let (_, low) = call(&app, Method::GET, ALPHA, "/api/v1/stock/low", &owner, None).await;
    assert_eq!(low["items"].as_array().unwrap().len(), 2);

    // Today lists the low stock for roles that may see stock.
    let (status, today) = call(&app, Method::GET, ALPHA, "/api/v1/today", &front_desk, None).await;
    assert_eq!(status, StatusCode::OK, "{today}");
    let alerts = today["low_stock"].as_array().unwrap();
    assert_eq!(alerts.len(), 2);
    assert_eq!(alerts[0]["name"], "Composite A2");
    assert_eq!(alerts[0]["status"], "critical");

    // A recount: take two off, then add found stock with an expiry; a reason is required.
    let take = json!({ "item_id": gauze, "quantity": -2, "reason": "Counted on the shelf" });
    let (status, body) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/adjust",
        &owner,
        Some(take),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["stock"]["on_hand"], 6);
    assert_eq!(body["movements"][0]["kind"], "adjust");
    let found = json!({ "item_id": gauze, "quantity": 30, "reason": "Found in the store room", "expiry": day(365) });
    let (status, body) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/adjust",
        &owner,
        Some(found),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["stock"]["on_hand"], 36);
    assert_eq!(body["stock"]["status"], "ok");
    let no_reason = json!({ "item_id": gauze, "quantity": 1, "reason": "  " });
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/adjust",
        &owner,
        Some(no_reason),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let too_many = json!({ "item_id": gauze, "quantity": -37, "reason": "typo" });
    let (status, _) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/stock/adjust",
        &owner,
        Some(too_many),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(
        &app,
        Method::DELETE,
        ALPHA,
        &format!("/api/v1/inventory-items/{gauze}"),
        &owner,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn another_clinic_cannot_see_or_touch_stock() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let gloves = item(&app, &owner, "Gloves", 10).await;
    let batch = receive(&app, &owner, &gloves, 5, Some(day(-1))).await["movements"][0]["batch_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (_, supplier) = call(
        &app,
        Method::POST,
        ALPHA,
        "/api/v1/suppliers",
        &owner,
        Some(json!({ "name": "Depot" })),
    )
    .await;
    let supplier = supplier["id"].as_str().unwrap().to_owned();

    let item_path = format!("/api/v1/inventory-items/{gloves}");
    let supplier_path = format!("/api/v1/suppliers/{supplier}");
    let expire_path = format!("/api/v1/stock/batches/{batch}/expire");
    let attempts = [
        (Method::GET, item_path.clone(), None),
        (
            Method::PATCH,
            item_path.clone(),
            Some(json!({ "name": "Mine" })),
        ),
        (Method::DELETE, item_path.clone(), None),
        (
            Method::PATCH,
            supplier_path.clone(),
            Some(json!({ "name": "Mine" })),
        ),
        (Method::DELETE, supplier_path.clone(), None),
        (Method::POST, expire_path, Some(json!({}))),
        (
            Method::POST,
            "/api/v1/stock/use".to_owned(),
            Some(json!({ "item_id": gloves, "quantity": 1 })),
        ),
        (
            Method::POST,
            "/api/v1/stock/adjust".to_owned(),
            Some(json!({ "item_id": gloves, "quantity": 1, "reason": "x" })),
        ),
        (
            Method::POST,
            "/api/v1/stock/receive".to_owned(),
            Some(json!({ "item_id": gloves, "quantity": 1 })),
        ),
    ];
    for (method, path, body) in attempts {
        let (status, _) = call(&app, method.clone(), BETA, &path, &beta, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}");
    }
    // Beta's own item cannot be received from Alpha's supplier.
    let own = json!({ "name": "Beta gloves" });
    let (_, own) = call(
        &app,
        Method::POST,
        BETA,
        "/api/v1/inventory-items",
        &beta,
        Some(own),
    )
    .await;
    let from_alpha = json!({ "item_id": own["id"], "quantity": 1, "supplier_id": supplier });
    let (status, _) = call(
        &app,
        Method::POST,
        BETA,
        "/api/v1/stock/receive",
        &beta,
        Some(from_alpha),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Lists show only the caller's clinic.
    let (_, list) = call(
        &app,
        Method::GET,
        BETA,
        "/api/v1/inventory-items",
        &beta,
        None,
    )
    .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    let (_, expiring) = call(
        &app,
        Method::GET,
        BETA,
        "/api/v1/stock/expiring",
        &beta,
        None,
    )
    .await;
    assert_eq!(expiring["items"].as_array().unwrap().len(), 0);
    let (_, suppliers) = call(&app, Method::GET, BETA, "/api/v1/suppliers", &beta, None).await;
    assert_eq!(suppliers["items"].as_array().unwrap().len(), 0);
    // Alpha's stock is untouched.
    assert_eq!(detail(&app, &owner, &gloves).await["stock"]["on_hand"], 5);
    app.finish().await;
}
