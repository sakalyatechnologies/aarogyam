//! Batch lab reminders, lab directory fields, the order tracker and message stats; chat channels,
//! pinned notices and files in chat messages. On a real database, through the API.
#![expect(
    clippy::unwrap_used,
    clippy::too_many_lines,
    reason = "tests fail loudly instead of returning errors, and walk one story each"
)]

mod support;

use axum::body::{Body, to_bytes};
use axum::http::{HeaderMap, Method, Request, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use tower::ServiceExt as _;
use uuid::Uuid;

const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsynthetic chat picture";
const PDF: &[u8] = b"%PDF-1.7 synthetic";

async fn call(
    app: &TestApp,
    host: &str,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

async fn ok(app: &TestApp, token: &str, method: Method, path: &str, body: Option<Value>) -> Value {
    let (status, value) = call(app, ALPHA, token, method.clone(), path, body).await;
    assert!(status.is_success(), "{method} {path}: {status} {value}");
    value
}

fn id(value: &Value) -> String {
    value["id"].as_str().unwrap().to_owned()
}

async fn lab(app: &TestApp, owner: &str, name: &str, contact: Value) -> (String, String) {
    let vendor = ok(
        app,
        owner,
        Method::POST,
        "/api/v1/lab-vendors",
        Some(json!({ "name": name })),
    )
    .await;
    let made = ok(
        app,
        owner,
        Method::POST,
        &format!("/api/v1/lab-vendors/{}/contacts", id(&vendor)),
        Some(contact),
    )
    .await;
    (id(&vendor), id(&made))
}

async fn patient(app: &TestApp, owner: &str, name: &str) -> String {
    let made = ok(
        app,
        owner,
        Method::POST,
        "/api/v1/patients",
        Some(json!({ "full_name": name })),
    )
    .await;
    id(&made)
}

async fn order(app: &TestApp, owner: &str, vendor: &str, patient: &str, send: bool) -> Value {
    ok(
        app,
        owner,
        Method::POST,
        "/api/v1/lab-orders",
        Some(json!({
            "vendor_id": vendor, "patient_id": patient, "send": send, "due_on": "2031-01-15",
            "items": [{ "work_type": "Crown", "teeth": [36], "shade": "A2" }],
        })),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn labs_are_reminded_in_batches_without_the_patients_name() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (vendor, _) = lab(
        &app,
        &owner,
        "Precision Dental Lab",
        json!({ "name": "Suresh", "email": "suresh@lab.test", "phone": "9876500001", "whatsapp": true }),
    )
    .await;
    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let first = order(&app, &owner, &vendor, &ravi, true).await;
    let second = order(&app, &owner, &vendor, &ravi, true).await;
    let draft = order(&app, &owner, &vendor, &ravi, false).await;
    let ids = json!([id(&first), id(&second), id(&second), id(&draft)]);
    let path = "/api/v1/lab-orders/reminders";

    // Email: one message for the lab, listing both orders; the draft is skipped.
    let (status, done) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        path,
        Some(json!({ "order_ids": ids, "channel": "email" })),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{done}");
    assert_eq!(done["vendors"].as_array().unwrap().len(), 1);
    let lab_row = &done["vendors"][0];
    assert_eq!(lab_row["order_ids"].as_array().unwrap().len(), 2);
    assert!(lab_row["message_id"].is_string() && lab_row["wa_link"].is_null());
    assert_eq!(done["skipped"].as_array().unwrap().len(), 1);
    assert_eq!(done["skipped"][0]["order_id"], id(&draft));
    let queued: Vec<(String, Value)> = sqlx::query_as(
        "select recipient, payload from aarogyam.outbox_events
         where event_key = 'lab_order.reminder' order by created_at",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(queued.len(), 1);
    assert_eq!(queued[0].0, "suresh@lab.test");
    assert_eq!(queued[0].1["orders"].as_array().unwrap().len(), 2);
    let text = queued[0].1.to_string();
    assert!(!text.contains("Ravi") && !text.contains(&ravi), "{text}");

    // WhatsApp: a link, nothing queued, still no patient name.
    let (status, done) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        path,
        Some(json!({ "order_ids": [id(&first)], "channel": "whatsapp" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    let link = done["vendors"][0]["wa_link"].as_str().unwrap();
    assert!(link.starts_with("https://wa.me/91"), "{link}");
    assert!(!link.contains("Ravi"), "{link}");
    assert!(done["vendors"][0]["message_id"].is_null());
    let count: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.outbox_events where event_key = 'lab_order.reminder'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(count, 1, "WhatsApp queues nothing");

    // The single reminder carries the link too.
    let (status, single) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/lab-orders/{}/remind", id(&second)),
        None,
    )
    .await;
    assert!(status.is_success(), "{single}");
    assert!(single["wa_link"].is_string(), "{single}");

    // Validation: none, too many, an unknown channel.
    for (body, expected) in [
        (
            json!({ "order_ids": [], "channel": "email" }),
            StatusCode::BAD_REQUEST,
        ),
        (
            json!({ "order_ids": (0..51).map(|_| Uuid::now_v7()).collect::<Vec<_>>(), "channel": "email" }),
            StatusCode::BAD_REQUEST,
        ),
        // A channel that isn't one fails to parse.
        (
            json!({ "order_ids": [id(&first)], "channel": "pigeon" }),
            StatusCode::UNPROCESSABLE_ENTITY,
        ),
    ] {
        let (status, value) = call(&app, ALPHA, &owner, Method::POST, path, Some(body)).await;
        assert_eq!(status, expected, "{value}");
    }
    // Permissions.
    for token in [app.token(ALPHA_NOTHING)] {
        let (status, _) = call(
            &app,
            ALPHA,
            &token,
            Method::POST,
            path,
            Some(json!({ "order_ids": [id(&first)], "channel": "email" })),
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    // Another clinic's owner finds nothing, and an unknown order stops the whole batch.
    let beta = app.token(BETA_OWNER);
    let (status, _) = call(
        &app,
        BETA,
        &beta,
        Method::POST,
        path,
        Some(json!({ "order_ids": [id(&first)], "channel": "email" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        path,
        Some(json!({ "order_ids": [id(&first), Uuid::now_v7()], "channel": "email" })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn labs_state_their_city_work_and_turnaround_and_orders_show_a_tracker_stage() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let made = ok(
        &app,
        &owner,
        Method::POST,
        "/api/v1/lab-vendors",
        Some(json!({ "name": "Pune Ceramics", "city": "Pune",
                     "work_types": ["Crown", "Aligner"], "turnaround_days": 5 })),
    )
    .await;
    assert_eq!(made["city"], "Pune");
    assert_eq!(made["work_types"], json!(["Crown", "Aligner"]));
    assert_eq!(made["turnaround_days"], 5);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        "/api/v1/lab-vendors",
        Some(json!({ "name": "Bad Lab", "turnaround_days": 91 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    // A lab with none of it reads as before.
    let plain = ok(
        &app,
        &owner,
        Method::POST,
        "/api/v1/lab-vendors",
        Some(json!({ "name": "Plain Lab" })),
    )
    .await;
    assert_eq!(plain["work_types"], json!([]));
    assert!(plain["city"].is_null() && plain["turnaround_days"].is_null());

    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let draft = order(&app, &owner, &id(&made), &ravi, false).await;
    assert_eq!(draft["tracker_stage"], "impression");
    let sent = order(&app, &owner, &id(&made), &ravi, true).await;
    assert_eq!(sent["tracker_stage"], "production");
    let trial = ok(
        &app,
        &owner,
        Method::PATCH,
        &format!("/api/v1/lab-orders/{}", id(&sent)),
        Some(json!({ "stage": "Wax try-in" })),
    )
    .await;
    assert_eq!(trial["tracker_stage"], "trial");
    let cancelled = ok(
        &app,
        &owner,
        Method::POST,
        &format!("/api/v1/lab-orders/{}/status", id(&draft)),
        Some(json!({ "status": "cancelled" })),
    )
    .await;
    assert!(cancelled["tracker_stage"].is_null());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn message_stats_are_counts_for_those_who_send_messages() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let numbers = ok(&app, &owner, Method::GET, "/api/v1/messages/stats", None).await;
    for key in [
        "since",
        "sent",
        "delivered",
        "failed",
        "skipped",
        "opt_outs",
    ] {
        assert!(
            !numbers[key].is_null() || key == "since",
            "{key}: {numbers}"
        );
    }
    assert!(numbers["since"].is_string());
    assert!(numbers["delivered_pct"].is_null(), "nothing sent yet");
    let channels: Vec<&str> = numbers["by_channel"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["channel"].as_str().unwrap())
        .collect();
    assert_eq!(channels, ["email", "sms", "whatsapp"]);
    let (status, _) = call(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        Method::GET,
        "/api/v1/messages/stats",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        BETA,
        &app.token(BETA_OWNER),
        Method::GET,
        "/api/v1/messages/stats",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "each clinic counts its own");
    app.finish().await;
}

async fn channel(app: &TestApp, token: &str) -> String {
    channel_at(app, ALPHA, token).await
}

async fn channel_at(app: &TestApp, host: &str, token: &str) -> String {
    let (status, list) = call(app, host, token, Method::GET, "/api/v1/conversations", None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let found = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["kind"] == "channel")
        .unwrap();
    assert_eq!(found["title"], "Everyone");
    id(found)
}

fn member_names(conversation: &Value) -> Vec<String> {
    let mut names: Vec<String> = conversation["members"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["name"].as_str().unwrap().to_owned())
        .collect();
    names.sort();
    names
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn everyone_channel_follows_the_staff_and_its_members_cannot_be_edited() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun = app.token(ALPHA_ASSISTANT);
    let everyone = channel(&app, &owner).await;
    assert_eq!(channel(&app, &arun).await, everyone);
    let path = format!("/api/v1/conversations/{everyone}");
    let detail = ok(&app, &owner, Method::GET, &path, None).await;
    assert_eq!(detail["kind"], "channel");
    assert!(member_names(&detail).contains(&"Arun Assistant".to_owned()));

    // Nobody manages it by hand.
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("{path}/leave"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("{path}/members"),
        Some(json!({ "membership_ids": [Uuid::now_v7()] })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    // Only its clinic sees it.
    let (status, _) = call(&app, BETA, &app.token(BETA_OWNER), Method::GET, &path, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_ne!(
        channel_at(&app, BETA, &app.token(BETA_OWNER)).await,
        everyone
    );

    // Suspending a member takes them out of it, and out of sight; activating puts them back.
    sqlx::query("update aarogyam.memberships set status = 'suspended' where user_id = '01900000-0000-7000-8000-0000000000a2'")
        .execute(&app.owner)
        .await
        .unwrap();
    let detail = ok(&app, &owner, Method::GET, &path, None).await;
    assert!(!member_names(&detail).contains(&"Arun Assistant".to_owned()));
    sqlx::query("update aarogyam.memberships set status = 'active' where user_id = '01900000-0000-7000-8000-0000000000a2'")
        .execute(&app.owner)
        .await
        .unwrap();
    let detail = ok(&app, &owner, Method::GET, &path, None).await;
    assert!(member_names(&detail).contains(&"Arun Assistant".to_owned()));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_newest_notice_is_pinned_and_only_chat_notice_posts_one() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun = app.token(ALPHA_ASSISTANT);
    let everyone = channel(&app, &owner).await;
    let messages = format!("/api/v1/conversations/{everyone}/messages");
    let detail = format!("/api/v1/conversations/{everyone}");
    let notice =
        |text: &str| json!({ "client_id": Uuid::now_v7(), "body": text, "is_notice": true });

    let (status, _) = call(
        &app,
        ALPHA,
        &arun,
        Method::POST,
        &messages,
        Some(notice("Staff meeting")),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let ravi = patient(&app, &owner, "Ravi Kumar").await;
    let mut with_patient = notice("About Ravi");
    with_patient["patient_id"] = json!(ravi);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &messages,
        Some(with_patient),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(ok(&app, &owner, Method::GET, &detail, None).await["pinned_notice"].is_null());

    let older = ok(
        &app,
        &owner,
        Method::POST,
        &messages,
        Some(notice("Closed on Friday")),
    )
    .await;
    assert_eq!(older["is_notice"], true);
    let newer = ok(
        &app,
        &owner,
        Method::POST,
        &messages,
        Some(notice("Meeting at 9")),
    )
    .await;
    // Ordinary messages are not notices and don't unpin.
    let plain = ok(
        &app,
        &arun,
        Method::POST,
        &messages,
        Some(json!({ "client_id": Uuid::now_v7(), "body": "Noted" })),
    )
    .await;
    assert_eq!(plain["is_notice"], false);
    let seen = ok(&app, &arun, Method::GET, &detail, None).await;
    assert_eq!(seen["pinned_notice"]["id"], newer["id"]);
    assert_eq!(seen["pinned_notice"]["body"], "Meeting at 9");

    // Deleting the newest brings the older back.
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::DELETE,
        &format!("{messages}/{}", id(&newer)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let seen = ok(&app, &arun, Method::GET, &detail, None).await;
    assert_eq!(seen["pinned_notice"]["id"], older["id"]);
    app.finish().await;
}

async fn send_file(
    app: &TestApp,
    host: &str,
    token: &str,
    conversation: &str,
    client_id: Uuid,
    bytes: &[u8],
    name: &str,
) -> (StatusCode, Value) {
    const BOUNDARY: &str = "aarogyam-chat-boundary";
    let mut body = format!(
        "--{BOUNDARY}\r\nContent-Disposition: form-data; name=\"client_id\"\r\n\r\n{client_id}\r\n\
         --{BOUNDARY}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n\
         Content-Type: application/octet-stream\r\n\r\n"
    )
    .into_bytes();
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{BOUNDARY}--\r\n").as_bytes());
    let request = Request::post(format!("/api/v1/conversations/{conversation}/attachments"))
        .header("host", host)
        .header("authorization", format!("Bearer {token}"))
        .header(
            "content-type",
            format!("multipart/form-data; boundary={BOUNDARY}"),
        )
        .body(Body::from(body))
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

async fn fetch(app: &TestApp, host: &str, path: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    let request = Request::get(path)
        .header("host", host)
        .body(Body::empty())
        .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 16 * 1024 * 1024)
        .await
        .unwrap();
    (status, headers, bytes.to_vec())
}

fn stored_files(app: &TestApp) -> usize {
    fn count(dir: &std::path::Path) -> usize {
        std::fs::read_dir(dir).map_or(0, |entries| {
            entries
                .flatten()
                .map(|e| {
                    if e.path().is_dir() {
                        count(&e.path())
                    } else {
                        1
                    }
                })
                .sum()
        })
    }
    count(&app.files_dir)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn chat_files_are_small_checked_by_content_and_only_for_members() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let arun = app.token(ALPHA_ASSISTANT);
    let farah = app.token(ALPHA_FRONT_DESK);
    let beta = app.token(BETA_OWNER);
    let everyone = channel(&app, &owner).await;
    let arun_id = {
        let staff = ok(&app, &owner, Method::GET, "/api/v1/staff", None).await;
        let found = staff["members"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["display_name"] == "Arun Assistant")
            .unwrap();
        id(found)
    };
    let direct = ok(
        &app,
        &owner,
        Method::POST,
        "/api/v1/conversations",
        Some(json!({ "kind": "direct", "membership_id": arun_id })),
    )
    .await;
    let direct = id(&direct);

    // Post a PNG to the direct conversation.
    let key = Uuid::now_v7();
    let (status, posted) =
        send_file(&app, ALPHA, &owner, &direct, key, PNG, "../scans/opg.png").await;
    assert_eq!(status, StatusCode::CREATED, "{posted}");
    assert_eq!(posted["attachment"]["mime_type"], "image/png");
    assert_eq!(posted["attachment"]["file_name"], "opg.png");
    assert!(posted["body"].is_null());
    let file = posted["attachment"]["id"].as_str().unwrap().to_owned();
    assert_eq!(stored_files(&app), 1);

    // Retry: the same message; another file with the same key conflicts.
    let (status, again) = send_file(&app, ALPHA, &owner, &direct, key, PNG, "opg.png").await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["id"], posted["id"]);
    assert_eq!(again["attachment"]["id"], file);
    let (status, _) = send_file(&app, ALPHA, &owner, &direct, key, PDF, "other.pdf").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(stored_files(&app), 1);

    // The page shows it; the other member gets a link and the bytes.
    let page = ok(
        &app,
        &arun,
        Method::GET,
        &format!("/api/v1/conversations/{direct}/messages"),
        None,
    )
    .await;
    assert_eq!(page["items"][0]["attachment"]["id"], file);
    let link = ok(
        &app,
        &arun,
        Method::GET,
        &format!("/api/v1/chat-attachments/{file}/download"),
        None,
    )
    .await;
    let url = link["url"].as_str().unwrap().to_owned();
    let (status, headers, bytes) = fetch(&app, ALPHA, &url).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(bytes, PNG);
    assert_eq!(headers["content-type"], "image/png");
    assert_eq!(headers["x-content-type-options"], "nosniff");
    // Not on another clinic's host, not without a token, not with a mangled one.
    assert_eq!(fetch(&app, BETA, &url).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        fetch(
            &app,
            ALPHA,
            &format!("/api/v1/chat-attachments/{file}/content")
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        fetch(&app, ALPHA, &format!("{url}x")).await.0,
        StatusCode::NOT_FOUND
    );
    // A patient file's link is not a chat file's.
    // Outsiders: not in the conversation (404), another clinic (404), no chat (403).
    for (host, token) in [(ALPHA, &farah), (BETA, &beta)] {
        let (status, _) = call(
            &app,
            host,
            token,
            Method::GET,
            &format!("/api/v1/chat-attachments/{file}/download"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{host}");
    }
    let (status, _) = call(
        &app,
        ALPHA,
        &app.token(ALPHA_NOTHING),
        Method::GET,
        &format!("/api/v1/chat-attachments/{file}/download"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        send_file(&app, ALPHA, &farah, &direct, Uuid::now_v7(), PNG, "x.png")
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send_file(&app, BETA, &beta, &direct, Uuid::now_v7(), PNG, "x.png")
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        send_file(
            &app,
            ALPHA,
            &app.token(ALPHA_NOTHING),
            &direct,
            Uuid::now_v7(),
            PNG,
            "x.png"
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );

    // Content decides the type; size is capped at 5 MB.
    let (status, _) = send_file(
        &app,
        ALPHA,
        &owner,
        &everyone,
        Uuid::now_v7(),
        b"MZ\x90 not a picture",
        "virus.png",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = send_file(
        &app,
        ALPHA,
        &owner,
        &everyone,
        Uuid::now_v7(),
        b"",
        "empty.png",
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let mut big = PDF.to_vec();
    big.resize(5 * 1024 * 1024 + 1, 0);
    let (status, _) = send_file(
        &app,
        ALPHA,
        &owner,
        &everyone,
        Uuid::now_v7(),
        &big,
        "big.pdf",
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    let (status, pdf) = send_file(
        &app,
        ALPHA,
        &arun,
        &everyone,
        Uuid::now_v7(),
        PDF,
        "plan.pdf",
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{pdf}");
    assert_eq!(stored_files(&app), 2);

    // Only the author deletes; deleting removes the file and its link.
    let message = id(&posted);
    let (status, _) = call(
        &app,
        ALPHA,
        &arun,
        Method::DELETE,
        &format!("/api/v1/conversations/{direct}/messages/{message}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::DELETE,
        &format!("/api/v1/conversations/{direct}/messages/{message}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(stored_files(&app), 1);
    let (status, _) = call(
        &app,
        ALPHA,
        &arun,
        Method::GET,
        &format!("/api/v1/chat-attachments/{file}/download"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(fetch(&app, ALPHA, &url).await.0, StatusCode::NOT_FOUND);
    app.finish().await;
}
