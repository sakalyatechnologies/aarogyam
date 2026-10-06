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
use support::{ALPHA, TestApp, send};
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
        }
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

/// Round trips of one request, after the background release checks settle.
#[expect(
    clippy::print_stderr,
    reason = "tracing on request, while investigating"
)]
async fn measure(router: &Router, trips: &PgRoundTrips, route: &Route, token: &str) -> TripCounts {
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let mark = trips.mark();
    let (status, body) = send(
        router,
        route.method.clone(),
        route.host,
        &route.uri,
        route.signed_in.then_some(token),
        route.body.clone(),
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
    let routes = [
        Route::get("GET /me", "app.localtest.me", "/api/v1/me".into()),
        Route::get("GET /session", ALPHA, "/api/v1/session".into()),
        Route::get("GET /today", ALPHA, "/api/v1/today".into()),
        Route::get(
            "GET /appointments (week)",
            ALPHA,
            format!("/api/v1/appointments?from={monday}&to={sunday}"),
        ),
        Route::get("GET /patients", ALPHA, "/api/v1/patients".into()),
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
    ];

    let mut table = String::from(
        "\nroute                     cold  warm  (cold: prepares, new connections; warm: pings, release checks)\n",
    );
    let mut over = Vec::new();
    for route in moves.iter().chain(&routes) {
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
        if warm.statements > WARM_BUDGET || cold.statements > COLD_BUDGET {
            over.push(route.name);
        }
    }
    println!("{table}");
    app.finish().await;
    assert!(over.is_empty(), "over budget: {over:?}{table}");
}
