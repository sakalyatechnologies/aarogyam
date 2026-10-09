//! Database round trips per request on the hot paths. Across regions each trip costs about
//! 300 ms, so these numbers are the API's latency budget. Prints a table with `--nocapture`;
//! `ROUND_TRIPS_TRACE=1` also prints each trip's SQL.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use std::fmt::Write as _;

use axum::Router;
use axum::http::{Method, StatusCode};
use sakalya_testkit::{PgRoundTrips, TripCounts};
use serde_json::{Value, json};
use support::people::ALPHA_OWNER;
use support::{ALPHA, TestApp, send_with_headers};
use time::{Date, Duration, OffsetDateTime, UtcOffset};

/// Most statement round trips a clinic hot path may take once the host and the member's
/// permissions are cached: start the scoped transaction, one query, commit.
const WARM_BUDGET: usize = 3;
/// With nothing cached: the host and the member's permissions in one more trip.
const COLD_BUDGET: usize = 4;

/// One request to measure.
struct Route {
    name: &'static str,
    method: Method,
    host: &'static str,
    uri: String,
    signed_in: bool,
    body: Option<Value>,
    /// Trips allowed over the budget, each with its reason in the route list.
    extra: usize,
    /// The `If-Match` header to send, for conditional edits.
    if_match: Option<String>,
}

impl Route {
    fn get(name: &'static str, host: &'static str, uri: String) -> Self {
        Self {
            name,
            method: Method::GET,
            host,
            uri,
            signed_in: true,
            body: None,
            extra: 0,
            if_match: None,
        }
    }

    /// Allows `trips` more than the budget.
    const fn allow_extra(mut self, trips: usize) -> Self {
        self.extra = trips;
        self
    }
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> String {
    let (status, value) = app
        .send(Method::POST, ALPHA, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value["id"]
        .as_str()
        .or_else(|| value["appointment"]["id"].as_str())
        .unwrap_or_default()
        .to_owned()
}

/// A doctor working every day, a chair, and three patients booked tomorrow. Returns the
/// doctor, the last patient and their appointment.
async fn clinic_day(app: &TestApp, owner: &str, tomorrow: Date) -> (String, String, String) {
    let doctor = created(
        app,
        owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha" }),
    )
    .await;
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "09:00", "ends": "17:00" }))
        .collect();
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{doctor}/working-hours"),
            Some(owner),
            Some(json!({ "shifts": shifts })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let chair = created(app, owner, "/api/v1/rooms", json!({ "name": "Chair 1" })).await;
    let mut patient = String::new();
    let mut appointment = String::new();
    for (index, name) in ["Ravi Kumar", "Meera Iyer", "Sunil Rao"].iter().enumerate() {
        patient = created(
            app,
            owner,
            "/api/v1/patients",
            json!({ "full_name": name, "age_years": 40, "phone": format!("+9198765432{index}0") }),
        )
        .await;
        appointment = created(
            app,
            owner,
            "/api/v1/appointments",
            json!({
                "patient_id": patient, "practitioner_id": doctor, "room_id": chair,
                "starts_at": format!("{tomorrow}T1{index}:00:00+05:30"),
                "ends_at": format!("{tomorrow}T1{index}:30:00+05:30")
            }),
        )
        .await;
    }
    (doctor, patient, appointment)
}

/// Moves a phone may repeat after a lost answer: each is idempotent, so the measured repeats
/// succeed.
async fn repeatable_moves(
    app: &TestApp,
    owner: &str,
    patient: &str,
    appointment: &str,
) -> [Route; 3] {
    let token = created(
        app,
        owner,
        "/api/v1/queue",
        json!({ "patient_id": patient }),
    )
    .await;
    let visit = created(
        app,
        owner,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Pain" }),
    )
    .await;
    let note = created(
        app,
        owner,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": { "subjective": "Pain on chewing" } }),
    )
    .await;
    let post = |name: &'static str, uri: String, body: Value| Route {
        method: Method::POST,
        body: Some(body),
        ..Route::get(name, ALPHA, uri)
    };

    [
        post(
            "POST /appointments/{id}/status",
            format!("/api/v1/appointments/{appointment}/status"),
            json!({ "status": "confirmed" }),
        ),
        post(
            "POST /queue/{id}/status",
            format!("/api/v1/queue/{token}/status"),
            json!({ "status": "in_chair" }),
        ),
        post(
            "POST /notes/{id}/sign",
            format!("/api/v1/notes/{note}/sign"),
            json!({}),
        ),
    ]
}

/// The walk-in fast path: the phone lookup, a one-step walk-in (a new patient each time), and
/// the doctor's taps, which repeat safely.
async fn walk_in_routes(app: &TestApp, owner: &str) -> [Route; 4] {
    let (status, walk_in) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/walk-ins",
            Some(owner),
            Some(
                json!({ "patient": { "full_name": "Asha Pawar", "phone": "9876500001" },
                         "allergies": ["Penicillin"] }),
            ),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{walk_in}");
    let patient = walk_in["patient"]["id"].as_str().unwrap();
    let token = walk_in["token"]["id"].as_str().unwrap();
    let (_, allergies) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}/allergies"),
            Some(owner),
            None,
        )
        .await;
    let allergy = allergies["items"][0]["id"].as_str().unwrap();
    let post = |name: &'static str, uri: String, body: Value, extra: usize| Route {
        method: Method::POST,
        body: Some(body),
        ..Route::get(name, ALPHA, uri).allow_extra(extra)
    };
    [
        post(
            "POST /patients/lookup",
            "/api/v1/patients/lookup".into(),
            json!({ "phone": "9876500001" }),
            0,
        ),
        // The patient's number and row, the allergies, the consents, the branch, the token's
        // number, the token and its row: one statement each, seven over (eight with a doctor).
        post(
            "POST /walk-ins",
            "/api/v1/walk-ins".into(),
            json!({ "patient": { "full_name": "Ravi Pawar", "age_years": 30, "phone": "9876500002" },
                    "allergies": ["Latex"],
                    "consents": [{ "purpose": "care", "method": "verbal" }] }),
            7,
        ),
        // The token's lock, the visit it has, the doctor's name and the token's row: three over.
        post(
            "POST /queue/{id}/start-visit",
            format!("/api/v1/queue/{token}/start-visit"),
            json!({}),
            3,
        ),
        // The allergy's lock, then the answer from it: no write on a repeat.
        post(
            "POST /allergies/{id}/confirm",
            format!("/api/v1/patients/{patient}/allergies/{allergy}/confirm"),
            json!({}),
            0,
        ),
    ]
}

/// Edits sent with the `If-Match` version just read. Each repeats the record's own content, so
/// the version stays put and the measured repeats succeed. Read-modify-write edits (read the
/// record, check it, write it) take more trips than a read, each allowance below.
async fn conditional_edits(
    app: &TestApp,
    owner: &str,
    patient: &str,
    appointment: &str,
    starts_at: &str,
) -> [Route; 4] {
    let visit = created(
        app,
        owner,
        &format!("/api/v1/patients/{patient}/visits"),
        json!({ "chief_complaint": "Swelling" }),
    )
    .await;
    let (status, headers, note) = app
        .send_full(
            Method::POST,
            ALPHA,
            &format!("/api/v1/visits/{visit}/notes"),
            Some(owner),
            Some(json!({ "sections": { "subjective": "Swelling, 46" } })),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{note}");
    let note_id = note["id"].as_str().unwrap().to_owned();
    let note_etag = headers["etag"].to_str().unwrap().to_owned();
    let version = async |uri: &str| -> String {
        let (status, headers, body) = app
            .send_full(Method::GET, ALPHA, uri, Some(owner), None, &[])
            .await;
        assert_eq!(status, StatusCode::OK, "GET {uri}: {body}");
        headers["etag"].to_str().unwrap().to_owned()
    };
    let patient_uri = format!("/api/v1/patients/{patient}");
    let patient_etag = version(&patient_uri).await;
    let summary_uri = format!("/api/v1/patients/{patient}/summary-note");
    let (status, summary_headers, saved) = app
        .send_full(
            Method::PUT,
            ALPHA,
            &summary_uri,
            Some(owner),
            Some(json!({ "body": "## History\n- **Diabetic**" })),
            &[],
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let summary_etag = summary_headers["etag"].to_str().unwrap().to_owned();
    let patch = |name: &'static str, uri: String, body: Value, etag: String, extra: usize| Route {
        method: Method::PATCH,
        body: Some(body),
        if_match: Some(etag),
        ..Route::get(name, ALPHA, uri).allow_extra(extra)
    };
    [
        // Read-modify-write: the patient (reach), the note's lock, the write: two over.
        Route {
            method: Method::PUT,
            body: Some(json!({ "body": "## History\n- **Diabetic**" })),
            if_match: Some(summary_etag),
            ..Route::get("PUT /patients/{id}/summary-note", ALPHA, summary_uri).allow_extra(2)
        },
        patch(
            "PATCH /patients/{id}",
            patient_uri,
            json!({ "full_name": "Sunil Rao" }),
            patient_etag,
            1,
        ),
        patch(
            "PATCH /notes/{id}",
            format!("/api/v1/notes/{note_id}"),
            json!({ "sections": { "subjective": "Swelling, 46" } }),
            note_etag,
            3,
        ),
        patch(
            "PATCH /appointments/{id}",
            format!("/api/v1/appointments/{appointment}"),
            json!({ "starts_at": starts_at }),
            "\"1\"".to_owned(),
            5,
        ),
    ]
}

/// Round trips of one request, after the background release checks settle.
#[expect(
    clippy::print_stderr,
    reason = "tracing on request, while investigating"
)]
async fn measure(router: &Router, trips: &PgRoundTrips, route: &Route, token: &str) -> TripCounts {
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let mark = trips.mark();
    let headers: Vec<(&str, &str)> = route
        .if_match
        .as_deref()
        .map(|v| ("If-Match", v))
        .into_iter()
        .collect();
    let (status, body) = send_with_headers(
        router,
        route.method.clone(),
        route.host,
        &route.uri,
        route.signed_in.then_some(token),
        route.body.clone(),
        &headers,
    )
    .await;
    assert!(
        status.is_success(),
        "{} {}: {status} {body}",
        route.name,
        route.uri
    );
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    if std::env::var_os("ROUND_TRIPS_TRACE").is_some() {
        eprintln!("--- {}", route.name);
        for trip in trips.trips_since(mark) {
            let sql: String = trip.sql.split_whitespace().collect::<Vec<_>>().join(" ");
            eprintln!(
                "  {:?}: {}",
                trip.kind,
                sql.chars().take(150).collect::<String>()
            );
        }
    }
    trips.counts_since(mark)
}

/// The hot paths, with the days and records `clinic_day` created.
#[expect(
    clippy::too_many_lines,
    reason = "one entry per route; splitting it hides the budget list"
)]
fn hot_routes(
    monday: Date,
    sunday: Date,
    tomorrow: Date,
    doctor: &str,
    patient: &str,
) -> Vec<Route> {
    vec![
        Route::get("GET /me", "app.localtest.me", "/api/v1/me".into()),
        // Answered from configuration: no database trip at all.
        Route {
            signed_in: false,
            ..Route::get("GET /meta", "app.localtest.me", "/api/v1/meta".into())
        },
        Route::get("GET /session", ALPHA, "/api/v1/session".into()),
        Route::get("GET /today", ALPHA, "/api/v1/today".into()),
        Route::get(
            "GET /appointments (week)",
            ALPHA,
            format!("/api/v1/appointments?from={monday}&to={sunday}"),
        ),
        Route::get("GET /patients", ALPHA, "/api/v1/patients".into()),
        // Money figures in one statement, then the bills with a balance: one trip over.
        Route::get("GET /today/money", ALPHA, "/api/v1/today/money".into()).allow_extra(1),
        Route::get(
            "GET /reports/collections",
            ALPHA,
            format!("/api/v1/reports/collections?from={monday}&to={sunday}"),
        )
        .allow_extra(1),
        Route::get(
            "GET /reports/pending",
            ALPHA,
            "/api/v1/reports/pending".into(),
        ),
        // Chairs, money, patients and busy hours in one statement.
        Route::get(
            "GET /reports/analytics",
            ALPHA,
            "/api/v1/reports/analytics".into(),
        ),
        Route::get("GET /expenses", ALPHA, "/api/v1/expenses".into()),
        Route::get("GET /invoices", ALPHA, "/api/v1/invoices".into()),
        Route::get("GET /stock", ALPHA, "/api/v1/stock".into()),
        Route::get(
            "GET /stock/expiring",
            ALPHA,
            "/api/v1/stock/expiring".into(),
        ),
        Route::get("GET /recalls", ALPHA, "/api/v1/recalls".into()),
        Route::get("GET /queue", ALPHA, "/api/v1/queue".into()),
        Route::get("GET /staff", ALPHA, "/api/v1/staff".into()),
        Route::get("GET /practitioners", ALPHA, "/api/v1/practitioners".into()),
        Route::get("GET /rooms", ALPHA, "/api/v1/rooms".into()),
        Route::get("GET /clinic-hours", ALPHA, "/api/v1/clinic-hours".into()),
        Route::get(
            "GET /consent-notices",
            ALPHA,
            "/api/v1/consent-notices".into(),
        ),
        Route::get(
            "GET /patient-duplicates",
            ALPHA,
            "/api/v1/patient-duplicates".into(),
        ),
        Route::get("GET /price-items", ALPHA, "/api/v1/price-items".into()),
        Route::get("GET /letterhead", ALPHA, "/api/v1/letterhead".into()),
        // Over budget since scope enforcement (the scoped visit list, then the authors' names); to fold into one statement.
        Route::get(
            "GET /patients/{id}/visits",
            ALPHA,
            format!("/api/v1/patients/{patient}/visits"),
        )
        .allow_extra(2),
        // Over budget since scope enforcement (the scoped list, then the prescribers' names); to fold into one statement.
        // The summary note and the visit notes in one statement, then the access record: one over.
        Route::get(
            "GET /patients/{id}/notes",
            ALPHA,
            format!("/api/v1/patients/{patient}/notes"),
        )
        .allow_extra(1),
        Route::get(
            "GET /patients/{id}/prescriptions",
            ALPHA,
            format!("/api/v1/patients/{patient}/prescriptions"),
        )
        .allow_extra(1),
        // Over budget since scope enforcement (plans, items and names, each scoped); to fold into one statement.
        Route::get(
            "GET /patients/{id}/treatment-plans",
            ALPHA,
            format!("/api/v1/patients/{patient}/treatment-plans"),
        )
        .allow_extra(3),
        Route::get("GET /roles", ALPHA, "/api/v1/roles".into()),
        Route::get("GET /roles/{key}", ALPHA, "/api/v1/roles/doctor".into()),
        Route::get("GET /permissions", ALPHA, "/api/v1/permissions".into()),
        // The lock, the before and after lists, the writes and the change record: one statement.
        Route {
            method: Method::PUT,
            body: Some(json!({ "permissions": [
                { "key": "patients.read" }, { "key": "patients.write" },
                { "key": "patients.contact" }, { "key": "appointments.read" },
                { "key": "appointments.write" }, { "key": "clinical.read" },
                { "key": "clinical.write" }, { "key": "prescriptions.issue" },
                { "key": "inventory.read" }
            ] })),
            ..Route::get(
                "PUT /roles/{key}/permissions",
                ALPHA,
                "/api/v1/roles/doctor/permissions".into(),
            )
        },
        Route::get(
            "GET /settings/clinic",
            ALPHA,
            "/api/v1/settings/clinic".into(),
        ),
        Route {
            method: Method::POST,
            body: Some(json!({ "q": "Ravi" })),
            ..Route::get(
                "POST /patients/search",
                ALPHA,
                "/api/v1/patients/search".into(),
            )
        },
        Route::get(
            "GET /patients/{id}",
            ALPHA,
            format!("/api/v1/patients/{patient}"),
        ),
        // The patient in reach, then the links and the waiting code: one over.
        Route::get(
            "GET /patients/{id}/app-access",
            ALPHA,
            format!("/api/v1/patients/{patient}/app-access"),
        )
        .allow_extra(1),
        Route {
            signed_in: false,
            ..Route::get(
                "GET /public/booking",
                ALPHA,
                "/api/v1/public/booking".into(),
            )
        },
        Route {
            signed_in: false,
            ..Route::get(
                "GET /public/availability",
                ALPHA,
                format!("/api/v1/public/availability?date={tomorrow}&practitioner_id={doctor}"),
            )
        },
    ]
}

#[tokio::test]
#[ignore = "needs Postgres: DATABASE_URL=postgres://localhost:5432/postgres"]
async fn hot_paths_stay_within_their_round_trip_budget() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let today = OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date();
    let monday = today - Duration::days(i64::from(today.weekday().number_days_from_monday()));
    let sunday = monday + Duration::days(6);
    let tomorrow = today + Duration::days(1);
    let (doctor, patient, appointment) = clinic_day(&app, &owner, tomorrow).await;

    let moves = repeatable_moves(&app, &owner, &patient, &appointment).await;
    let starts_at = format!("{tomorrow}T12:00:00+05:30");
    let edits = conditional_edits(&app, &owner, &patient, &appointment, &starts_at).await;
    let routes = hot_routes(monday, sunday, tomorrow, &doctor, &patient);
    let walk_ins = walk_in_routes(&app, &owner).await;

    let mut table = String::from(
        "\nroute                     cold  warm  (cold: prepares, new connections; warm: pings, release checks)\n",
    );
    let mut over = Vec::new();
    for route in edits.iter().chain(&moves).chain(&walk_ins).chain(&routes) {
        // A state of its own warms the pool's connections and their statement caches, so
        // what is counted is the request, not connecting or preparing.
        let (db, trips) = app.counting_db().await;
        let warmer = app.router_on(db.clone());
        for _ in 0..3 {
            measure(&warmer, &trips, route, &owner).await;
        }
        // Then a new state over the warm pool: its first request has nothing cached.
        let fresh = app.router_on(db);
        let cold = measure(&fresh, &trips, route, &owner).await;
        let warm = measure(&fresh, &trips, route, &owner).await;
        writeln!(
            table,
            "{:<26}{:>4}  {:>4}  ({}, {}; {}, {})",
            route.name,
            cold.statements,
            warm.statements,
            cold.prepares,
            cold.connections,
            warm.pings,
            warm.marked
        )
        .unwrap();
        if warm.statements > WARM_BUDGET + route.extra
            || cold.statements > COLD_BUDGET + route.extra
        {
            over.push(route.name);
        }
    }
    println!("{table}");
    app.finish().await;
    assert!(over.is_empty(), "over budget: {over:?}{table}");
}

/// The patient app's reads with one linked clinic. The account and its links take one trip on
/// the app host (no cache: a revoked link must stop working at once), then each linked clinic
/// is one scoped transaction: start, one statement (with its access record), commit.
const PATIENT_BUDGET_ONE_CLINIC: usize = 1 + WARM_BUDGET;

#[tokio::test]
#[ignore = "needs Postgres: DATABASE_URL=postgres://localhost:5432/postgres"]
async fn patient_app_reads_stay_within_their_round_trip_budget() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let today = OffsetDateTime::now_utc()
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date();
    let (_, patient, _) = clinic_day(&app, &owner, today + Duration::days(1)).await;
    let (status, body) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/patients/{patient}"),
            Some(&owner),
            Some(json!({ "email": "sunil@example.test" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, invitation) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/patients/{patient}/app-invitations"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{invitation}");
    let person = uuid::Uuid::now_v7();
    let token = app
        .tokens
        .mint_with_email(person, Some("sunil@example.test"))
        .unwrap();
    let (status, linked) = app
        .send(
            Method::POST,
            "app.localtest.me",
            "/api/v1/me/patient/links",
            Some(&token),
            Some(json!({ "code": invitation["code"] })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{linked}");

    let host = "app.localtest.me";
    let routes = [
        // The account and its links only.
        Route::get("GET /me/patient", host, "/api/v1/me/patient".into()),
        Route::get(
            "GET /me/patient/home",
            host,
            "/api/v1/me/patient/home".into(),
        ),
        Route::get(
            "GET /me/patient/appointments",
            host,
            "/api/v1/me/patient/appointments".into(),
        ),
        Route::get(
            "GET /me/patient/prescriptions",
            host,
            "/api/v1/me/patient/prescriptions".into(),
        ),
        Route::get(
            "GET /me/patient/bills",
            host,
            "/api/v1/me/patient/bills".into(),
        ),
        Route::get(
            "GET /me/patient/files",
            host,
            "/api/v1/me/patient/files".into(),
        ),
    ];
    let mut table = String::from("\nroute                          trips\n");
    let mut over = Vec::new();
    for route in &routes {
        let (db, trips) = app.counting_db().await;
        let patient_router = app.router_on(db);
        for _ in 0..3 {
            measure(&patient_router, &trips, route, &token).await;
        }
        let counted = measure(&patient_router, &trips, route, &token).await;
        writeln!(table, "{:<31}{:>4}", route.name, counted.statements).unwrap();
        if counted.statements > PATIENT_BUDGET_ONE_CLINIC {
            over.push(route.name);
        }
    }
    println!("{table}");
    app.finish().await;
    assert!(over.is_empty(), "over budget: {over:?}{table}");
}
