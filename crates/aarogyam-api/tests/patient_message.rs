//! The visit summary for the doctor's own `WhatsApp` on a real database: the message and its
//! link, who it goes to, every refusal, the three-live-links cap, the richer shared visit page,
//! and the cross-clinic 404.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), body).await
}

async fn register(app: &TestApp, token: &str, body: Value) -> String {
    let (status, made) = post(app, ALPHA, token, "/api/v1/patients", Some(body)).await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn start_visit(app: &TestApp, token: &str, patient: &str) -> String {
    let (status, visit) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/visits"),
        Some(json!({ "chief_complaint": "Pain lower right" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    visit["id"].as_str().unwrap().to_owned()
}

async fn close(app: &TestApp, token: &str, visit: &str) {
    let (status, body) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

async fn closed_visit(app: &TestApp, token: &str, patient: &str) -> String {
    let visit = start_visit(app, token, patient).await;
    close(app, token, &visit).await;
    visit
}

fn message_path(visit: &str) -> String {
    format!("/api/v1/visits/{visit}/patient-message")
}

async fn refusal(app: &TestApp, token: &str, visit: &str) -> String {
    let (status, body) = post(app, ALPHA, token, &message_path(visit), None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    body["error"]["code"].as_str().unwrap().to_owned()
}

async fn live_links(app: &TestApp, visit: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "select count(*) from aarogyam.share_links where resource = 'visit'
         and encounter_id = $1 and revoked_at is null and expires_at > now()",
    )
    .bind(visit.parse::<Uuid>().unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_closed_visit_gives_the_message_a_link_and_a_pin_and_never_more_than_three_links() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(
        &app,
        &owner,
        json!({ "full_name": "Meera Shah", "sex": "female", "age_years": 34,
                "phone": "98765 43210", "email": "meera@example.in" }),
    )
    .await;
    let visit = start_visit(&app, &owner, &patient).await;
    let procedures = format!("/api/v1/visits/{visit}/procedures");
    let (status, done) = post(
        &app,
        ALPHA,
        &owner,
        &procedures,
        Some(json!({ "name": "Extraction", "tooth": 46 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{done}");
    let (status, planned) = post(
        &app,
        ALPHA,
        &owner,
        &procedures,
        Some(json!({ "name": "Implant", "tooth": 46, "status": "planned",
                     "price_paise": 2_500_000 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{planned}");
    let (status, rx) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/prescriptions"),
        Some(json!({ "encounter_id": visit, "items": [
            { "drug_name": "Amoxicillin", "strength": "500 mg", "dose": "1 capsule",
              "frequency": "1-0-1", "duration_days": 5 }
        ] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{rx}");
    let (status, issued) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/prescriptions/{}/issue", rx["id"].as_str().unwrap()),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{issued}");

    // An accepted plan item shows on the plan too.
    let (status, plan) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{patient}/treatment-plans"),
        Some(json!({ "title": "Cleaning", "visit_id": visit,
                     "items": [{ "name": "Scaling", "estimate_paise": 80_000 }] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{plan}");
    let (status, accepted) = post(
        &app,
        ALPHA,
        &owner,
        &format!(
            "/api/v1/treatment-plans/{}/accept",
            plan["id"].as_str().unwrap()
        ),
        Some(json!({ "item_ids": [plan["items"][0]["id"]] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{accepted}");

    // An open visit has no summary yet.
    assert_eq!(refusal(&app, &owner, &visit).await, "visit_open");
    close(&app, &owner, &visit).await;
    // Closing queued the automatic summary, with its own link.
    assert_eq!(live_links(&app, &visit).await, 1);

    let (status, headers, body) = app
        .send_full(
            Method::POST,
            ALPHA,
            &message_path(&visit),
            Some(&owner),
            None,
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(body["recipient"], "patient");
    assert_eq!(body["phone_e164"], "+919876543210");
    assert!(body["auto_sent_at"].is_string(), "{body}");
    let pin = body["pin"].as_str().unwrap();
    assert_eq!(pin.len(), 6);
    let url = body["url"].as_str().unwrap();
    let token = url.rsplit("/shared/").next().unwrap();
    assert!(url.contains("/shared/"), "{url}");
    let text = body["text"].as_str().unwrap();
    for part in [
        "Hello Meera",
        "*Alpha Dental*",
        "• Extraction on the lower right back tooth (46).",
        "  Next: Implant.",
        "Implant, lower right back tooth (46) (about ₹25,000)",
        "Scaling (about ₹800)",
        "Keep biting on the gauze",
        "AMOXICILLIN 500 mg: 1-0-1, 5 days",
        "To book, reply here",
        "Please don't forward it.",
    ] {
        assert!(text.contains(part), "missing {part}: {text}");
    }
    // The typed complaint stays on the page, out of the text.
    assert!(!text.contains("Pain lower right"), "{text}");
    let desktop = body["desktop_text"].as_str().unwrap();
    assert!(desktop.contains(url) && !desktop.contains(pin), "{desktop}");
    assert!(
        !desktop.contains('✅') && !desktop.contains('🙏'),
        "{desktop}"
    );
    assert!(text.contains(url) && !text.contains(pin));
    let short = body["short_text"].as_str().unwrap();
    assert!(short.contains(url) && !short.contains(pin));
    for word in ["Meera", "Extraction", "AMOXICILLIN", "Pain", "tooth"] {
        assert!(!short.contains(word), "short text has {word}: {short}");
    }
    assert!(body["expires_at"].is_string());

    // The link opens the visit page with the PIN.
    let (status, page) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/shared/{token}/visit"),
            None,
            Some(json!({ "pin": pin })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    // The page carries the visit story, and nothing about notes or other staff.
    assert_eq!(page["chief_complaint"], "Pain lower right");
    assert_eq!(page["plan"][0]["source"], "procedure");
    assert_eq!(page["plan"][0]["name"], "Implant");
    assert_eq!(page["plan"][0]["tooth"], 46);
    // The page's chart is the mouth snapshot, the same builder as Present mode.
    assert_eq!(page["chart"]["story_version"], 1, "{page}");
    assert!(page["chart"]["positions"].is_array(), "{page}");
    assert!(!page["chart"].to_string().contains("\"note\""), "{page}");
    assert_eq!(page["plan"][0]["estimate_paise"], 2_500_000);
    assert_eq!(page["plan"][1]["source"], "plan_item");
    assert_eq!(page["plan"][1]["estimate_paise"], 80_000);
    assert_eq!(page["plan"].as_array().unwrap().len(), 2);
    assert_eq!(page["medicines"][0]["frequency"], "1-0-1");
    assert_eq!(page["medicines"][0]["duration_days"], 5);
    assert_eq!(page["aftercare"][0]["key"], "extraction");
    assert!(page["aftercare"][0]["steps"].as_array().unwrap().len() >= 3);
    assert!(page.get("notes").is_none());
    // A clinic that hides estimates shows none.
    sqlx::query(
        "insert into aarogyam.org_settings (org_id, billing)
         select org_id, '{\"patient_estimates\": false}' from aarogyam.encounters
         where id = $1::uuid
         on conflict (org_id) do update
           set billing = aarogyam.org_settings.billing || excluded.billing",
    )
    .bind(&visit)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, page) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/shared/{token}/visit"),
            None,
            Some(json!({ "pin": pin })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    assert!(page["plan"][0]["estimate_paise"].is_null(), "{page}");
    assert_eq!(page["plan"][0]["name"], "Implant");

    // Earlier links stay valid, but no more than three live at once.
    assert_eq!(live_links(&app, &visit).await, 2);
    for _ in 0..2 {
        let (status, _) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
        assert_eq!(status, StatusCode::OK);
    }
    assert_eq!(live_links(&app, &visit).await, 3);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/shared/{token}/visit"),
            None,
            Some(json!({ "pin": pin })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "the second-newest link still opens");

    // Another clinic's member gets 404; a role without clinical.read gets 403.
    let beta = app.token(BETA_OWNER);
    let (status, _) = post(&app, BETA, &beta, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = post(&app, ALPHA, &desk, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &message_path(&Uuid::now_v7().to_string()),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn refusals_say_why_and_an_erased_patient_is_not_found() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);

    // No mobile, and no relative to reach.
    let no_phone = register(
        &app,
        &owner,
        json!({ "full_name": "Arjun Rao", "sex": "male", "age_years": 40 }),
    )
    .await;
    let visit = closed_visit(&app, &owner, &no_phone).await;
    assert_eq!(refusal(&app, &owner, &visit).await, "no_phone");

    // Opted out of care messages on WhatsApp.
    let opted = register(
        &app,
        &owner,
        json!({ "full_name": "Leela Mehta", "sex": "female", "age_years": 52,
                "phone": "98765 11111" }),
    )
    .await;
    let (status, saved) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{opted}/contact-preferences"),
        Some(json!({ "channel": "whatsapp", "category": "care", "opted_out": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let visit = closed_visit(&app, &owner, &opted).await;
    assert_eq!(refusal(&app, &owner, &visit).await, "opted_out");

    // Care consent withdrawn.
    let withdrawn = register(
        &app,
        &owner,
        json!({ "full_name": "Kiran Das", "sex": "male", "age_years": 29,
                "phone": "98765 22222" }),
    )
    .await;
    let (status, given) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{withdrawn}/consents"),
        Some(json!({ "purpose": "care", "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{given}");
    let (status, body) = post(
        &app,
        ALPHA,
        &owner,
        &format!(
            "/api/v1/consents/{}/withdraw",
            given["id"].as_str().unwrap()
        ),
        Some(json!({ "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let visit = closed_visit(&app, &owner, &withdrawn).await;
    assert_eq!(refusal(&app, &owner, &visit).await, "no_consent");

    // An erased patient's visit is not found.
    let erased = register(
        &app,
        &owner,
        json!({ "full_name": "Old Patient", "sex": "female", "age_years": 70,
                "phone": "98765 33333" }),
    )
    .await;
    let visit = closed_visit(&app, &owner, &erased).await;
    sqlx::query(
        "update aarogyam.patients set status = 'erased', erased_at = now(), deleted_at = now()
         where id = $1::uuid",
    )
    .bind(&erased)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, _) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_minor_goes_to_the_guardian_and_an_adult_without_a_mobile_to_the_primary_contact() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let mother = register(
        &app,
        &owner,
        json!({ "full_name": "Priya Shah", "sex": "female", "age_years": 38,
                "phone": "98765 44444" }),
    )
    .await;
    let child = register(
        &app,
        &owner,
        json!({ "full_name": "Aarav Shah", "sex": "male", "age_years": 9,
                "phone": "98765 55555" }),
    )
    .await;
    let (status, link) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{child}/family"),
        Some(json!({ "related_patient_id": mother, "relation": "guardian" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    let visit = closed_visit(&app, &owner, &child).await;
    let (status, body) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["recipient"], "guardian");
    assert_eq!(body["phone_e164"], "+919876544444");
    let text = body["text"].as_str().unwrap();
    assert!(text.contains("your child Aarav's visit"), "{text}");

    // The mother withdrawing care consent stops it, though the child's own consent stands.
    let (status, given) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{mother}/consents"),
        Some(json!({ "purpose": "care", "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{given}");
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!(
            "/api/v1/consents/{}/withdraw",
            given["id"].as_str().unwrap()
        ),
        Some(json!({ "method": "verbal" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(refusal(&app, &owner, &visit).await, "no_consent");

    // An adult with no mobile reaches the relative marked as primary contact; an adult with
    // their own mobile always gets their own.
    let son = register(
        &app,
        &owner,
        json!({ "full_name": "Rohan Iyer", "sex": "male", "age_years": 45,
                "phone": "98765 66666" }),
    )
    .await;
    let elder = register(
        &app,
        &owner,
        json!({ "full_name": "Kamala Iyer", "sex": "female", "age_years": 80 }),
    )
    .await;
    let (status, link) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{elder}/family"),
        Some(json!({ "related_patient_id": son, "relation": "child",
                     "is_primary_contact": true })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    let visit = closed_visit(&app, &owner, &elder).await;
    let (status, body) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["recipient"], "guardian");
    assert_eq!(body["phone_e164"], "+919876566666");
    assert!(body["text"].as_str().unwrap().contains("Hello Kamala"));
    let visit = closed_visit(&app, &owner, &son).await;
    let (status, body) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["recipient"], "patient");
    assert_eq!(body["phone_e164"], "+919876566666");
}

async fn chart(app: &TestApp, token: &str, patient: &str, visit: &str, entry: Value) {
    let (status, body) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/dental-chart"),
        Some(json!({ "visit_id": visit, "entries": [entry] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

/// The message text and the visit page its link opens.
async fn message_and_page(app: &TestApp, token: &str, visit: &str) -> (String, Value) {
    let (status, body) = post(app, ALPHA, token, &message_path(visit), None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let url = body["url"].as_str().unwrap();
    let link = url.rsplit("/shared/").next().unwrap();
    let (status, page) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/shared/{link}/visit"),
            None,
            Some(json!({ "pin": body["pin"] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{page}");
    (body["text"].as_str().unwrap().to_owned(), page)
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn treatments_recorded_on_the_chart_are_in_the_summary_once() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(
        &app,
        &owner,
        json!({ "full_name": "Ravi Kumar", "sex": "male", "age_years": 41,
                "phone": "98765 43211" }),
    )
    .await;

    // A root canal sitting recorded only on the chart, still in progress.
    let visit = start_visit(&app, &owner, &patient).await;
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!({ "tooth": 21, "finding": "root_canal", "procedure": "root_canal", "sitting": 4,
                "material": "calcium_hydroxide", "in_progress": true }),
    )
    .await;
    close(&app, &owner, &visit).await;
    let (text, page) = message_and_page(&app, &owner, &visit).await;
    for part in [
        "Done today",
        "• Root canal treatment on the upper left front tooth (21), sitting 4, continuing.",
        "  Today: a medicine (calcium hydroxide) was placed inside the tooth.",
        // The first step of the between-sittings care.
        "Don't bite hard or sticky food on this tooth",
    ] {
        assert!(text.contains(part), "missing {part}: {text}");
    }
    // Only recorded facts: no finding on 21, so no Why; no temporary filling recorded.
    assert!(
        !text.contains("Why:") && !text.contains("temporary"),
        "{text}"
    );
    let treatments = page["treatments"].as_array().unwrap();
    assert_eq!(treatments.len(), 1, "{page}");
    assert_eq!(
        treatments[0]["name"],
        "Root canal treatment (sitting 4, continuing)"
    );
    assert_eq!(treatments[0]["tooth"], 21);
    assert_eq!(page["aftercare"][0]["key"], "root_canal_between_sittings");

    // A procedure and a chart entry for the same work on the same tooth make one line.
    let visit = start_visit(&app, &owner, &patient).await;
    let (status, done) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/procedures"),
        Some(json!({ "name": "Composite filling", "tooth": 36 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{done}");
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!({ "tooth": 36, "surface": "O", "finding": "filled", "procedure": "filling" }),
    )
    .await;
    close(&app, &owner, &visit).await;
    let (text, page) = message_and_page(&app, &owner, &visit).await;
    assert_eq!(text.matches("lower left back tooth").count(), 1, "{text}");
    let treatments = page["treatments"].as_array().unwrap();
    assert_eq!(treatments.len(), 1, "{page}");
    assert_eq!(treatments[0]["name"], "Composite filling");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_summary_reads_chips_findings_and_health_but_never_note_text() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(
        &app,
        &owner,
        json!({ "full_name": "Kiran Rao", "sex": "male", "age_years": 52,
                "phone": "98765 43212" }),
    )
    .await;

    // A check-up: chips and free text in the note, decay charted, a tooth needing treatment.
    let visit = start_visit(&app, &owner, &patient).await;
    let (status, note) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/notes"),
        Some(json!({ "sections": {
            "subjective": "k/c/o diabetes\nComplains of toothache",
            "objective": "Deep caries\nBP 150/95",
            "plan": "Soft, cold diet for 24 hours.\nRecall after HbA1c"
        } })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!({ "tooth": 36, "finding": "caries" }),
    )
    .await;
    let (status, health) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/patients/{patient}/dental-chart/teeth/47/status"),
            Some(&owner),
            Some(json!({ "health": "needs_treatment", "treat_within_months": 3 })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{health}");
    close(&app, &owner, &visit).await;
    let (text, _) = message_and_page(&app, &owner, &visit).await;
    for part in [
        "• Toothache",
        "• Check-up and examination of 2 teeth",
        "*What we found*",
        "• Decay: lower left back tooth (36)",
        "• Needs treatment: lower right back tooth (47), within 3 months",
        "• Deep decay",
        "• Soft, cold diet for 24 hours.",
        "*Care at home*",
    ] {
        assert!(text.contains(part), "missing {part}: {text}");
    }
    for word in ["diabetes", "150/95", "HbA1c", "Pain lower right"] {
        assert!(!text.contains(word), "note text {word} leaked: {text}");
    }

    // The next visit fills 36: the decay found before explains it, the material says how.
    let visit = start_visit(&app, &owner, &patient).await;
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!({ "tooth": 36, "finding": "filled", "procedure": "filling",
                "material": "composite" }),
    )
    .await;
    close(&app, &owner, &visit).await;
    let (text, _) = message_and_page(&app, &owner, &visit).await;
    for part in [
        "• Filling on the lower left back tooth (36).",
        "  Why: decay was found on this tooth.",
        "  Today: filled with a tooth-coloured filling (composite).",
    ] {
        assert!(text.contains(part), "missing {part}: {text}");
    }
}

fn preview_path(visit: &str) -> String {
    format!("/api/v1/visits/{visit}/patient-message/preview")
}

fn handed_off_path(visit: &str) -> String {
    format!("/api/v1/visits/{visit}/patient-message/handed-off")
}

const PREFS: &str = "/api/v1/me/message-prefs";
const CARE: &str = "*Care at home*";

async fn all_links(app: &TestApp, visit: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "select count(*) from aarogyam.share_links where encounter_id = $1",
    )
    .bind(visit.parse::<Uuid>().unwrap())
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

/// A closed visit with an extraction, for a patient with a mobile.
async fn extraction_visit(app: &TestApp, token: &str) -> String {
    let patient = register(
        app,
        token,
        json!({ "full_name": "Kavya Iyer", "sex": "female", "age_years": 29,
                "phone": "98765 40001" }),
    )
    .await;
    let visit = start_visit(app, token, &patient).await;
    let (status, done) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/visits/{visit}/procedures"),
        Some(json!({ "name": "Extraction", "tooth": 46 })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{done}");
    close(app, token, &visit).await;
    visit
}

async fn prefs(app: &TestApp, host: &str, token: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, PREFS, Some(token), None).await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_preview_mints_nothing_and_send_saves_the_ticks() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let visit = extraction_visit(&app, &owner).await;

    // An old client: no body and no Content-Type gives every section and saves nothing.
    let (status, first) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    assert!(first["text"].as_str().unwrap().contains(CARE));
    let live = live_links(&app, &visit).await;
    let made = all_links(&app, &visit).await;
    let (_, saved) = prefs(&app, ALPHA, &owner).await;
    assert_eq!(saved["sections"].as_array().unwrap().len(), 8, "{saved}");

    // Ten previews, toggling Care: no link minted or revoked, nothing saved.
    for i in 0..10 {
        let sections = if i % 2 == 0 {
            json!(["done", "detail", "plan"])
        } else {
            json!(["done", "detail", "plan", "care"])
        };
        let (status, preview) = post(
            &app,
            ALPHA,
            &owner,
            &preview_path(&visit),
            Some(json!({ "sections": sections })),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{preview}");
        let text = preview["text"].as_str().unwrap();
        assert_eq!(text.contains(CARE), i % 2 == 1, "{text}");
        assert!(
            text.contains(&format!("/shared/{}", "x".repeat(43))),
            "{text}"
        );
        assert!(!text.contains(first["pin"].as_str().unwrap()));
    }
    assert_eq!(
        all_links(&app, &visit).await,
        made,
        "the preview minted a link"
    );
    assert_eq!(
        live_links(&app, &visit).await,
        live,
        "the preview revoked a link"
    );
    let token = first["url"]
        .as_str()
        .unwrap()
        .rsplit("/shared/")
        .next()
        .unwrap();
    let (status, page) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/shared/{token}/visit"),
            None,
            Some(json!({ "pin": first["pin"] })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::OK,
        "the earlier link still opens: {page}"
    );
    let (_, saved) = prefs(&app, ALPHA, &owner).await;
    assert_eq!(saved["sections"].as_array().unwrap().len(), 8, "{saved}");

    // No body at all on the preview is every section; an unknown name is refused.
    let (status, preview) = post(&app, ALPHA, &owner, &preview_path(&visit), Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK);
    assert!(preview["text"].as_str().unwrap().contains(CARE));
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &preview_path(&visit),
        Some(json!({ "sections": ["done", "jokes"] })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Send with ticks: the unticked section is absent and the ticks become the defaults.
    let (status, sent) = post(
        &app,
        ALPHA,
        &owner,
        &message_path(&visit),
        Some(json!({ "sections": ["plan", "done"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    assert!(!sent["text"].as_str().unwrap().contains(CARE));
    let (_, saved) = prefs(&app, ALPHA, &owner).await;
    assert_eq!(saved["sections"], json!(["done", "plan"]));

    // Old clients again (and an empty JSON body): every section, defaults untouched.
    let (status, old) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::OK, "{old}");
    assert!(old["text"].as_str().unwrap().contains(CARE));
    let (status, empty) = app
        .send_with(
            Method::POST,
            ALPHA,
            &message_path(&visit),
            Some(&owner),
            None,
            &[("content-type", "application/json")],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{empty}");
    assert!(empty["text"].as_str().unwrap().contains(CARE));
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &message_path(&visit),
        Some(json!({ "sections": ["jokes"] })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, saved) = prefs(&app, ALPHA, &owner).await;
    assert_eq!(saved["sections"], json!(["done", "plan"]));

    // Permissions and the cross-clinic 404.
    let desk = app.token(ALPHA_FRONT_DESK);
    let ticks = json!({ "sections": ["done"] });
    for path in [preview_path(&visit), handed_off_path(&visit)] {
        let (status, _) = post(&app, ALPHA, &desk, &path, Some(ticks.clone())).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
        let beta = app.token(BETA_OWNER);
        let (status, _) = post(&app, BETA, &beta, &path, Some(ticks.clone())).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let open = start_visit(&app, &owner, &extraction_patient(&app, &owner).await).await;
    let (status, refused) = post(&app, ALPHA, &owner, &preview_path(&open), Some(ticks)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(refused["error"]["code"], "visit_open");
}

async fn extraction_patient(app: &TestApp, token: &str) -> String {
    register(
        app,
        token,
        json!({ "full_name": "Rohan Das", "sex": "male", "age_years": 52,
                "phone": "98765 40002" }),
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn prefs_are_the_callers_own_and_hand_offs_count_clinic_days() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let visit = extraction_visit(&app, &owner).await;

    let (status, saved) = app
        .send(
            Method::PUT,
            ALPHA,
            PREFS,
            Some(&owner),
            Some(json!({ "sections": ["care", "done"] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["sections"], json!(["done", "care"]));
    assert_eq!(saved["handoffs"], 0);
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            PREFS,
            Some(&owner),
            Some(json!({ "sections": ["nope"] })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    // Another member, and another clinic, see their own defaults only.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, theirs) = prefs(&app, ALPHA, &assistant).await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["sections"].as_array().unwrap().len(), 8);
    let beta = app.token(BETA_OWNER);
    let (status, theirs) = prefs(&app, BETA, &beta).await;
    assert_eq!(status, StatusCode::OK, "{theirs}");
    assert_eq!(theirs["sections"].as_array().unwrap().len(), 8);
    let (status, _) = prefs(&app, ALPHA, &beta).await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "clinic A's prefs on clinic A's host"
    );
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            PREFS,
            Some(&beta),
            Some(json!({ "sections": [] })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = prefs(&app, ALPHA, &desk).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            PREFS,
            Some(&desk),
            Some(json!({ "sections": [] })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Two hand-offs today are one day; one on a new clinic day adds a day.
    let version = json!({ "template_version": "visit-message@1" });
    for _ in 0..2 {
        let (status, body) = post(
            &app,
            ALPHA,
            &owner,
            &handed_off_path(&visit),
            Some(version.clone()),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    }
    let (_, counted) = prefs(&app, ALPHA, &owner).await;
    assert_eq!(counted["handoffs"], 2, "{counted}");
    assert_eq!(counted["handoff_days"], 1, "{counted}");
    assert_eq!(
        counted["sections"],
        json!(["done", "care"]),
        "counting keeps the ticks"
    );
    let today = counted["last_handoff_on"].as_str().unwrap().to_owned();
    sqlx::query(
        "update aarogyam.member_message_prefs set last_handoff_on = last_handoff_on - 1
         where template_version = 'visit-message@1'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &handed_off_path(&visit),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, counted) = prefs(&app, ALPHA, &owner).await;
    assert_eq!(counted["handoffs"], 3, "{counted}");
    assert_eq!(counted["handoff_days"], 2, "{counted}");
    assert_eq!(counted["last_handoff_on"], today);

    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &handed_off_path(&visit),
        Some(json!({ "template_version": "v".repeat(41) })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &handed_off_path(&Uuid::now_v7().to_string()),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_learn_link_comes_first_with_an_opaque_address_in_send_and_the_preview() {
    let app = TestApp::start_custom(sakalya_http::HttpConfig::default(), |state| {
        state.with_learn_origin(Some("https://learn.aarogyam.example".to_owned()))
    })
    .await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(
        &app,
        &owner,
        json!({ "full_name": "Ravi Kumar", "sex": "male", "age_years": 41,
                "phone": "98765 43211" }),
    )
    .await;
    let visit = start_visit(&app, &owner, &patient).await;
    chart(
        &app,
        &owner,
        &patient,
        &visit,
        json!({ "tooth": 21, "finding": "root_canal", "procedure": "root_canal", "sitting": 4,
                "material": "calcium_hydroxide", "in_progress": true }),
    )
    .await;
    close(&app, &owner, &visit).await;

    let learn = "https://learn.aarogyam.example/learn/r3zxqv";
    let (status, sent) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    let text = sent["text"].as_str().unwrap();
    assert!(
        text.contains(&format!("📘 How a root canal works: {learn}")),
        "{text}"
    );
    assert_eq!(text.find("https://"), text.find(learn), "{text}");
    assert_eq!(
        text.rfind("https://"),
        text.find(sent["url"].as_str().unwrap())
    );
    // The desktop text keeps it; the web text (no clinical words) never has it.
    assert!(sent["desktop_text"].as_str().unwrap().contains(learn));
    assert!(!sent["short_text"].as_str().unwrap().contains("learn."));

    let (status, preview) = post(&app, ALPHA, &owner, &preview_path(&visit), Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    let preview = preview["text"].as_str().unwrap();
    assert_eq!(preview.find("https://"), preview.find(learn), "{preview}");

    // A visit with nothing treated links everyday care.
    let visit = closed_visit(&app, &owner, &patient).await;
    let (status, sent) = post(&app, ALPHA, &owner, &message_path(&visit), None).await;
    assert_eq!(status, StatusCode::OK, "{sent}");
    let text = sent["text"].as_str().unwrap();
    assert!(
        text.contains(
            "📘 Caring for your teeth at home: https://learn.aarogyam.example/learn/nzpzs8"
        ),
        "{text}"
    );
}
