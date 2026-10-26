//! Family profiles: links written with their inverse, removed together, shown in the phone
//! lookup's `family_group`, added from a walk-in, and kept inside their clinic.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

async fn send(
    app: &TestApp,
    method: Method,
    host: &str,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

async fn register(app: &TestApp, host: &str, token: &str, name: &str, phone: &str) -> String {
    let (status, body) = send(
        app,
        Method::POST,
        host,
        token,
        "/api/v1/patients",
        Some(json!({ "full_name": name, "sex": "female", "age_years": 40, "phone": phone })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn family(app: &TestApp, host: &str, token: &str, patient: &str) -> Vec<Value> {
    let (status, body) = send(
        app,
        Method::GET,
        host,
        token,
        &format!("/api/v1/patients/{patient}/family"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["items"].as_array().unwrap().clone()
}

async fn link(
    app: &TestApp,
    token: &str,
    patient: &str,
    related: &str,
    relation: &str,
) -> (StatusCode, Value) {
    send(
        app,
        Method::POST,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/family"),
        Some(json!({ "related_patient_id": related, "relation": relation })),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_link_and_its_inverse_are_listed_and_removed_together() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let mother = register(&app, ALPHA, &desk, "Meera Shah", "+919820000001").await;
    let child = register(&app, ALPHA, &desk, "Aarav Shah", "+919820000001").await;

    let (status, made) = link(&app, &desk, &mother, &child, "child").await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    assert_eq!(made["patient_id"], child);
    assert_eq!(made["relation"], "child");
    let mine = family(&app, ALPHA, &desk, &mother).await;
    assert_eq!(mine.len(), 1);
    let theirs = family(&app, ALPHA, &desk, &child).await;
    assert_eq!(theirs.len(), 1);
    assert_eq!(theirs[0]["patient_id"], mother);
    assert_eq!(theirs[0]["relation"], "parent");

    // Again, in either direction, and to oneself: refused.
    assert_eq!(
        link(&app, &desk, &mother, &child, "child").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        link(&app, &desk, &child, &mother, "parent").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        link(&app, &desk, &mother, &mother, "other").await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        link(&app, &desk, &mother, &child, "cousin").await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(family(&app, ALPHA, &desk, &mother).await.len(), 1);

    let link_id = made["id"].as_str().unwrap();
    let (status, _) = send(
        &app,
        Method::DELETE,
        ALPHA,
        &desk,
        &format!("/api/v1/patients/{mother}/family/{link_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        family(&app, ALPHA, &desk, &mother).await,
        Vec::<Value>::new()
    );
    assert_eq!(
        family(&app, ALPHA, &desk, &child).await,
        Vec::<Value>::new()
    );
    let (status, _) = send(
        &app,
        Method::DELETE,
        ALPHA,
        &desk,
        &format!("/api/v1/patients/{mother}/family/{link_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn reading_needs_patients_read_and_changing_needs_patients_write() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let a = register(&app, ALPHA, &desk, "Meera Shah", "+919820000002").await;
    let b = register(&app, ALPHA, &desk, "Ravi Shah", "+919820000002").await;
    let (status, made) = link(&app, &desk, &a, &b, "spouse").await;
    assert_eq!(status, StatusCode::CREATED, "{made}");

    assert_eq!(family(&app, ALPHA, &assistant, &a).await.len(), 1);
    let path = format!(
        "/api/v1/patients/{a}/family/{}",
        made["id"].as_str().unwrap()
    );
    // The assistant has patients.write (0680), so only a role without it is refused.
    let (status, _) = send(&app, Method::DELETE, ALPHA, &nothing, &path, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = send(
        &app,
        Method::GET,
        ALPHA,
        &nothing,
        &format!("/api/v1/patients/{a}/family"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        link(&app, &nothing, &a, &b, "sibling").await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(family(&app, ALPHA, &desk, &a).await.len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_gets_404_for_every_family_route() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let a = register(&app, ALPHA, &desk, "Meera Shah", "+919820000003").await;
    let b = register(&app, ALPHA, &desk, "Ravi Shah", "+919820000003").await;
    let beta_patient = register(&app, BETA, &beta, "Bela Rao", "+919820000009").await;
    let (_, made) = link(&app, &desk, &a, &b, "spouse").await;
    let link_id = made["id"].as_str().unwrap();

    let (status, _) = send(
        &app,
        Method::GET,
        BETA,
        &beta,
        &format!("/api/v1/patients/{a}/family"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        Method::POST,
        BETA,
        &beta,
        &format!("/api/v1/patients/{a}/family"),
        Some(json!({ "related_patient_id": beta_patient, "relation": "other" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        Method::DELETE,
        BETA,
        &beta,
        &format!("/api/v1/patients/{a}/family/{link_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Linking to a patient of another clinic from our own clinic finds no such patient.
    assert_eq!(
        link(&app, &desk, &a, &beta_patient, "other").await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(family(&app, ALPHA, &desk, &a).await.len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_phone_lookup_shows_the_family_group() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let mother = register(&app, ALPHA, &desk, "Meera Shah", "+919820000004").await;
    let child = register(&app, ALPHA, &desk, "Aarav Shah", "+919820000004").await;
    let grandmother = register(&app, ALPHA, &desk, "Kamal Shah", "+919820000005").await;
    assert_eq!(
        link(&app, &desk, &mother, &child, "child").await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        link(&app, &desk, &mother, &grandmother, "parent").await.0,
        StatusCode::CREATED
    );

    let lookup = |phone: &'static str| {
        let (app, desk) = (&app, desk.clone());
        async move {
            send(
                app,
                Method::POST,
                ALPHA,
                &desk,
                "/api/v1/patients/lookup",
                Some(json!({ "phone": phone })),
            )
            .await
        }
    };
    let (status, found) = lookup("+919820000004").await;
    assert_eq!(status, StatusCode::OK, "{found}");
    assert_eq!(found["items"].as_array().unwrap().len(), 2);
    // Only the relative on another number is added; the child is already a match.
    let group = found["family_group"].as_array().unwrap();
    assert_eq!(group.len(), 1, "{found}");
    assert_eq!(group[0]["id"], grandmother);
    assert_eq!(group[0]["of_patient_id"], mother);
    assert_eq!(group[0]["relation"], "parent");
    let (_, other) = lookup("+919820000099").await;
    assert_eq!(other["family_group"], json!([]));
    assert_eq!(other["items"], json!([]));
    let _ = child;
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_walk_in_joins_an_existing_family() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let mother = register(&app, ALPHA, &desk, "Meera Shah", "+919820000006").await;

    let (status, walk_in) = send(
        &app,
        Method::POST,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        Some(json!({
            "patient": { "full_name": "Aarav Shah", "age_years": 6, "sex": "male",
                         "phone": "+919820000006" },
            "no_known_allergies": true,
            "consents": [{ "purpose": "care", "method": "verbal" }],
            "family_of": { "patient_id": mother, "relation": "child" }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    let child = walk_in["patient"]["id"].as_str().unwrap();
    assert!(walk_in["family_link_id"].is_string());
    let mine = family(&app, ALPHA, &desk, &mother).await;
    assert_eq!(mine[0]["patient_id"], child);
    assert_eq!(mine[0]["relation"], "child");
    assert_eq!(
        family(&app, ALPHA, &desk, child).await[0]["relation"],
        "parent"
    );

    // Nothing is written when the link fails: an unknown relative registers nobody.
    let (status, body) = send(
        &app,
        Method::POST,
        ALPHA,
        &desk,
        "/api/v1/walk-ins",
        Some(json!({
            "patient": { "full_name": "Ghost", "age_years": 3, "sex": "male" },
            "no_known_allergies": true,
            "family_of": { "patient_id": "01900000-0000-7000-8000-00000000ffff", "relation": "child" }
        })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    let ghosts: i64 =
        sqlx::query_scalar("select count(*) from aarogyam.patients where full_name = 'Ghost'")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(ghosts, 0);
    app.finish().await;
}
