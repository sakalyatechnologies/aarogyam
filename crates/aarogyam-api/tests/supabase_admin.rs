//! The Supabase Admin client against a local stand-in for `/auth/v1/admin/users`: creating a
//! confirmed account, finding an existing one, and sending the key only in `apikey`.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

use std::sync::{Arc, Mutex};

use aarogyam_app::accounts::{SignInAccounts as _, SupabaseAdmin};
use aarogyam_domain::patient::Email;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::get;
use axum::{Json, Router};
use secrecy::SecretString;
use serde_json::{Value, json};
use uuid::Uuid;

const KEY: &str = "sb_secret_test_only";

#[derive(Default)]
struct Fake {
    users: Mutex<Vec<(Uuid, String)>>,
    created: Mutex<Vec<Value>>,
}

fn authorised(headers: &HeaderMap) -> bool {
    headers.get("apikey").and_then(|v| v.to_str().ok()) == Some(KEY)
}

async fn create(
    State(fake): State<Arc<Fake>>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if !authorised(&headers) {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let email = body["email"].as_str().unwrap().to_owned();
    let mut users = fake.users.lock().unwrap();
    if users.iter().any(|(_, known)| *known == email) {
        return (
            StatusCode::UNPROCESSABLE_ENTITY,
            Json(json!({ "code": 422, "error_code": "email_exists",
                         "msg": "A user with this email address has already been registered" })),
        );
    }
    let id = Uuid::now_v7();
    users.push((id, email.clone()));
    fake.created.lock().unwrap().push(body);
    (StatusCode::OK, Json(json!({ "id": id, "email": email })))
}

async fn list(State(fake): State<Arc<Fake>>, headers: HeaderMap) -> (StatusCode, Json<Value>) {
    if !authorised(&headers) {
        return (StatusCode::UNAUTHORIZED, Json(json!({})));
    }
    let users: Vec<Value> = fake
        .users
        .lock()
        .unwrap()
        .iter()
        .map(|(id, email)| json!({ "id": id, "email": email }))
        .collect();
    (
        StatusCode::OK,
        Json(json!({ "users": users, "aud": "authenticated" })),
    )
}

async fn serve(fake: Arc<Fake>) -> String {
    let app = Router::new()
        .route("/auth/v1/admin/users", get(list).post(create))
        .with_state(fake);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await });
    format!("http://{address}")
}

#[tokio::test]
async fn accounts_are_created_confirmed_or_found() {
    let fake = Arc::new(Fake::default());
    let existing = Uuid::now_v7();
    fake.users
        .lock()
        .unwrap()
        .push((existing, "founder@sakalya.test".to_owned()));
    let url = serve(Arc::clone(&fake)).await;
    let admin = SupabaseAdmin::new(&url, SecretString::from(KEY)).unwrap();

    let email = Email::parse("New.Doctor@Clinic.test").unwrap();
    let created = admin.ensure_user(&email).await.unwrap();
    let again = admin.ensure_user(&email).await.unwrap();
    assert_eq!(created, again);
    let body = fake.created.lock().unwrap()[0].clone();
    assert_eq!(
        body,
        json!({ "email": "new.doctor@clinic.test", "email_confirm": true })
    );

    let founder = Email::parse("Founder@Sakalya.test").unwrap();
    assert_eq!(admin.ensure_user(&founder).await.unwrap().uuid(), existing);
    assert_eq!(fake.created.lock().unwrap().len(), 1);

    // A wrong key is an error, never a made-up account.
    let wrong = SupabaseAdmin::new(&url, SecretString::from("sb_secret_wrong")).unwrap();
    assert!(wrong.ensure_user(&email).await.is_err());
    // Debug output never shows the key.
    assert!(!format!("{admin:?}").contains(KEY));
}
