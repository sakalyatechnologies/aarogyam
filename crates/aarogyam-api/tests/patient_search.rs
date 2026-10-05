//! Patient search on a real database: each way of finding a patient (number, digits, phone,
//! name prefix with a fuzzy fallback, recent), in one statement with the list's summaries, and
//! opening a record writes exactly one access record.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, TestApp};

async fn register(app: &TestApp, token: &str, name: &str, phone: &str) -> String {
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": name, "age_years": 30, "phone": phone })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

/// The names a search returns, in order.
async fn found(app: &TestApp, token: &str, query: &str) -> Vec<String> {
    let (status, body) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients/search",
            Some(token),
            Some(json!({ "q": query })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{query}: {body}");
    names(&body)
}

fn names(body: &Value) -> Vec<String> {
    body["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["full_name"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn every_kind_of_search_finds_the_right_patients_in_order() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    register(&app, &owner, "Priya Sharma", "98765 43210").await;
    register(&app, &owner, "Priyanka Rao", "98765 43211").await;
    register(&app, &owner, "Pritam Das", "98765 43212").await;
    register(&app, &owner, "Ravi Kumar", "98765 43213").await;

    // Number, digits and phone.
    assert_eq!(found(&app, &owner, "AD-2").await, ["Priyanka Rao"]);
    assert_eq!(found(&app, &owner, "3").await, ["Pritam Das"]);
    assert_eq!(found(&app, &owner, "9876543213").await, ["Ravi Kumar"]);
    assert_eq!(found(&app, &owner, "AD-99").await, Vec::<String>::new());

    // Three or more by prefix: by name, no fuzzy matches added.
    assert_eq!(
        found(&app, &owner, "pri").await,
        ["Pritam Das", "Priya Sharma", "Priyanka Rao"]
    );
    // Fewer than three by prefix: those first, then close spellings, never twice.
    let close = found(&app, &owner, "priya sharm").await;
    assert_eq!(close.first().map(String::as_str), Some("Priya Sharma"));
    assert_eq!(
        close.iter().filter(|name| *name == "Priya Sharma").count(),
        1
    );
    // No prefix match at all: a misspelling still finds the patient.
    assert_eq!(
        found(&app, &owner, "priya sharmaa")
            .await
            .first()
            .map(String::as_str),
        Some("Priya Sharma")
    );

    // An empty search lists the most recently registered first, with summaries.
    let (status, recent) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{recent}");
    assert_eq!(
        names(&recent),
        ["Ravi Kumar", "Pritam Das", "Priyanka Rao", "Priya Sharma"]
    );
    assert_eq!(recent["items"][0]["balance_paise"], 0);
    assert_eq!(recent["items"][0]["recall_due"], false);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn opening_a_record_writes_one_access_record_and_a_missing_one_none() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner, "Asha Verma", "98765 43219").await;
    let chart_views = async || -> i64 {
        sqlx::query_scalar(
            "select count(*) from audit.access_log where resource = 'chart' and action = 'view'",
        )
        .fetch_one(&app.owner)
        .await
        .unwrap()
    };
    let before = chart_views().await;

    let (status, body) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["full_name"], "Asha Verma");
    assert_eq!(body["balance_paise"], 0);
    let recorded: (String, String) = sqlx::query_as(
        "select patient_id::text, actor_kind from audit.access_log
         where resource = 'chart' order by at desc, id desc limit 1",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(recorded, (patient.clone(), "staff".to_owned()));
    assert_eq!(chart_views().await, before + 1);

    let missing = "01900000-0000-7000-8000-00000000ffff";
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{missing}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(chart_views().await, before + 1);
    app.finish().await;
}
