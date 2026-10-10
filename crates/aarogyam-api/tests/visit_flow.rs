//! Finishing a visit, closing it with a follow-up and a fee, patient links with an expiry and a
//! channel, the visit summary link, medicine sets, root canal entries and `client_id` replays,
//! on a real database. Each endpoint also gets its cross-clinic 404.
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

async fn register(app: &TestApp, token: &str) -> String {
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(token),
            Some(json!({ "full_name": "Meera Shah", "sex": "female", "age_years": 34 })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    patient["id"].as_str().unwrap().to_owned()
}

async fn start_visit(app: &TestApp, token: &str, patient: &str) -> String {
    let (status, visit) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/visits"),
            Some(token),
            Some(json!({ "chief_complaint": "Pain lower left" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    visit["id"].as_str().unwrap().to_owned()
}

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), body).await
}

async fn count(app: &TestApp, sql: &'static str, id: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .bind(id.parse::<Uuid>().unwrap())
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

/// A day this far ahead, as `YYYY-MM-DD`.
fn days_ahead(days: i64) -> String {
    let day = time::OffsetDateTime::now_utc().date() + time::Duration::days(days);
    format!(
        "{:04}-{:02}-{:02}",
        day.year(),
        u8::from(day.month()),
        day.day()
    )
}

async fn issued_rx(app: &TestApp, token: &str, patient: &str) -> String {
    let (status, rx) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/patients/{patient}/prescriptions"),
        Some(json!({ "items": [
            { "drug_name": "Metronidazole", "dose": "1 tablet", "frequency": "1-1-1" }
        ] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{rx}");
    let id = rx["id"].as_str().unwrap().to_owned();
    let (status, issued) = post(
        app,
        ALPHA,
        token,
        &format!("/api/v1/prescriptions/{id}/issue"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    id
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn finish_closes_the_visit_once_and_a_second_finish_is_409() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, &owner).await;
    let visit = start_visit(&app, &owner, &patient).await;
    let finish = format!("/api/v1/visits/{visit}/finish");

    // Another clinic's member can't see the visit.
    let (status, _) = post(&app, BETA, &beta, &finish, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // A role without clinical.write can't finish it.
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = post(&app, ALPHA, &desk, &finish, None).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // The body is optional.
    let (status, done) = post(&app, ALPHA, &owner, &finish, None).await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert_eq!(done["visit"]["status"], "closed");
    assert!(done["signed_note_ids"].is_array() && done["unsigned_note_ids"].is_array());
    assert!(done["follow_up"].is_null() && done["invoice"].is_null());

    let (status, again) = post(&app, ALPHA, &owner, &finish, None).await;
    assert_eq!(status, StatusCode::CONFLICT, "{again}");
    assert_eq!(again["error"]["code"], "visit_closed");

    // Bad values are 400, and a prescription of nobody's is a 404.
    let other = start_visit(&app, &owner, &patient).await;
    let finish = format!("/api/v1/visits/{other}/finish");
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &finish,
        Some(json!({ "follow_up_on": "not a date" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &finish,
        Some(json!({ "prescription": { "id": Uuid::nil() } })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Nothing above closed the visit: the bad finishes rolled back.
    let (status, _) = post(&app, ALPHA, &owner, &finish, Some(json!({}))).await;
    assert_eq!(status, StatusCode::OK);

    // Issuing and sharing the prescription while finishing.
    let third = start_visit(&app, &owner, &patient).await;
    let rx = {
        let (status, rx) = post(
            &app,
            ALPHA,
            &owner,
            &format!("/api/v1/patients/{patient}/prescriptions"),
            Some(json!({ "items": [
                { "drug_name": "Ibuprofen", "dose": "1 tablet", "frequency": "1-0-1" }
            ] })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{rx}");
        rx["id"].as_str().unwrap().to_owned()
    };
    let (status, done) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{third}/finish"),
        Some(json!({ "prescription": {
            "id": rx, "notify_patient": false,
            "share": { "expires_in_hours": 48, "channel": "qr" }
        } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{done}");
    assert!(
        done["prescription"]["number"]
            .as_str()
            .unwrap()
            .starts_with("RX-")
    );
    assert_eq!(done["share"]["channel"], "qr");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn close_with_a_follow_up_and_a_fee_makes_a_recall_and_a_draft_bill() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    let visit = start_visit(&app, &owner, &patient).await;
    let close = format!("/api/v1/visits/{visit}/close");
    let due = days_ahead(14);

    // Bad values change nothing.
    for body in [
        json!({ "follow_up_on": days_ahead(-1) }),
        json!({ "follow_up_on": "14/03/2030" }),
        json!({ "fee_paise": 0 }),
        json!({ "fee_paise": -5 }),
        json!({ "follow_up_on": due, "note": "x".repeat(301) }),
    ] {
        let (status, error) = post(&app, ALPHA, &owner, &close, Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body} {error}");
    }
    // Closing needs no more than clinical.write, but a fee needs billing.write.
    let beta = app.token(BETA_OWNER);
    let (status, _) = post(
        &app,
        BETA,
        &beta,
        &close,
        Some(json!({ "fee_paise": 50000 })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, closed) = post(
        &app,
        ALPHA,
        &owner,
        &close,
        Some(json!({ "follow_up_on": due, "fee_paise": 50000, "note": "Check the filling" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert_eq!(
        closed["status"], "closed",
        "the visit fields stay at the top"
    );
    assert_eq!(closed["follow_up"]["due_on"], due);
    assert_eq!(closed["follow_up"]["kind"], "follow_up");
    assert_eq!(closed["follow_up"]["reason"], "Check the filling");
    assert_eq!(closed["invoice"]["status"], "draft");
    assert_eq!(closed["invoice"]["encounter_id"], visit.as_str());
    assert_eq!(closed["invoice"]["subtotal_paise"], 50000);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.invoices where encounter_id = $1",
            &visit
        )
        .await,
        1
    );
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.recalls where patient_id = $1",
            &patient
        )
        .await,
        1
    );

    // Closed already: 409, and no second recall or bill.
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &close,
        Some(json!({ "follow_up_on": due, "fee_paise": 50000 })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.invoices where encounter_id = $1",
            &visit
        )
        .await,
        1
    );

    // Closing without a body still works, as it always did.
    let second = start_visit(&app, &owner, &patient).await;
    let (status, closed) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{second}/close"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{closed}");
    assert!(closed["follow_up"].is_null() && closed["invoice"].is_null());
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patient_links_take_an_expiry_and_a_channel() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, &owner).await;
    let rx = issued_rx(&app, &owner, &patient).await;
    let share = format!("/api/v1/prescriptions/{rx}/share");

    for hours in [0, 23, 721, -1] {
        let (status, error) = post(
            &app,
            ALPHA,
            &owner,
            &share,
            Some(json!({ "expires_in_hours": hours })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{hours} {error}");
    }
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &share,
        Some(json!({ "channel": "carrier-pigeon" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(&app, BETA, &beta, &share, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // No body: seven days, by link.
    let (status, link) = post(&app, ALPHA, &owner, &share, None).await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    assert_eq!(link["channel"], "link");
    assert!(link["message"].is_null(), "a link sends nothing");
    let seven_days = time::OffsetDateTime::now_utc() + time::Duration::hours(168);
    let expires = time::OffsetDateTime::parse(
        link["expires_at"].as_str().unwrap(),
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    assert!((expires - seven_days).abs() < time::Duration::minutes(5));

    for (hours, channel) in [(24, "qr"), (720, "link"), (48, "whatsapp"), (72, "sms")] {
        let (status, link) = post(
            &app,
            ALPHA,
            &owner,
            &share,
            Some(json!({ "expires_in_hours": hours, "channel": channel })),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{hours} {channel} {link}");
        assert_eq!(link["channel"], channel);
        let expires = time::OffsetDateTime::parse(
            link["expires_at"].as_str().unwrap(),
            &time::format_description::well_known::Rfc3339,
        )
        .unwrap();
        let wanted = time::OffsetDateTime::now_utc() + time::Duration::hours(hours);
        assert!((expires - wanted).abs() < time::Duration::minutes(5));
        assert_eq!(
            link["message"].is_null(),
            matches!(channel, "qr" | "link"),
            "only whatsapp and sms queue a message: {link}"
        );
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_visit_summary_link_opens_with_the_pin_and_only_for_visits() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, &owner).await;
    let visit = start_visit(&app, &owner, &patient).await;
    let share = format!("/api/v1/visits/{visit}/share");

    let (status, _) = post(&app, BETA, &beta, &share, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &share,
        Some(json!({ "expires_in_hours": 5 })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &share,
        Some(json!({ "channel": "pager" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let (status, link) = post(
        &app,
        ALPHA,
        &owner,
        &share,
        Some(json!({ "expires_in_hours": 24, "channel": "qr" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{link}");
    let token = link["token"].as_str().unwrap();
    let pin = link["pin"].as_str().unwrap();
    assert_eq!(link["channel"], "qr");
    let open = format!("/api/v1/shared/{token}/visit");

    let (status, preview) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/shared/{token}"),
            None,
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{preview}");
    assert_eq!(preview["resource"], "visit");

    let wrong = if pin == "000000" { "111111" } else { "000000" };
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &open,
            None,
            Some(json!({ "pin": wrong })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, summary) = app
        .send(
            Method::POST,
            ALPHA,
            &open,
            None,
            Some(json!({ "pin": pin })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(summary["clinic_name"], "Alpha Dental");
    assert!(summary["treatments"].is_array());
    // The patient's name is shown only to the patient holding the PIN, never to another clinic.
    let (status, _) = app
        .send(Method::POST, BETA, &open, None, Some(json!({ "pin": pin })))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // A prescription link isn't a visit link.
    let rx = issued_rx(&app, &owner, &patient).await;
    let (_, rx_link) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/prescriptions/{rx}/share"),
        None,
    )
    .await;
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!(
                "/api/v1/shared/{}/visit",
                rx_link["token"].as_str().unwrap()
            ),
            None,
            Some(json!({ "pin": rx_link["pin"] })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn medicine_sets_are_created_edited_listed_and_deleted_per_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let set = json!({ "label": "Post extraction", "items": [
        { "drug_name": "Amoxicillin", "strength": "500 mg", "form": "capsule",
          "dose": "1 capsule", "frequency": "1-1-1", "timing": "after_food", "duration_days": 5 },
        { "drug_name": "Paracetamol", "strength": "650 mg", "form": "tablet",
          "dose": "1 tablet", "frequency": "SOS" }
    ] });
    let (status, made) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/medicine-sets",
        Some(set.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    assert_eq!(made["label"], "Post extraction");
    assert_eq!(made["items"].as_array().unwrap().len(), 2);
    let id = made["id"].as_str().unwrap().to_owned();

    // A label is unique in a clinic; the other clinic may reuse it.
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        "/api/v1/medicine-sets",
        Some(set.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = post(
        &app,
        BETA,
        &beta,
        "/api/v1/medicine-sets",
        Some(set.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);

    for bad in [
        json!({ "label": "", "items": set["items"] }),
        json!({ "label": "Empty", "items": [] }),
        json!({ "label": "No drug", "items": [{ "drug_name": "", "strength": "1", "form": "tablet",
            "dose": "1", "frequency": "1-0-0" }] }),
    ] {
        let (status, error) = post(&app, ALPHA, &owner, "/api/v1/medicine-sets", Some(bad)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
    }
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = post(
        &app,
        ALPHA,
        &assistant,
        "/api/v1/medicine-sets",
        Some(set.clone()),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, listed) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/medicine-sets",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    assert_eq!(listed["items"].as_array().unwrap().len(), 1);

    let path = format!("/api/v1/medicine-sets/{id}");
    let edited = json!({ "label": "After extraction", "items": [set["items"][1].clone()] });
    let (status, updated) = app
        .send(
            Method::PUT,
            ALPHA,
            &path,
            Some(&owner),
            Some(edited.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["label"], "After extraction");
    assert_eq!(updated["items"].as_array().unwrap().len(), 1);

    // The other clinic can't touch it.
    let (status, _) = app
        .send(Method::PUT, BETA, &path, Some(&beta), Some(edited))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::DELETE, BETA, &path, Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, beta_list) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/medicine-sets",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(beta_list["items"].as_array().unwrap().len(), 1);
    assert_ne!(beta_list["items"][0]["id"], id.as_str());

    let (status, _) = app
        .send(Method::DELETE, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = app
        .send(Method::DELETE, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, listed) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/medicine-sets",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(listed["items"], json!([]));
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn root_canal_entries_carry_canals_and_a_sitting() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    let path = format!("/api/v1/patients/{patient}/dental-chart");

    let (status, chart) = post(
        &app,
        ALPHA,
        &owner,
        &path,
        Some(json!({ "entries": [{
            "tooth": 36, "finding": "root_canal", "sitting": 2,
            "canals": [{ "name": "MB", "working_length_mm": 19.5 }, { "name": "DB" },
                       { "name": "D", "working_length_mm": 20 }]
        }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    let entry = &chart["current"][0];
    assert_eq!(entry["sitting"], 2);
    assert_eq!(entry["canals"].as_array().unwrap().len(), 3);
    assert_eq!(entry["canals"][0]["working_length_mm"], 19.5);
    assert!(entry["canals"][1]["working_length_mm"].is_null());

    // Entries without canals still read as before.
    let (status, chart) = post(
        &app,
        ALPHA,
        &owner,
        &path,
        Some(json!({ "entries": [{ "tooth": 11, "finding": "caries", "surface": "M" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{chart}");
    let plain = chart["current"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["tooth"] == 11)
        .unwrap();
    assert_eq!(plain["canals"], json!([]));
    assert!(plain["sitting"].is_null());

    let nine: Vec<Value> = (1..=9)
        .map(|n| json!({ "name": format!("C{n}") }))
        .collect();
    for entry in [
        json!({ "tooth": 26, "finding": "root_canal", "sitting": 0 }),
        json!({ "tooth": 26, "finding": "root_canal", "sitting": 21 }),
        json!({ "tooth": 26, "finding": "root_canal", "canals": nine }),
        json!({ "tooth": 26, "finding": "root_canal",
                "canals": [{ "name": "MB" }, { "name": "mb" }] }),
        json!({ "tooth": 26, "finding": "root_canal",
                "canals": [{ "name": "MB", "working_length_mm": -3 }] }),
        json!({ "tooth": 26, "finding": "caries", "canals": [{ "name": "MB" }] }),
        json!({ "tooth": 26, "finding": "caries", "sitting": 1 }),
    ] {
        let (status, error) = post(
            &app,
            ALPHA,
            &owner,
            &path,
            Some(json!({ "entries": [entry.clone()] })),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{entry} {error}");
    }

    // Another clinic's member can't reach the chart.
    let beta = app.token(BETA_OWNER);
    let (status, _) = post(
        &app,
        BETA,
        &beta,
        &path,
        Some(json!({ "entries": [{ "tooth": 36, "finding": "root_canal" }] })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_client_id_replay_returns_the_original_and_makes_no_duplicate() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = register(&app, &owner).await;
    let visit = start_visit(&app, &owner, &patient).await;

    // Dental chart.
    let chart_path = format!("/api/v1/patients/{patient}/dental-chart");
    let chart_id = Uuid::now_v7().to_string();
    let chart_body = json!({ "client_id": chart_id, "visit_id": visit,
        "entries": [{ "tooth": 46, "surface": "O", "finding": "caries" }] });
    let (status, first) = post(&app, ALPHA, &owner, &chart_path, Some(chart_body.clone())).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (status, again) = post(&app, ALPHA, &owner, &chart_path, Some(chart_body.clone())).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(first["current"][0]["id"], again["current"][0]["id"]);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.specialty_records where client_id = $1",
            &chart_id
        )
        .await,
        1
    );
    let other = json!({ "client_id": chart_id,
        "entries": [{ "tooth": 47, "finding": "missing" }] });
    let (status, conflict) = post(&app, ALPHA, &owner, &chart_path, Some(other)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(conflict["error"]["code"], "id_conflict");

    // Procedure: the replay returns the same one, even after the visit closed.
    let proc_path = format!("/api/v1/visits/{visit}/procedures");
    let proc_id = Uuid::now_v7().to_string();
    let proc_body =
        json!({ "client_id": proc_id, "name": "Scaling", "tooth": 11, "price_paise": 80000 });
    let (status, first) = post(&app, ALPHA, &owner, &proc_path, Some(proc_body.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let (status, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/close"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, again) = post(&app, ALPHA, &owner, &proc_path, Some(proc_body)).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(first["id"], again["id"]);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.procedures where client_id = $1",
            &proc_id
        )
        .await,
        1
    );
    let reused = json!({ "client_id": proc_id, "name": "Extraction", "tooth": 18 });
    let (status, conflict) = post(&app, ALPHA, &owner, &proc_path, Some(reused)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(conflict["error"]["code"], "id_conflict");

    // Prescription draft.
    let rx_path = format!("/api/v1/patients/{patient}/prescriptions");
    let rx_id = Uuid::now_v7().to_string();
    let rx_body = json!({ "client_id": rx_id, "items": [
        { "drug_name": "Ibuprofen", "dose": "1 tablet", "frequency": "1-0-1" }] });
    let (status, first) = post(&app, ALPHA, &owner, &rx_path, Some(rx_body.clone())).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    let (status, again) = post(&app, ALPHA, &owner, &rx_path, Some(rx_body)).await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(first["id"], again["id"]);
    assert_eq!(
        count(
            &app,
            "select count(*) from aarogyam.prescriptions where client_id = $1",
            &rx_id
        )
        .await,
        1
    );
    let reused = json!({ "client_id": rx_id, "items": [
        { "drug_name": "Paracetamol", "dose": "1 tablet", "frequency": "SOS" }] });
    let (status, conflict) = post(&app, ALPHA, &owner, &rx_path, Some(reused.clone())).await;
    assert_eq!(status, StatusCode::CONFLICT, "{conflict}");
    assert_eq!(conflict["error"]["code"], "id_conflict");

    // A client_id is the clinic's: another clinic can't replay it, and finds no patient.
    let (status, _) = post(&app, BETA, &beta, &rx_path, Some(reused)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_gujarati_recording_is_accepted_and_other_languages_still_are() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = register(&app, &owner).await;
    let visit = start_visit(&app, &owner, &patient).await;
    let (status, note) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/visits/{visit}/notes"),
        Some(json!({ "sections": { "subjective": "Pain on chewing" } })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    let note_id = note["id"].as_str().unwrap().to_owned();
    let mut webm = vec![0x1A, 0x45, 0xDF, 0xA3];
    webm.extend_from_slice(&[9_u8; 1024]);
    for (language, wanted) in [
        ("gu-IN", StatusCode::CREATED),
        ("mr-IN", StatusCode::CREATED),
        ("fr-FR", StatusCode::BAD_REQUEST),
    ] {
        let (status, body) = app
            .upload(
                ALPHA,
                &owner,
                &patient,
                &webm,
                &[
                    ("note_id", note_id.as_str()),
                    ("duration_seconds", "5"),
                    ("language", language),
                ],
            )
            .await;
        assert_eq!(status, wanted, "{language} {body}");
        if wanted == StatusCode::CREATED {
            assert_eq!(body["language"], language);
        }
    }
}
