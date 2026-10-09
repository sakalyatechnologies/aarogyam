//! The patient app's session registry: every request records its sign-in session, the patient
//! lists their own sessions and signs one out, and a signed-out session is refused at once.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::Value;
use support::{ALPHA, TestApp};
use uuid::{Uuid, uuid};

const APP: &str = "app.localtest.me";
const RAVI: Uuid = uuid!("e0000000-0000-4000-8000-000000000001");
const MEERA: Uuid = uuid!("e0000000-0000-4000-8000-000000000002");
const SESSIONS: &str = "/api/v1/me/patient/sessions";

async fn sessions(app: &TestApp, token: &str) -> (StatusCode, Value) {
    app.send(Method::GET, APP, SESSIONS, Some(token), None)
        .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patients_list_and_sign_out_their_own_sessions() {
    let app = TestApp::start().await;
    let phone = app
        .tokens
        .mint_with_email(RAVI, Some("ravi@example.test"))
        .unwrap();
    let laptop = app
        .tokens
        .mint_with_email(RAVI, Some("ravi@example.test"))
        .unwrap();
    let (status, _) = sessions(&app, &laptop).await;
    assert_eq!(status, StatusCode::OK);
    let (status, list) = sessions(&app, &phone).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    let current: Vec<&Value> = items.iter().filter(|s| s["current"] == true).collect();
    assert_eq!(current.len(), 1);
    let other = items.iter().find(|s| s["current"] == false).unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // Another patient can't see or end Ravi's sessions.
    let meera = app
        .tokens
        .mint_with_email(MEERA, Some("meera@example.test"))
        .unwrap();
    let (_, theirs) = sessions(&app, &meera).await;
    assert_eq!(theirs["items"].as_array().unwrap().len(), 1);
    let path = format!("{SESSIONS}/{other}");
    let (status, _) = app
        .send(Method::DELETE, APP, &path, Some(&meera), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Only on the app host, only signed in.
    let (status, _) = app
        .send(Method::GET, ALPHA, SESSIONS, Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app.send(Method::GET, APP, SESSIONS, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app.send(Method::DELETE, APP, &path, None, None).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Signing out the laptop from the phone: the laptop is refused at once, the phone isn't.
    let (status, _) = app
        .send(Method::DELETE, APP, &path, Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = sessions(&app, &laptop).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _) = app
        .send(Method::GET, APP, "/api/v1/me/patient", Some(&laptop), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, list) = sessions(&app, &phone).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    // Signing it out again changes nothing.
    let (status, _) = app
        .send(Method::DELETE, APP, &path, Some(&phone), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    app.finish().await;
}
