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
use support::{ALPHA, BETA, TestApp};

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

/// The names a search at `host` returns, in order.
async fn found_at(app: &TestApp, host: &str, token: &str, query: &str) -> Vec<String> {
    let (status, body) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients/search",
            Some(token),
            Some(json!({ "q": query })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{query}: {body}");
    names(&body)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn parts_of_names_and_the_end_of_a_phone_find_patients() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    register(&app, &owner, "Sneha Patil", "98765 09999").await;
    register(&app, &owner, "Patrick Dsouza", "98765 11112").await;
    register(&app, &owner, "Ramesh Gopatil", "98765 22223").await;
    register(&app, &owner, "Nila Iyer", "98765 31234").await;

    // The whole name's start first, then the start of another word, then anywhere in it.
    assert_eq!(
        found(&app, &owner, "pat").await,
        ["Patrick Dsouza", "Sneha Patil", "Ramesh Gopatil"]
    );
    // Two letters: starts of words only, no substrings.
    assert_eq!(
        found(&app, &owner, "pa").await,
        ["Patrick Dsouza", "Sneha Patil"]
    );
    // Every typed word starts a word, in any order.
    assert_eq!(found(&app, &owner, "pat sne").await, ["Sneha Patil"]);
    assert_eq!(
        found(&app, &owner, "atil").await,
        ["Ramesh Gopatil", "Sneha Patil"]
    );

    // The last four or more digits of a phone, with or without spaces.
    assert_eq!(found(&app, &owner, "9999").await, ["Sneha Patil"]);
    assert_eq!(found(&app, &owner, "0 9999").await, ["Sneha Patil"]);
    assert_eq!(found(&app, &owner, "22223").await, ["Ramesh Gopatil"]);
    // Digits in the middle of a phone are not its end.
    assert_eq!(found(&app, &owner, "8765").await, Vec::<String>::new());
    // Digits that are no patient's number still find the phone they end.
    assert_eq!(found(&app, &owner, "1234").await, ["Nila Iyer"]);

    // Another clinic finds none of them, by name or by phone.
    let beta = app.token(BETA_OWNER);
    assert_eq!(
        found_at(&app, BETA, &beta, "pat").await,
        Vec::<String>::new()
    );
    assert_eq!(
        found_at(&app, BETA, &beta, "9999").await,
        Vec::<String>::new()
    );
    app.finish().await;
}
