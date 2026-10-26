//! Purchase orders on a real database: draft, send, receive into stock (partly, then the rest),
//! the state rules, costs, permissions, and that another clinic can neither see nor touch an
//! order.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn make(app: &TestApp, token: &str, path: &str, body: Value) -> String {
    let (status, body) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn order(app: &TestApp, token: &str, id: &str) -> Value {
    let (status, body) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/purchase-orders/{id}"),
            Some(token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn an_order_is_sent_and_received_into_stock() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let supplier = make(
        &app,
        &owner,
        "/api/v1/suppliers",
        json!({ "name": "Depot" }),
    )
    .await;
    let gloves = make(
        &app,
        &owner,
        "/api/v1/inventory-items",
        json!({ "name": "Gloves", "unit": "box", "reorder_level": 5 }),
    )
    .await;
    let masks = make(
        &app,
        &owner,
        "/api/v1/inventory-items",
        json!({ "name": "Masks", "unit": "box" }),
    )
    .await;

    // A draft keeps its lines and costs; the total is their sum.
    let draft = make(
        &app,
        &owner,
        "/api/v1/purchase-orders",
        json!({ "supplier_id": supplier, "expected_on": "2027-01-15", "notes": "Monthly",
                "lines": [{ "item_id": gloves, "quantity": 10, "unit_cost_paise": 4500 },
                          { "item_id": masks, "quantity": 4, "unit_cost_paise": 1000 }] }),
    )
    .await;
    let body = order(&app, &owner, &draft).await;
    assert_eq!(body["status"], "draft");
    assert!(body["number"].as_str().unwrap().starts_with("PO-"));
    assert_eq!(body["total_paise"], 49_000);
    assert_eq!(body["lines"].as_array().unwrap().len(), 2);
    let (_, list) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/purchase-orders?status=draft",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 1);

    // A draft can be changed, then sent; a sent order can't have its lines changed.
    let (status, changed) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/purchase-orders/{draft}"),
            Some(&owner),
            Some(json!({ "notes": "Monthly, urgent", "expected_on": null })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["notes"], "Monthly, urgent");
    assert!(changed["expected_on"].is_null());
    let path = format!("/api/v1/purchase-orders/{draft}");
    let (status, sent) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "status": "ordered" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert_eq!(sent["status"], "ordered");
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "lines": [{ "item_id": gloves, "quantity": 1 }] })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = app
        .send(Method::DELETE, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Receiving more than is still to come is refused; a part receipt makes a batch.
    let receive = format!("{path}/receive");
    let glove_line = sent["lines"]
        .as_array()
        .unwrap()
        .iter()
        .find(|l| l["item_id"] == json!(gloves))
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &receive,
            Some(&owner),
            Some(json!({ "lines": [{ "line_id": glove_line, "quantity": 11 }] })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, partly) = app
        .send(
            Method::POST,
            ALPHA,
            &receive,
            Some(&owner),
            Some(json!({ "lines": [{ "line_id": glove_line, "quantity": 6,
                                      "batch_no": "G-1", "expiry": "2027-06-30" }] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{partly}");
    assert_eq!(partly["status"], "ordered");
    assert_eq!(partly["receipts"].as_array().unwrap().len(), 1);
    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/inventory-items/{gloves}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(detail["stock"]["on_hand"], 6);

    // Nothing named receives the rest, and the order is then received.
    let (status, done) = app
        .send(Method::POST, ALPHA, &receive, Some(&owner), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["status"], "received");
    let (_, detail) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/inventory-items/{gloves}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(detail["stock"]["on_hand"], 10);
    let (status, _) = app
        .send(Method::POST, ALPHA, &receive, Some(&owner), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // A draft is deleted; bad input is a 400.
    let spare = make(
        &app,
        &owner,
        "/api/v1/purchase-orders",
        json!({ "supplier_id": supplier, "lines": [{ "item_id": masks, "quantity": 1 }] }),
    )
    .await;
    let (status, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            &format!("/api/v1/purchase-orders/{spare}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let bad = [
        json!({ "supplier_id": supplier, "lines": [{ "item_id": masks, "quantity": 0 }] }),
        json!({ "supplier_id": supplier, "lines": [] }),
        json!({ "supplier_id": "nope", "lines": [{ "item_id": masks, "quantity": 1 }] }),
        json!({ "supplier_id": supplier, "expected_on": "soon",
                "lines": [{ "item_id": masks, "quantity": 1 }] }),
    ];
    for body in bad {
        let (status, _) = app
            .send(
                Method::POST,
                ALPHA,
                "/api/v1/purchase-orders",
                Some(&owner),
                Some(body.clone()),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    }
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/purchase-orders?status=lost",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // The assistant reads but can't change; a member with nothing can't even read.
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, seen) = app
        .send(Method::GET, ALPHA, &path, Some(&assistant), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(seen["total_paise"].is_null(), "costs need finance.view");
    let (status, listed) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/purchase-orders",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    for order in listed["items"].as_array().unwrap() {
        assert!(order["total_paise"].is_null(), "the list hides costs too");
    }
    for line in seen["lines"].as_array().unwrap() {
        assert!(line["unit_cost_paise"].is_null());
    }
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/purchase-orders",
            Some(&assistant),
            Some(json!({ "supplier_id": supplier,
                         "lines": [{ "item_id": masks, "quantity": 1 }] })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/purchase-orders",
            Some(&nothing),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_cannot_see_or_touch_an_order() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let supplier = make(
        &app,
        &owner,
        "/api/v1/suppliers",
        json!({ "name": "Depot" }),
    )
    .await;
    let gloves = make(
        &app,
        &owner,
        "/api/v1/inventory-items",
        json!({ "name": "Gloves" }),
    )
    .await;
    let id = make(
        &app,
        &owner,
        "/api/v1/purchase-orders",
        json!({ "supplier_id": supplier, "order_now": true,
                "lines": [{ "item_id": gloves, "quantity": 3 }] }),
    )
    .await;
    let path = format!("/api/v1/purchase-orders/{id}");
    let line = order(&app, &owner, &id).await["lines"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let attempts = [
        (Method::GET, path.clone(), None),
        (
            Method::PATCH,
            path.clone(),
            Some(json!({ "notes": "Mine" })),
        ),
        (Method::DELETE, path.clone(), None),
        (
            Method::POST,
            format!("{path}/receive"),
            Some(json!({ "lines": [{ "line_id": line, "quantity": 1 }] })),
        ),
        (
            Method::POST,
            "/api/v1/purchase-orders".to_owned(),
            Some(json!({ "supplier_id": supplier,
                         "lines": [{ "item_id": gloves, "quantity": 1 }] })),
        ),
    ];
    for (method, path, body) in attempts {
        let (status, _) = app
            .send(method.clone(), BETA, &path, Some(&beta), body)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}");
    }
    let (_, list) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/purchase-orders",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 0);
    assert_eq!(order(&app, &owner, &id).await["receipts"], json!([]));
    app.finish().await;
}
