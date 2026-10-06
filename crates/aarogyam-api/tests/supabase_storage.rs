//! The Supabase Storage client against a local stand-in for `/storage/v1/object/<bucket>/...`:
//! store, read back, delete, and the key sent in the headers only.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use aarogyam_app::files::{Storage as _, StorageKey, SupabaseStorage};
use aarogyam_domain::ids::{AttachmentId, ClinicId};
use axum::Router;
use axum::body::Bytes;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use secrecy::SecretString;

const KEY: &str = "sb_secret_test_only";

type Objects = Arc<Mutex<HashMap<String, Vec<u8>>>>;

fn authorised(headers: &HeaderMap) -> bool {
    headers.get("apikey").and_then(|v| v.to_str().ok()) == Some(KEY)
        && headers.get("authorization").and_then(|v| v.to_str().ok())
            == Some(&format!("Bearer {KEY}"))
}

async fn put(
    State(objects): State<Objects>,
    Path(path): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> StatusCode {
    if !authorised(&headers) {
        return StatusCode::UNAUTHORIZED;
    }
    let mut objects = objects.lock().unwrap();
    if objects.contains_key(&path) {
        return StatusCode::CONFLICT;
    }
    objects.insert(path, body.to_vec());
    StatusCode::OK
}

async fn get(
    State(objects): State<Objects>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> Result<Vec<u8>, StatusCode> {
    if !authorised(&headers) {
        return Err(StatusCode::UNAUTHORIZED);
    }
    objects
        .lock()
        .unwrap()
        .get(&path)
        .cloned()
        .ok_or(StatusCode::NOT_FOUND)
}

async fn delete(
    State(objects): State<Objects>,
    Path(path): Path<String>,
    headers: HeaderMap,
) -> StatusCode {
    if !authorised(&headers) {
        return StatusCode::UNAUTHORIZED;
    }
    match objects.lock().unwrap().remove(&path) {
        Some(_) => StatusCode::OK,
        None => StatusCode::NOT_FOUND,
    }
}

async fn serve(objects: Objects) -> String {
    let app = Router::new()
        .route(
            "/storage/v1/object/{*path}",
            post(put).get(get).delete(delete),
        )
        .with_state(objects);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await });
    format!("http://{address}")
}

#[tokio::test]
async fn files_round_trip_through_a_private_bucket() {
    let objects = Objects::default();
    let url = serve(Arc::clone(&objects)).await;
    let store = SupabaseStorage::new(&url, "aarogyam-files", SecretString::from(KEY)).unwrap();
    let key = StorageKey::new(ClinicId::new_v7(), AttachmentId::new_v7());

    store.put(key, b"scan bytes").await.unwrap();
    assert_eq!(store.get(key).await.unwrap(), b"scan bytes");
    let stored: Vec<String> = objects.lock().unwrap().keys().cloned().collect();
    assert_eq!(stored, [format!("aarogyam-files/{key}")]);

    assert!(
        store.put(key, b"again").await.is_err(),
        "keys are never overwritten"
    );
    store.delete(key).await.unwrap();
    assert!(store.get(key).await.is_err());
    store.delete(key).await.unwrap(); // already gone is fine
}

#[tokio::test]
async fn a_wrong_key_is_refused_without_leaking_it() {
    let url = serve(Objects::default()).await;
    let store = SupabaseStorage::new(&url, "aarogyam-files", SecretString::from("wrong")).unwrap();
    let key = StorageKey::new(ClinicId::new_v7(), AttachmentId::new_v7());
    let error = store.put(key, b"x").await.unwrap_err().to_string();
    assert!(!error.contains("wrong") && !error.contains(&key.to_string()));
}
