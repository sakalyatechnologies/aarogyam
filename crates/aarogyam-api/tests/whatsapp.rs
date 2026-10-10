//! `WhatsApp` on a real database, against recorded and fake payloads only (never Meta): the
//! webhook's handshake and signature, statuses in any order, STOP replies that are never
//! stored or logged, the switched-off channel, Meta's permanent errors, and the template routes.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use aarogyam_notify::whatsapp::{Costs, Meta};
use aarogyam_notify::{Notifier, PortalLinks, WhatsappSetup};
use axum::http::{Method, StatusCode};
use secrecy::SecretString;
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp, send_with_headers};
use uuid::Uuid;

const APP_SECRET: &str = "test-app-secret";
const VERIFY_TOKEN: &str = "test-verify-token";

/// Answers a fake Graph API gives, in order, and the requests it got.
type Answers = Arc<Mutex<VecDeque<(u16, String)>>>;
type Seen = Arc<Mutex<Vec<Value>>>;

/// A fake Graph API on a local port: `POST /123456/messages` answers from `answers`.
async fn fake_meta(answers: Vec<(u16, &str)>) -> (String, Seen) {
    let queue: Answers = Arc::new(Mutex::new(
        answers
            .into_iter()
            .map(|(s, b)| (s, b.to_owned()))
            .collect(),
    ));
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let (q, s) = (Arc::clone(&queue), Arc::clone(&seen));
    let router = axum::Router::new().route(
        "/123456/messages",
        axum::routing::post(move |axum::Json(body): axum::Json<Value>| {
            let (q, s) = (Arc::clone(&q), Arc::clone(&s));
            async move {
                s.lock().unwrap().push(body);
                let (status, text) = q
                    .lock()
                    .unwrap()
                    .pop_front()
                    .unwrap_or((500, String::new()));
                (StatusCode::from_u16(status).unwrap(), text)
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    (format!("http://{address}"), seen)
}

fn setup(graph: Option<&str>) -> WhatsappSetup {
    WhatsappSetup {
        sender: graph.map(|url| Meta::new(SecretString::from("token"), "123456", url).unwrap()),
        app_secret: Some(SecretString::from(APP_SECRET)),
        verify_token: Some(SecretString::from(VERIFY_TOKEN)),
        costs: Costs::default(),
        daily_budget: 0,
    }
}

async fn start(graph: Option<&str>) -> TestApp {
    let setup = setup(graph);
    TestApp::start_custom(sakalya_http::HttpConfig::default(), move |state| {
        state.with_notifier(Notifier::log(PortalLinks::default()).with_whatsapp(setup))
    })
    .await
}

async fn call(
    app: &TestApp,
    host: &str,
    who: Uuid,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let token = app.token(who);
    app.send(method, host, path, Some(&token), body).await
}

/// A patient at `host` with `phone`, opted in to `WhatsApp`.
async fn patient(app: &TestApp, host: &str, owner: Uuid, phone: &str) -> String {
    let body = json!({ "full_name": "Asha K", "phone": phone });
    let (status, made) = call(
        app,
        host,
        owner,
        Method::POST,
        "/api/v1/patients",
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    let id = made["id"].as_str().unwrap().to_owned();
    let path = format!("/api/v1/patients/{id}/contact-preferences");
    let opt_in = json!({ "channel": "whatsapp", "category": "all", "opted_out": false, "whatsapp_opt_in": true });
    let (status, _) = call(app, host, owner, Method::POST, &path, Some(opt_in)).await;
    assert_eq!(status, StatusCode::OK);
    id
}

async fn approve_whatsapp_templates(app: &TestApp) {
    sqlx::query(
        "update aarogyam.message_templates set status = 'approved' where channel = 'whatsapp'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
}

async fn send_note(app: &TestApp, patient: &str) -> (StatusCode, Value) {
    let body = json!({
        "patient_ids": [patient], "channel": "whatsapp", "template_key": "care.note",
        "variables": { "subject": "Your crown is ready" }
    });
    call(
        app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        "/api/v1/messages",
        Some(body),
    )
    .await
}

async fn drain(app: &TestApp) {
    let (status, report) = app
        .send(
            Method::POST,
            "localhost",
            "/api/v1/internal/outbox/drain",
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{report}");
}

async fn last_outcome(
    app: &TestApp,
    patient: &str,
) -> (String, Option<String>, Option<i64>, Option<String>) {
    sqlx::query_as(
        "select status, skip_reason, cost_paise, provider_message_id from aarogyam.messages
         where patient_id = $1::uuid order by created_at desc, id desc limit 1",
    )
    .bind(patient)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn webhook(app: &TestApp, body: &Value, signature: Option<&str>) -> StatusCode {
    let signed = aarogyam_notify::hub_signature::sign(
        &SecretString::from(APP_SECRET),
        body.to_string().as_bytes(),
    );
    let headers = [("x-hub-signature-256", signature.unwrap_or(&signed))];
    let path = "/api/v1/webhooks/whatsapp";
    let (status, _) = send_with_headers(
        &app.router,
        Method::POST,
        "localhost",
        path,
        None,
        Some(body.clone()),
        &headers,
    )
    .await;
    status
}

fn statuses(wamid: &str, list: &[(&str, i64)]) -> Value {
    let statuses: Vec<Value> = list
        .iter()
        .map(|(status, at)| json!({ "id": wamid, "status": status, "timestamp": at.to_string(), "recipient_id": "919876543210" }))
        .collect();
    json!({ "object": "whatsapp_business_account", "entry": [{ "id": "1", "changes": [{
        "field": "messages",
        "value": { "messaging_product": "whatsapp", "metadata": { "phone_number_id": "123456" }, "statuses": statuses }
    }]}]})
}

fn inbound(from: &str, text: &str, context: Option<&str>) -> Value {
    let mut message = json!({ "from": from, "id": "wamid.in1", "timestamp": "1760000000", "type": "text", "text": { "body": text } });
    if let Some(id) = context {
        message["context"] = json!({ "from": "15550001111", "id": id });
    }
    json!({ "object": "whatsapp_business_account", "entry": [{ "id": "1", "changes": [{
        "field": "messages",
        "value": { "messaging_product": "whatsapp", "contacts": [{ "profile": { "name": "Asha" }, "wa_id": from }], "messages": [message] }
    }]}]})
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_handshake_needs_the_verify_token_and_posts_need_the_signature() {
    let app = start(None).await;
    let path = |token: &str| {
        format!(
            "/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=1158201444"
        )
    };
    let (status, echoed) = app
        .send(Method::GET, "localhost", &path(VERIFY_TOKEN), None, None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(echoed, json!(1_158_201_444));
    let (status, _) = app
        .send(Method::GET, "localhost", &path("wrong"), None, None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let body = statuses("wamid.none", &[("delivered", 1_760_000_000)]);
    assert_eq!(webhook(&app, &body, None).await, StatusCode::OK);
    let tampered = aarogyam_notify::hub_signature::sign(&SecretString::from(APP_SECRET), b"{}");
    assert_eq!(
        webhook(&app, &body, Some(&tampered)).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        webhook(&app, &body, Some("")).await,
        StatusCode::UNAUTHORIZED
    );

    // Without the secrets nothing is accepted.
    let plain = TestApp::start().await;
    let (status, _) = plain
        .send(Method::GET, "localhost", &path(VERIFY_TOKEN), None, None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(webhook(&plain, &body, None).await, StatusCode::UNAUTHORIZED);
    app.finish().await;
    plain.finish().await;
}

/// Marks the patient's latest message as sent by Meta as `wamid`.
async fn as_sent_by_meta(app: &TestApp, patient: &str, wamid: &str) {
    sqlx::query(
        "update aarogyam.messages set provider = 'meta', provider_message_id = $2
         where id = (select id from aarogyam.messages where patient_id = $1::uuid
                     order by created_at desc limit 1)",
    )
    .bind(patient)
    .bind(wamid)
    .execute(&app.owner)
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_channel_switched_off_skips_and_statuses_arrive_in_any_order() {
    let app = start(None).await;
    approve_whatsapp_templates(&app).await;
    let asha = patient(&app, ALPHA, ALPHA_OWNER, "98765 43210").await;
    // Free text never goes on WhatsApp.
    let text = json!({ "patient_ids": [&asha], "channel": "whatsapp", "template_key": "care.note",
                       "variables": { "subject": "Hi" }, "body": "Anything at all" });
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        "/api/v1/messages",
        Some(text),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, queued) = send_note(&app, &asha).await;
    assert_eq!(status, StatusCode::ACCEPTED, "{queued}");
    drain(&app).await;
    let (status, reason, _, _) = last_outcome(&app, &asha).await;
    assert_eq!(
        (status.as_str(), reason.as_deref()),
        ("skipped", Some("channel_disabled"))
    );

    // Statuses: read before delivered before sent, and a repeat; the furthest stays.
    as_sent_by_meta(&app, &asha, "wamid.A1").await;
    let late = statuses(
        "wamid.A1",
        &[("read", 1_760_000_002), ("delivered", 1_760_000_002)],
    );
    assert_eq!(webhook(&app, &late, None).await, StatusCode::OK);
    let early = statuses(
        "wamid.A1",
        &[("sent", 1_760_000_001), ("read", 1_760_000_002)],
    );
    assert_eq!(webhook(&app, &early, None).await, StatusCode::OK);
    let (delivery, events): (Option<String>, i64) = sqlx::query_as(
        "select m.delivery, (select count(*) from aarogyam.message_events e where e.message_id = m.id)
         from aarogyam.messages m where m.provider_message_id = 'wamid.A1'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((delivery.as_deref(), events), (Some("read"), 3));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn meta_errors_skip_or_retry_and_sends_carry_the_template_and_cost() {
    let limit = r#"{"error":{"message":"(#131049) This message was not delivered to maintain healthy ecosystem engagement.","type":"OAuthException","code":131049,"fbtrace_id":"A1"}}"#;
    let ok = r#"{"messaging_product":"whatsapp","contacts":[{"input":"919876543210","wa_id":"919876543210"}],"messages":[{"id":"wamid.OK1"}]}"#;
    let (graph, seen) = fake_meta(vec![(503, ""), (400, limit), (200, ok)]).await;
    let app = start(Some(&graph)).await;
    let asha = patient(&app, ALPHA, ALPHA_OWNER, "98765 43210").await;
    // Not approved yet: refused when queued.
    let (status, _) = send_note(&app, &asha).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    approve_whatsapp_templates(&app).await;

    send_note(&app, &asha).await;
    drain(&app).await;
    let (status, reason, _, _) = last_outcome(&app, &asha).await;
    assert_eq!(
        (status.as_str(), reason),
        ("queued", None),
        "an outage retries"
    );
    send_note(&app, &asha).await;
    drain(&app).await;
    let (status, reason, _, _) = last_outcome(&app, &asha).await;
    assert_eq!(
        (status.as_str(), reason.as_deref()),
        ("skipped", Some("marketing_limit"))
    );
    send_note(&app, &asha).await;
    drain(&app).await;
    let (status, _, cost, wamid) = last_outcome(&app, &asha).await;
    assert_eq!(
        (status.as_str(), cost, wamid.as_deref()),
        ("sent", Some(13), Some("wamid.OK1"))
    );

    let requests = seen.lock().unwrap().clone();
    let request = requests.last().unwrap();
    assert_eq!(request["to"], "919876543210");
    assert_eq!(request["type"], "template");
    assert_eq!(request["template"]["name"], "aro_care_note_v1");
    let parameters = &request["template"]["components"][0]["parameters"];
    assert_eq!(parameters[0]["text"], "Alpha Dental");
    assert_eq!(parameters[1]["text"], "Your crown is ready");

    // Without the opt-in, nothing goes.
    let ravi = {
        let body = json!({ "full_name": "Ravi K", "phone": "98765 00000" });
        let (_, made) = call(
            &app,
            ALPHA,
            ALPHA_OWNER,
            Method::POST,
            "/api/v1/patients",
            Some(body),
        )
        .await;
        made["id"].as_str().unwrap().to_owned()
    };
    send_note(&app, &ravi).await;
    drain(&app).await;
    let (_, reason, _, _) = last_outcome(&app, &ravi).await;
    assert_eq!(reason.as_deref(), Some("no_opt_in"));
    app.finish().await;
}

/// A log writer the test can read back.
#[derive(Clone, Default)]
struct Logs(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Logs {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Every row of every table, as text, that contains `needle`.
async fn rows_containing(app: &TestApp, needle: &str) -> Vec<String> {
    let tables: Vec<(String, String)> = sqlx::query_as(
        "select table_schema::text, table_name::text from information_schema.tables
         where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    let mut found = Vec::new();
    for (schema, table) in tables {
        let query = format!(
            "select count(*) from \"{schema}\".\"{table}\" t where row_to_json(t)::text like '%' || $1 || '%'"
        );
        let Ok(count) = sqlx::query_scalar::<_, i64>(
            // Names come from the catalogue and are quoted; the needle is bound.
            sqlx::AssertSqlSafe(query),
        )
        .bind(needle)
        .fetch_one(&app.owner)
        .await
        else {
            continue;
        };
        if count > 0 {
            found.push(format!("{schema}.{table}"));
        }
    }
    found
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn stop_opts_out_at_the_clinic_replied_to_and_its_text_is_never_kept() {
    let logs = Logs::default();
    let writer = logs.clone();
    let subscriber = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || writer.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(subscriber);

    let app = start(None).await;
    let asha = patient(&app, ALPHA, ALPHA_OWNER, "98765 43210").await;
    let asha_beta = patient(&app, BETA, BETA_OWNER, "98765 43210").await;
    approve_whatsapp_templates(&app).await;
    send_note(&app, &asha).await;
    as_sent_by_meta(&app, &asha, "wamid.ALPHA1").await;

    // A chat message (not STOP) and a STOP quoting Alpha's message, in Marathi.
    let secret = "xyzzy-private-42 about my tooth";
    assert_eq!(
        webhook(&app, &inbound("919876543210", secret, None), None).await,
        StatusCode::OK
    );
    let stop = inbound("919876543210", " थांबवा ", Some("wamid.ALPHA1"));
    assert_eq!(webhook(&app, &stop, None).await, StatusCode::OK);

    let opted: Vec<(String, String, bool, String)> = sqlx::query_as(
        "select patient_id::text, channel, opted_out, source from aarogyam.contact_preferences
         where channel = 'whatsapp' and opted_out order by patient_id",
    )
    .fetch_all(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        opted,
        vec![(asha.clone(), "whatsapp".into(), true, "stop_keyword".into())]
    );
    let _ = asha_beta;
    for needle in ["xyzzy-private-42", "थांबवा"] {
        assert_eq!(
            rows_containing(&app, needle).await,
            Vec::<String>::new(),
            "{needle}"
        );
        let written = String::from_utf8_lossy(&logs.0.lock().unwrap()).to_string();
        assert!(!written.contains(needle), "{needle} reached the logs");
        assert!(
            !written.contains("9876543210"),
            "the phone reached the logs"
        );
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn stop_with_no_recent_message_opts_out_where_whatsapp_was_queued() {
    let app = start(None).await;
    let asha = patient(&app, BETA, BETA_OWNER, "98765 11111").await;
    sqlx::query(
        "insert into aarogyam.messages (org_id, patient_id, channel, kind, purpose, template_key)
         select org_id, id, 'whatsapp', 'clinic.message', 'care', 'care.note'
         from aarogyam.patients where id = $1::uuid",
    )
    .bind(&asha)
    .execute(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        webhook(&app, &inbound("919876511111", "STOP", None), None).await,
        StatusCode::OK
    );
    let (status, reason, _, _) = last_outcome(&app, &asha).await;
    assert_eq!(
        (status.as_str(), reason.as_deref()),
        ("skipped", Some("opted_out"))
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one story: list, guard, edit, submit, review"
)]
async fn templates_are_the_clinics_own_and_take_allow_listed_variables_only() {
    let app = start(None).await;
    let (status, list) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::GET,
        "/api/v1/templates",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let items = list["items"].as_array().unwrap();
    assert!(items.iter().any(|t| t["key"] == "booking.confirmed"
        && t["channel"] == "email"
        && t["status"] == "approved"));
    let note = items
        .iter()
        .find(|t| t["key"] == "care.note" && t["channel"] == "whatsapp")
        .unwrap();
    assert_eq!(note["status"], "draft");
    let id = note["id"].as_str().unwrap();
    let path = format!("/api/v1/templates/{id}");
    let submit = format!("{path}/submit");

    // Settings permission, and the clinic's own rows only.
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_FRONT_DESK,
        Method::GET,
        "/api/v1/templates",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = call(&app, ALPHA, ALPHA_FRONT_DESK, Method::POST, &submit, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let edit = json!({ "body": "{{clinic_name}}: {{subject}}." });
    let (status, _) = call(
        &app,
        BETA,
        BETA_OWNER,
        Method::PATCH,
        &path,
        Some(edit.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = call(&app, BETA, BETA_OWNER, Method::POST, &submit, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Only allow-listed variables.
    let name = json!({ "body": "Hello {{patient_name}}" });
    let (status, refused) = call(&app, ALPHA, ALPHA_OWNER, Method::PATCH, &path, Some(name)).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{refused}");
    let new = json!({ "key": "care.note", "channel": "whatsapp", "language": "hi-IN",
                      "body": "{{clinic_name}}: {{diagnosis}}", "category": "utility" });
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        "/api/v1/templates",
        Some(new),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let hindi = json!({ "key": "care.note", "channel": "whatsapp", "language": "hi-IN",
                        "body": "{{clinic_name}}: {{subject}}", "category": "utility",
                        "provider_template_ref": "aro_care_note_v1" });
    let (status, made) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        "/api/v1/templates",
        Some(hindi.clone()),
    )
    .await;
    assert_eq!(
        (status, made["status"].as_str()),
        (StatusCode::CREATED, Some("draft"))
    );
    let (status, _) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::POST,
        "/api/v1/templates",
        Some(hindi),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // Submitted by hand, then Meta's review arrives by webhook.
    let (status, submitted) = call(&app, ALPHA, ALPHA_OWNER, Method::POST, &submit, None).await;
    assert_eq!(
        (status, submitted["status"].as_str()),
        (StatusCode::OK, Some("submitted"))
    );
    let review = json!({ "object": "whatsapp_business_account", "entry": [{ "id": "1", "changes": [{
        "field": "message_template_status_update",
        "value": { "event": "APPROVED", "message_template_id": 1, "message_template_name": "aro_care_note_v1",
                   "message_template_language": "en", "reason": "NONE" } }]}]});
    assert_eq!(webhook(&app, &review, None).await, StatusCode::OK);
    let (_, list) = call(
        &app,
        ALPHA,
        ALPHA_OWNER,
        Method::GET,
        "/api/v1/templates",
        None,
    )
    .await;
    let statuses: Vec<(String, String)> = list["items"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["key"] == "care.note" && t["channel"] == "whatsapp")
        .map(|t| {
            (
                t["language"].as_str().unwrap().to_owned(),
                t["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert_eq!(
        statuses,
        vec![
            ("en-IN".into(), "approved".into()),
            ("hi-IN".into(), "draft".into())
        ]
    );
    // Beta's copy was never submitted: it stays a draft.
    let (_, beta) = call(
        &app,
        BETA,
        BETA_OWNER,
        Method::GET,
        "/api/v1/templates",
        None,
    )
    .await;
    assert!(
        beta["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["key"] == "care.note"
                && t["channel"] == "whatsapp"
                && t["status"] == "draft")
    );

    // Editing the text sends it back to draft; email templates aren't reviewed.
    let (status, edited) = call(&app, ALPHA, ALPHA_OWNER, Method::PATCH, &path, Some(edit)).await;
    assert_eq!(
        (status, edited["status"].as_str()),
        (StatusCode::OK, Some("draft"))
    );
    let email = items
        .iter()
        .find(|t| t["key"] == "care.note" && t["channel"] == "email")
        .unwrap();
    let email_submit = format!("/api/v1/templates/{}/submit", email["id"].as_str().unwrap());
    let (status, _) = call(&app, ALPHA, ALPHA_OWNER, Method::POST, &email_submit, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}
