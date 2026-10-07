//! Patient notes on Patient 360: the summary note (one per patient, versioned, audited) beside
//! the list of visit notes. Signed visit notes still change only through addenda.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{HeaderMap, Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> String {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value["id"].as_str().unwrap().to_owned()
}

async fn save(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    body: &str,
    if_match: Option<&str>,
) -> (StatusCode, HeaderMap, Value) {
    let headers: Vec<(&str, &str)> = if_match.map(|v| ("if-match", v)).into_iter().collect();
    app.send_full(
        Method::PUT,
        host,
        &format!("/api/v1/patients/{patient}/summary-note"),
        Some(token),
        Some(json!({ "body": body })),
        &headers,
    )
    .await
}

async fn notes(app: &TestApp, host: &str, token: &str, patient: &str) -> (StatusCode, Value) {
    app.send(
        Method::GET,
        host,
        &format!("/api/v1/patients/{patient}/notes"),
        Some(token),
        None,
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_summary_note_is_versioned_formatted_and_audited() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = created(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Kavya Rao" }),
    )
    .await;

    let (status, body) = notes(&app, ALPHA, &owner, &patient).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["summary"].is_null(), "{body}");
    assert_eq!(body["visit_notes"], json!([]));

    // The first save creates it; the ETag is its row_version.
    let text = "## History\n- **Diabetic**, on metformin\n- *Anxious* about injections\n\n1. Recall in 6 months";
    let (status, headers, first) = save(&app, ALPHA, &owner, &patient, text, None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert_eq!(first["body"], text);
    assert_eq!(first["row_version"], 1);
    assert_eq!(headers["etag"], "\"1\"");

    // A change with the version just read goes through and bumps it; repeating it changes nothing.
    let (status, headers, second) =
        save(&app, ALPHA, &owner, &patient, "Updated", Some("\"1\"")).await;
    assert_eq!(status, StatusCode::OK, "{second}");
    assert_eq!(second["row_version"], 2);
    assert_eq!(headers["etag"], "\"2\"");
    let (_, _, again) = save(&app, ALPHA, &owner, &patient, "Updated", Some("\"2\"")).await;
    assert_eq!(again["row_version"], 2);

    // A stale version is refused and the note stays as it is.
    let (status, headers, refused) =
        save(&app, ALPHA, &owner, &patient, "Lost update", Some("\"1\"")).await;
    assert_eq!(status, StatusCode::PRECONDITION_FAILED, "{refused}");
    assert_eq!(headers["etag"], "\"2\"");
    let (_, listed) = notes(&app, ALPHA, &owner, &patient).await;
    assert_eq!(listed["summary"]["body"], "Updated");
    assert_eq!(listed["summary"]["row_version"], 2);

    // Raw HTML, links, images, code and deep headings are refused on save.
    for bad in [
        "<script>alert(1)</script>",
        "hello <b>there</b>",
        "[x](javascript:alert(1))",
        "![x](http://example.test/a.png)",
        "`code`",
        "#### too deep",
    ] {
        let (status, _, error) = save(&app, ALPHA, &owner, &patient, bad, None).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}: {error}");
    }
    let (status, _, error) = save(&app, ALPHA, &owner, &patient, &"a".repeat(20_001), None).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    // Comparisons are plain text, not tags.
    let (status, _, ok) = save(&app, ALPHA, &owner, &patient, "BP < 120 and x<3", None).await;
    assert_eq!(status, StatusCode::OK, "{ok}");

    // Every change is in the audit history, without the version counter.
    let (changes,): (i64,) = sqlx::query_as(
        "select count(*) from audit.audit_events
         where table_name = 'aarogyam.patient_notes' and action in ('insert', 'update')",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(changes, 3);

    // Reading the notes writes the access record.
    let (views,): (i64,) = sqlx::query_as(
        "select count(*) from audit.access_log
         where patient_id = $1::uuid and resource = 'note' and resource_id is null",
    )
    .bind(&patient)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(views >= 2, "{views}");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn visit_notes_are_listed_and_signed_ones_change_only_by_addendum() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = created(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Ravi Kumar" }),
    )
    .await;
    let visit = created(
        &app,
        &owner,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Pain" }),
    )
    .await;
    let draft = created(
        &app,
        &owner,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "subjective": "Pain **on chewing**", "plan": "- RCT\n- Review" } }),
    )
    .await;

    // The doctor edits the draft during the visit, and the list shows the change.
    let (status, edited) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/notes/{draft}"),
            Some(&owner),
            Some(json!({ "sections": { "subjective": "Pain on chewing, 46", "plan": "1. RCT" } })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    // HTML in a section is refused too.
    let (status, error) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/notes/{draft}"),
            Some(&owner),
            Some(json!({ "sections": { "subjective": "<img src=x onerror=alert(1)>" } })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");

    let (status, listed) = notes(&app, ALPHA, &owner, &patient).await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    let items = listed["visit_notes"].as_array().unwrap();
    assert_eq!(items.len(), 1);
    assert_eq!(items[0]["id"], draft.as_str());
    assert_eq!(items[0]["status"], "draft");
    assert_eq!(items[0]["sections"]["plan"], "1. RCT");
    assert_eq!(items[0]["addenda_count"], 0);
    assert!(items[0]["visit_number"].as_str().unwrap().starts_with("V-"));

    // Signed: no more edits; an addendum is the way, and the list counts it.
    let (status, signed) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/notes/{draft}/sign"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    let (status, refused) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/notes/{draft}"),
            Some(&owner),
            Some(json!({ "sections": { "subjective": "Changed" } })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    let (status, amended) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/notes/{draft}/addenda"),
            Some(&owner),
            Some(json!({ "body": "Tooth is **47**, not 46" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{amended}");
    let (_, listed) = notes(&app, ALPHA, &owner, &patient).await;
    assert_eq!(listed["visit_notes"][0]["status"], "signed");
    assert_eq!(listed["visit_notes"][0]["addenda_count"], 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn permissions_and_clinic_walls_hold() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = created(
        &app,
        &owner,
        "/api/v1/patients",
        json!({ "full_name": "Meera Iyer" }),
    )
    .await;
    save(&app, ALPHA, &owner, &patient, "Private summary", None).await;

    // Another clinic's owner gets 404, on read and on write.
    let beta = app.token(BETA_OWNER);
    let (status, body) = notes(&app, BETA, &beta, &patient).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let (status, _, body) = save(&app, BETA, &beta, &patient, "Hijack", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");

    // Someone without any clinical permission is refused.
    let nothing = app.token(ALPHA_NOTHING);
    let (status, _) = notes(&app, ALPHA, &nothing, &patient).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _, _) = save(&app, ALPHA, &nothing, &patient, "x", None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Not signed in.
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/notes"),
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // The note is still what the owner wrote.
    let (_, listed) = notes(&app, ALPHA, &owner, &patient).await;
    assert_eq!(listed["summary"]["body"], "Private summary");
    app.finish().await;
}
