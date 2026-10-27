//! Stock import on a real database: a CSV checked row by row with its errors, committed once by
//! its token (a second commit returns the first result), the permissions, and that another
//! clinic can neither commit nor see a preview.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt as _;

const BOUNDARY: &str = "aarogyam-stock-boundary";

fn upload_request(host: &str, token: &str, name: &str, bytes: &[u8]) -> Request<Body> {
    let mut body = Vec::new();
    body.extend_from_slice(
        format!(
            "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: text/csv\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    Request::post("/api/v1/stock/import")
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap()
}

async fn call(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 8 * 1024 * 1024)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn upload(app: &TestApp, host: &str, token: &str, csv: &str) -> (StatusCode, Value) {
    call(
        &app.router,
        upload_request(host, token, "stock.csv", csv.as_bytes()),
    )
    .await
}

async fn commit(app: &TestApp, host: &str, token: &str, import: &str) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        "/api/v1/stock/import/commit",
        Some(token),
        Some(json!({ "token": import })),
    )
    .await
}

const CSV: &str = "name,category,unit,reorder level,max level,quantity,unit cost,batch,expiry,supplier\n\
Gloves,consumable,box,10,50,20,45.50,B1,2027-03-31,Depot\n\
Composite A2,restorative,pack,5,,0,,,,\n\
,consumable,box,1,,1,,,,\n\
Masks,consumable,box,5,,3,,,,Nowhere Ltd\n\
Floss,consumable,box,5,,many,,,,\n";

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(clippy::too_many_lines, reason = "one scenario read top to bottom")]
async fn a_list_is_checked_then_committed_once_by_its_token() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/suppliers",
            Some(&owner),
            Some(json!({ "name": "Depot" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    // The preview names every failed row and field and changes nothing.
    let (status, preview) = upload(&app, ALPHA, &owner, CSV).await;
    assert_eq!(status, StatusCode::CREATED, "{preview}");
    assert_eq!(preview["row_count"], 5);
    assert_eq!(preview["valid_rows"], 2);
    assert_eq!(preview["error_rows"], 3);
    let fields: Vec<&str> = preview["errors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["field"].as_str().unwrap())
        .collect();
    assert_eq!(fields.len(), 3, "{preview}");
    assert!(fields.contains(&"name"), "{preview}");
    assert!(fields.contains(&"supplier"), "{preview}");
    assert!(fields.contains(&"quantity"), "{preview}");
    assert_eq!(preview["new_items"], 2);
    let (_, items) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/inventory-items",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(items["items"].as_array().unwrap().len(), 0);
    let token = preview["token"].as_str().unwrap().to_owned();

    // Another clinic holds no such preview; nothing is committed by trying.
    let (status, _) = commit(&app, BETA, &app.token(BETA_OWNER), &token).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Commit applies the passed rows.
    let (status, result) = commit(&app, ALPHA, &owner, &token).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["items_created"], 2);
    assert_eq!(result["batches_received"], 1);
    assert_eq!(result["units_received"], 20);
    assert_eq!(result["replayed"], false);
    let (_, items) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/inventory-items",
            Some(&owner),
            None,
        )
        .await;
    let gloves = items["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["item"]["name"] == "Gloves")
        .unwrap();
    assert_eq!(gloves["on_hand"], 20);
    assert_eq!(gloves["item"]["max_level"], 50);
    assert_eq!(gloves["suggested_order"], 30);
    assert_eq!(items["items"].as_array().unwrap().len(), 2);

    // The same token again returns the first result and receives nothing twice.
    let (status, again) = commit(&app, ALPHA, &owner, &token).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["replayed"], true);
    assert_eq!(again["units_received"], 20);
    let (_, items) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/inventory-items",
            Some(&owner),
            None,
        )
        .await;
    let on_hand: i64 = items["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["on_hand"].as_i64().unwrap())
        .sum();
    assert_eq!(on_hand, 20);

    // The same file again is flagged, and an existing item is updated, not duplicated.
    let (status, second) = upload(
        &app,
        ALPHA,
        &owner,
        "name,reorder level,quantity\nGloves,12,5\n",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{second}");
    assert_eq!(second["new_items"], 0);
    let (_, done) = commit(&app, ALPHA, &owner, second["token"].as_str().unwrap()).await;
    assert_eq!(done["items_created"], 0);
    assert_eq!(done["items_updated"], 1);
    assert_eq!(done["units_received"], 5);
    let (_, flagged) = upload(&app, ALPHA, &owner, CSV).await;
    assert!(
        !flagged["warnings"].as_array().unwrap().is_empty(),
        "{flagged}"
    );

    // Validation is a 400; a missing token is a 400; an unknown one is a 404.
    let (status, _) = upload(&app, ALPHA, &owner, "sku,qty\nA,1\n").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = upload(&app, ALPHA, &owner, "name,quantity\n").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = commit(&app, ALPHA, &owner, "  ").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = commit(&app, ALPHA, &owner, "no-such-token").await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Permissions: inventory.manage only.
    for token in [&assistant, &nothing] {
        let (status, _) = upload(&app, ALPHA, token, CSV).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = commit(&app, ALPHA, token, "x").await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    app.finish().await;
}
