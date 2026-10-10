//! Links to a patient's records: a chosen set of kinds (chart, X-rays, bills), a chosen lifetime,
//! opened by the patient with the PIN on the clinic's host.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt;

fn png() -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
    bytes.resize(1024, 9);
    bytes
}

async fn post(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn fetch(app: &TestApp, host: &str, path: &str) -> (StatusCode, Vec<u8>) {
    let request = Request::get(path)
        .header("host", host)
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    (
        status,
        to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap()
            .to_vec(),
    )
}

async fn open(app: &TestApp, token: &str, pin: &str) -> (StatusCode, Value) {
    let path = format!("/api/v1/shared/{token}/records");
    app.send(
        Method::POST,
        ALPHA,
        &path,
        None,
        Some(json!({ "pin": pin })),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_link_shows_only_the_chosen_records_for_the_chosen_time() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = post(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Meera Shah" }),
    )
    .await;
    let id = patient["id"].as_str().unwrap();
    post(
        &app,
        &owner,
        &format!("/api/v1/patients/{id}/dental-chart"),
        json!({ "entries": [{ "tooth": 36, "surface": "O", "finding": "caries" }] }),
    )
    .await;
    let (status, xray) = app
        .upload(
            ALPHA,
            &owner,
            id,
            &png(),
            &[("kind", "xray"), ("label", "OPG")],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{xray}");
    let draft = post(
        &app,
        &owner,
        "/api/v1/invoices",
        json!({ "patient_id": id,
        "items": [{ "description": "Scaling", "unit_price_paise": 100_000 }] }),
    )
    .await;
    post(
        &app,
        &owner,
        &format!("/api/v1/invoices/{}/issue", draft["id"].as_str().unwrap()),
        json!({}),
    )
    .await;

    // Bad requests and permissions: the kinds and lifetimes are checked; each kind needs its
    // own permission on top of patients.read.
    let path = format!("/api/v1/patients/{id}/record-shares");
    let make = async |host: &str, token: &str, types: Value, expires: &str| {
        app.send(
            Method::POST,
            host,
            &path,
            Some(token),
            Some(json!({ "record_types": types, "expires_in": expires })),
        )
        .await
    };
    for (types, expires) in [
        (json!([]), "24h"),
        (json!(["notes"]), "24h"),
        (json!(["chart", "chart"]), "24h"),
        (json!(["chart"]), "2h"),
    ] {
        assert_eq!(
            make(ALPHA, &owner, types, expires).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let nothing = app.token(ALPHA_NOTHING);
    assert_eq!(
        make(ALPHA, &nothing, json!(["chart"]), "1h").await.0,
        StatusCode::FORBIDDEN
    );
    sqlx::query(
        "insert into aarogyam.role_permissions (org_id, role_id, permission, scope)
                 select r.org_id, r.id, 'patients.read', 'all' from aarogyam.roles r
                 join aarogyam.organizations o on o.id = r.org_id
                 where o.slug = 'alpha' and r.key = 'nothing'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        make(ALPHA, &nothing, json!(["chart"]), "1h").await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        make(ALPHA, &nothing, json!(["bills"]), "1h").await.0,
        StatusCode::FORBIDDEN
    );
    let beta = app.token(BETA_OWNER);
    assert_eq!(
        make(BETA, &beta, json!(["chart"]), "1h").await.0,
        StatusCode::NOT_FOUND
    );
    let (status, _) = app.send(Method::GET, BETA, &path, Some(&beta), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Lifetimes: 1 hour, 24 hours and 7 days.
    let mut ends = Vec::new();
    for expires in ["1h", "24h", "7d"] {
        let (status, link) = make(ALPHA, &owner, json!(["bills"]), expires).await;
        assert_eq!(status, StatusCode::CREATED, "{link}");
        ends.push(link["expires_at"].as_str().unwrap().to_owned());
    }
    assert!(ends[0] < ends[1] && ends[1] < ends[2], "{ends:?}");

    // The full link: preview names the kinds; a wrong PIN counts; the right one opens it.
    let (status, link) = make(ALPHA, &owner, json!(["bills", "chart", "xrays"]), "24h").await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    assert_eq!(link["record_types"], json!(["chart", "xrays", "bills"]));
    let (token, pin) = (
        link["token"].as_str().unwrap(),
        link["pin"].as_str().unwrap(),
    );
    let (_, preview) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/shared/{token}"),
            None,
            None,
        )
        .await;
    assert_eq!(preview["resource"], "records");
    assert_eq!(preview["record_types"], json!(["chart", "xrays", "bills"]));
    assert_eq!(open(&app, token, "000000").await.0, StatusCode::FORBIDDEN);
    let (status, records) = open(&app, token, pin).await;
    assert_eq!(status, StatusCode::OK, "{records}");
    assert_eq!(records["chart"][0]["finding"], "caries");
    assert_eq!(records["bills"][0]["total_paise"], 100_000);
    let url = records["xrays"][0]["url"].as_str().unwrap().to_owned();
    assert_eq!(records["xrays"][0]["label"], "OPG");
    assert_eq!(fetch(&app, ALPHA, &url).await, (StatusCode::OK, png()));
    assert_eq!(fetch(&app, BETA, &url).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        fetch(&app, ALPHA, &format!("{url}x")).await.0,
        StatusCode::NOT_FOUND
    );

    // A link to bills alone shows no chart or X-rays, and its token opens no X-ray.
    let (_, bills_only) = make(ALPHA, &owner, json!(["bills"]), "1h").await;
    let (status, shown) = open(
        &app,
        bills_only["token"].as_str().unwrap(),
        bills_only["pin"].as_str().unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        (&shown["chart"], &shown["xrays"]),
        (&Value::Null, &Value::Null)
    );
    let other = url.replace(token, bills_only["token"].as_str().unwrap());
    assert_eq!(fetch(&app, ALPHA, &other).await.0, StatusCode::NOT_FOUND);

    // Five wrong PINs lock a link; the staff list shows what happened, never the secrets.
    for _ in 0..4 {
        open(&app, bills_only["token"].as_str().unwrap(), "000000").await;
    }
    assert_eq!(
        open(&app, bills_only["token"].as_str().unwrap(), "000000")
            .await
            .0,
        StatusCode::LOCKED
    );
    let (status, list) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    let full = items.iter().find(|i| i["id"] == link["id"]).unwrap();
    assert_eq!(
        (&full["state"], &full["open_count"]),
        (&json!("usable"), &json!(1))
    );
    assert!(items.iter().any(|i| i["state"] == "locked"));
    assert!(!list.to_string().contains(pin));

    // Every share and open is in the access record, the X-ray download too.
    let count = |action: &'static str| {
        let (pool, link) = (app.owner.clone(), link["id"].as_str().unwrap().to_owned());
        async move {
            sqlx::query_scalar::<_, i64>("select count(*) from audit.access_log where share_link_id = $1::uuid and action = $2")
                .bind(link).bind(action).fetch_one(&pool).await.unwrap()
        }
    };
    assert_eq!(
        (
            count("share").await,
            count("view").await,
            count("download").await
        ),
        (3, 3, 1)
    );
    app.finish().await;
}
