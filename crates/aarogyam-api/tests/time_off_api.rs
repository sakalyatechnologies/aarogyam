//! The time-off routes on a real database: who may call what, a clinic's own requests only,
//! pending versus approved at once, the leave block that stops bookings (create, reschedule and
//! confirming a request) and its removal on cancel, the privacy of kind and reason, and the
//! appointments a leave affects.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one journey end to end, step by step"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn post(
    app: &TestApp,
    host: &str,
    token: &str,
    path: &str,
    body: Value,
) -> (StatusCode, Value) {
    app.send(Method::POST, host, path, Some(token), Some(body))
        .await
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, path, Some(token), None).await
}

async fn created(app: &TestApp, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = post(app, ALPHA, token, path, body).await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

async fn member(app: &TestApp, auth_uid: Uuid) -> String {
    let clinic = app.clinic_id("alpha").await;
    let id: Uuid = sqlx::query_scalar(
        "select m.id from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
         where m.org_id = $1 and u.auth_uid = $2",
    )
    .bind(clinic)
    .bind(auth_uid)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    id.to_string()
}

async fn patient(app: &TestApp, token: &str, name: &str) -> String {
    id_of(
        &created(
            app,
            token,
            "/api/v1/patients",
            json!({ "full_name": name, "sex": "female", "age_years": 30 }),
        )
        .await,
    )
}

async fn doctor(app: &TestApp, owner: &str, name: &str, membership: Option<&str>) -> String {
    let mut body = json!({ "display_name": name, "calendar_color": "#0f766e" });
    if let Some(membership) = membership {
        body["membership_id"] = json!(membership);
    }
    id_of(&created(app, owner, "/api/v1/practitioners", body).await)
}

async fn chair(app: &TestApp, owner: &str, name: &str) -> String {
    id_of(&created(app, owner, "/api/v1/rooms", json!({ "name": name })).await)
}

fn booking(patient: &str, doctor: &str, room: &str, starts: &str, ends: &str) -> Value {
    json!({
        "patient_id": patient, "practitioner_id": doctor, "room_id": room,
        "starts_at": starts, "ends_at": ends, "reason": "Check-up"
    })
}

/// Monday 7 January 2030, the whole day.
fn monday() -> Value {
    json!({ "kind": "sick", "first_day": "2030-01-07", "last_day": "2030-01-07", "reason": "migraine" })
}

async fn leave_reasons(app: &TestApp) -> Vec<String> {
    sqlx::query_scalar("select reason from aarogyam.leave_blocks")
        .fetch_all(&app.owner)
        .await
        .unwrap()
}

async fn notices(app: &TestApp, request: &str) -> Vec<String> {
    sqlx::query_scalar(
        "select kind from aarogyam.staff_notifications where time_off_request_id = $1 order by kind",
    )
    .bind(Uuid::parse_str(request).unwrap())
    .fetch_all(&app.owner)
    .await
    .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn each_route_needs_its_permission_and_stays_in_its_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let nothing = app.token(ALPHA_NOTHING);
    let beta = app.token(BETA_OWNER);
    let assistant_member = member(&app, ALPHA_ASSISTANT).await;

    let (code, _) = get(
        &app,
        ALPHA,
        &nothing,
        "/api/v1/time-off?from=2030-01-01&to=2030-01-31",
    )
    .await;
    assert_eq!(code, StatusCode::FORBIDDEN);
    let (code, _) = post(&app, ALPHA, &nothing, "/api/v1/time-off", monday()).await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    // Anyone may ask for their own; recording for someone else needs time_off.manage.
    let own = created(&app, &assistant, "/api/v1/time-off", monday()).await;
    let id = id_of(&own);
    let owner_member = member(&app, ALPHA_OWNER).await;
    let mut for_owner = monday();
    for_owner["membership_id"] = json!(owner_member);
    let (code, _) = post(&app, ALPHA, &assistant, "/api/v1/time-off", for_owner).await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    // Deciding and the affected list are for time_off.manage.
    for path in ["approve", "decline"] {
        let (code, _) = post(
            &app,
            ALPHA,
            &assistant,
            &format!("/api/v1/time-off/{id}/{path}"),
            json!({}),
        )
        .await;
        assert_eq!(code, StatusCode::FORBIDDEN, "{path}");
    }
    let (code, _) = get(
        &app,
        ALPHA,
        &assistant,
        &format!("/api/v1/time-off/{id}/affected-appointments"),
    )
    .await;
    assert_eq!(code, StatusCode::FORBIDDEN);

    // Another clinic's owner finds nothing, whatever the route.
    for path in ["approve", "decline", "cancel"] {
        let (code, _) = post(
            &app,
            BETA,
            &beta,
            &format!("/api/v1/time-off/{id}/{path}"),
            json!({}),
        )
        .await;
        assert_eq!(code, StatusCode::NOT_FOUND, "{path}");
    }
    let (code, _) = get(
        &app,
        BETA,
        &beta,
        &format!("/api/v1/time-off/{id}/affected-appointments"),
    )
    .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (code, list) = get(
        &app,
        BETA,
        &beta,
        "/api/v1/time-off?from=2030-01-01&to=2030-01-31",
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    assert_eq!(list["items"], json!([]));
    let mut other_clinic = monday();
    other_clinic["membership_id"] = json!(assistant_member);
    let (code, _) = post(&app, BETA, &beta, "/api/v1/time-off", other_clinic).await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    // Unknown id in your own clinic.
    let missing = Uuid::now_v7();
    let (code, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{missing}/approve"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::NOT_FOUND);

    // Nothing was decided by the refusals.
    let (_, after) = get(
        &app,
        ALPHA,
        &owner,
        "/api/v1/time-off?from=2030-01-01&to=2030-01-31",
    )
    .await;
    assert_eq!(after["items"][0]["status"], "pending");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bad_requests_are_refused_with_the_field() {
    let app = TestApp::start().await;
    let assistant = app.token(ALPHA_ASSISTANT);
    let owner = app.token(ALPHA_OWNER);
    let cases = [
        json!({ "kind": "sick" }),
        json!({ "kind": "nap", "first_day": "2030-01-07", "last_day": "2030-01-07" }),
        json!({ "kind": "sick", "first_day": "2030-01-08", "last_day": "2030-01-07" }),
        json!({ "kind": "sick", "starts_at": "2030-01-07T10:00:00+05:30" }),
        json!({ "kind": "sick", "starts_at": "2030-01-07T10:00:00+05:30",
                "ends_at": "2030-01-07T09:00:00+05:30" }),
        json!({ "kind": "sick", "starts_at": "2030-01-07T10:00:00+05:30",
                "ends_at": "2030-01-07T11:00:00+05:30", "first_day": "2030-01-07",
                "last_day": "2030-01-07" }),
        json!({ "kind": "sick", "first_day": "2030-01-07", "last_day": "2030-01-07",
                "reason": "x".repeat(201) }),
        json!({ "kind": "sick", "first_day": "2030-01-07", "last_day": "2030-01-07",
                "membership_id": "nope" }),
        json!({ "kind": "sick", "first_day": "2030-01-07", "last_day": "2030-01-07", "extra": 1 }),
    ];
    for body in cases {
        let (code, error) = post(&app, ALPHA, &assistant, "/api/v1/time-off", body.clone()).await;
        assert!(
            code == StatusCode::BAD_REQUEST || code == StatusCode::UNPROCESSABLE_ENTITY,
            "{body}: {code} {error}"
        );
    }
    // A range over 42 days is refused too.
    let (code, _) = get(
        &app,
        ALPHA,
        &owner,
        "/api/v1/time-off?from=2030-01-01&to=2030-02-12",
    )
    .await;
    assert_eq!(code, StatusCode::BAD_REQUEST);
    let (code, _) = get(
        &app,
        ALPHA,
        &owner,
        "/api/v1/time-off?from=2030-01-01&to=2030-02-11",
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_members_request_is_pending_but_the_owners_entry_is_approved_at_once() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let owner_member = member(&app, ALPHA_OWNER).await;
    let assistant_member = member(&app, ALPHA_ASSISTANT).await;
    doctor(&app, &owner, "Dr Away", Some(&assistant_member)).await;

    // Your own request waits, and tells the people who decide.
    let own = created(&app, &assistant, "/api/v1/time-off", monday()).await;
    assert_eq!(own["status"], "pending");
    assert_eq!(own["kind"], "sick");
    assert_eq!(own["reason"], "migraine");
    assert_eq!(own["membership_id"], assistant_member);
    assert_eq!(leave_reasons(&app).await.len(), 0);
    let id = id_of(&own);
    assert_eq!(notices(&app, &id).await, ["time_off_requested"]);

    // The owner records it for someone else: approved at once, the leave block made, the
    // person told.
    let mut for_assistant =
        json!({ "kind": "vacation", "first_day": "2030-02-04", "last_day": "2030-02-05" });
    for_assistant["membership_id"] = json!(assistant_member);
    let set = created(&app, &owner, "/api/v1/time-off", for_assistant).await;
    assert_eq!(set["status"], "approved");
    assert_eq!(set["decided_by"], owner_member);
    assert_eq!(leave_reasons(&app).await, ["Time off"]);
    assert_eq!(notices(&app, &id_of(&set)).await, ["time_off_decided"]);

    // Switching approval off makes a member's own request approved at once, with no notice.
    let (code, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/settings/staff-ops",
            Some(&owner),
            Some(json!({ "time_off": { "requires_approval": false } })),
        )
        .await;
    assert_eq!(code, StatusCode::OK);
    let auto = created(
        &app,
        &assistant,
        "/api/v1/time-off",
        json!({ "kind": "personal", "first_day": "2030-03-04", "last_day": "2030-03-04" }),
    )
    .await;
    assert_eq!(auto["status"], "approved");
    assert_eq!(leave_reasons(&app).await.len(), 2);
    assert_eq!(notices(&app, &id_of(&auto)).await, Vec::<String>::new());

    // The pending one is decided as the owner chooses, once.
    let (code, declined) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{id}/decline"),
        json!({ "note": "Busy week" }),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{declined}");
    assert_eq!(declined["status"], "declined");
    assert_eq!(declined["decision_note"], "Busy week");
    assert_eq!(
        notices(&app, &id).await,
        ["time_off_decided", "time_off_requested"]
    );
    let (code, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{id}/approve"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT);
    assert_eq!(leave_reasons(&app).await.len(), 2);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn approved_leave_blocks_booking_until_it_is_cancelled() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant_member = member(&app, ALPHA_ASSISTANT).await;
    let dr = doctor(&app, &owner, "Dr Away", Some(&assistant_member)).await;
    let chair1 = chair(&app, &owner, "Chair 1").await;
    let priya = patient(&app, &desk, "Priya Sharma").await;

    // Bookings made before the leave: one to move, one a patient asked for.
    let movable = created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &dr,
            &chair1,
            "2030-01-08T10:00:00+05:30",
            "2030-01-08T10:30:00+05:30",
        ),
    )
    .await;
    let movable_id = movable["appointment"]["id"].as_str().unwrap().to_owned();
    let asked = created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &dr,
            &chair1,
            "2030-01-07T15:00:00+05:30",
            "2030-01-07T15:30:00+05:30",
        ),
    )
    .await;
    let asked_id = asked["appointment"]["id"].as_str().unwrap().to_owned();
    sqlx::query("update aarogyam.appointments set status = 'requested' where id = $1")
        .bind(Uuid::parse_str(&asked_id).unwrap())
        .execute(&app.owner)
        .await
        .unwrap();

    // Pending leave doesn't block anything.
    let request = created(&app, &assistant, "/api/v1/time-off", monday()).await;
    let id = id_of(&request);
    let monday_slot = booking(
        &priya,
        &dr,
        &chair1,
        "2030-01-07T10:00:00+05:30",
        "2030-01-07T10:30:00+05:30",
    );
    let probe = created(&app, &desk, "/api/v1/appointments", monday_slot.clone()).await;
    let probe_id = probe["appointment"]["id"].as_str().unwrap().to_owned();
    sqlx::query("update aarogyam.appointments set status = 'cancelled', cancel_reason = 'test' where id = $1")
        .bind(Uuid::parse_str(&probe_id).unwrap())
        .execute(&app.owner)
        .await
        .unwrap();

    // Approved: the leave block is generic, and booking, moving and confirming are refused.
    let (code, approved) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{id}/approve"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{approved}");
    assert_eq!(leave_reasons(&app).await, ["Time off"]);
    let refused = |code: StatusCode, error: &Value| {
        assert_eq!(code, StatusCode::UNPROCESSABLE_ENTITY, "{error}");
        assert_eq!(error["error"]["code"], "practitioner_on_leave");
    };
    let (code, error) = post(
        &app,
        ALPHA,
        &desk,
        "/api/v1/appointments",
        monday_slot.clone(),
    )
    .await;
    refused(code, &error);
    let (code, error) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/appointments/{movable_id}"),
            Some(&desk),
            Some(json!({ "starts_at": "2030-01-07T11:00:00+05:30" })),
        )
        .await;
    refused(code, &error);
    let (code, error) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/appointments/{asked_id}/status"),
        json!({ "status": "confirmed" }),
    )
    .await;
    refused(code, &error);
    // Nothing changed behind the refusals.
    let (_, still) = get(
        &app,
        ALPHA,
        &desk,
        "/api/v1/appointments?from=2030-01-07&to=2030-01-08",
    )
    .await;
    let statuses: Vec<(&str, &str)> = still["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| (a["id"].as_str().unwrap(), a["status"].as_str().unwrap()))
        .collect();
    assert!(statuses.contains(&(asked_id.as_str(), "requested")));
    assert!(statuses.contains(&(movable_id.as_str(), "booked")));

    // Other days, and editing a note on a booking already inside the leave, are fine.
    let (code, ok) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/appointments/{asked_id}"),
            Some(&desk),
            Some(json!({ "notes": "Call first" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{ok}");
    created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &dr,
            &chair1,
            "2030-01-09T10:00:00+05:30",
            "2030-01-09T10:30:00+05:30",
        ),
    )
    .await;

    // Cancelling the leave makes the doctor bookable again.
    let (code, cancelled) = post(
        &app,
        ALPHA,
        &assistant,
        &format!("/api/v1/time-off/{id}/cancel"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{cancelled}");
    assert_eq!(cancelled["status"], "cancelled");
    assert_eq!(leave_reasons(&app).await.len(), 0);
    created(&app, &desk, "/api/v1/appointments", monday_slot).await;
    let (code, confirmed) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/appointments/{asked_id}/status"),
        json!({ "status": "confirmed" }),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{confirmed}");
    let (code, moved) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/appointments/{movable_id}"),
            Some(&desk),
            Some(json!({ "starts_at": "2030-01-07T11:00:00+05:30" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{moved}");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_declined_request_blocks_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant_member = member(&app, ALPHA_ASSISTANT).await;
    let dr = doctor(&app, &owner, "Dr Away", Some(&assistant_member)).await;
    let chair1 = chair(&app, &owner, "Chair 1").await;
    let priya = patient(&app, &desk, "Priya Sharma").await;
    let id = id_of(&created(&app, &assistant, "/api/v1/time-off", monday()).await);
    let (code, _) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{id}/decline"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &dr,
            &chair1,
            "2030-01-07T10:00:00+05:30",
            "2030-01-07T10:30:00+05:30",
        ),
    )
    .await;
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn kind_and_reason_are_private_and_open_requests_are_for_the_requester_and_the_owner() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant_member = member(&app, ALPHA_ASSISTANT).await;
    doctor(&app, &owner, "Dr Away", Some(&assistant_member)).await;
    let range = "/api/v1/time-off?from=2030-01-01&to=2030-01-31";

    let approved = id_of(&created(&app, &assistant, "/api/v1/time-off", monday()).await);
    let pending = id_of(
        &created(
            &app,
            &assistant,
            "/api/v1/time-off",
            json!({ "kind": "personal", "first_day": "2030-01-14", "last_day": "2030-01-14", "reason": "family" }),
        )
        .await,
    );
    let declined = id_of(
        &created(
            &app,
            &assistant,
            "/api/v1/time-off",
            json!({ "kind": "other", "first_day": "2030-01-15", "last_day": "2030-01-15", "reason": "secret" }),
        )
        .await,
    );
    post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{approved}/approve"),
        json!({ "note": "Rest well" }),
    )
    .await;
    post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{declined}/decline"),
        json!({}),
    )
    .await;

    // Other staff: only that the person is away, and when.
    let (code, seen) = get(&app, ALPHA, &desk, range).await;
    assert_eq!(code, StatusCode::OK);
    let items = seen["items"].as_array().unwrap();
    assert_eq!(items.len(), 1, "{seen}");
    let away = &items[0];
    assert_eq!(away["id"], approved);
    assert_eq!(away["member_name"], "Arun Assistant");
    assert_eq!(away["status"], "approved");
    assert_eq!(away["starts_at"], "2030-01-06T18:30:00Z");
    for private in [
        "kind",
        "reason",
        "decided_by",
        "decided_at",
        "decision_note",
    ] {
        assert!(away[private].is_null(), "{private} leaked: {away}");
    }
    let text = seen.to_string();
    assert!(!text.contains("migraine") && !text.contains("family") && !text.contains("secret"));

    // The person away and the owner see everything about it, and the open requests.
    for who in [&assistant, &owner] {
        let (_, mine) = get(&app, ALPHA, who, range).await;
        let items = mine["items"].as_array().unwrap();
        assert_eq!(items.len(), 3, "{mine}");
        let first = &items[0];
        assert_eq!(first["kind"], "sick");
        assert_eq!(first["reason"], "migraine");
        assert_eq!(first["decision_note"], "Rest well");
    }

    // Cancelled ones are for nobody.
    post(
        &app,
        ALPHA,
        &assistant,
        &format!("/api/v1/time-off/{pending}/cancel"),
        json!({}),
    )
    .await;
    let (_, mine) = get(&app, ALPHA, &owner, range).await;
    assert_eq!(mine["items"].as_array().unwrap().len(), 2);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_the_requester_or_the_owner_cancels() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let id = id_of(&created(&app, &assistant, "/api/v1/time-off", monday()).await);
    // To another member it does not exist.
    let (code, _) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/time-off/{id}/cancel"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::NOT_FOUND);
    let (code, body) = post(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{id}/cancel"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{body}");
    let (code, _) = post(
        &app,
        ALPHA,
        &assistant,
        &format!("/api/v1/time-off/{id}/cancel"),
        json!({}),
    )
    .await;
    assert_eq!(code, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn affected_appointments_list_the_live_ones_and_suggest_free_doctors() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let desk = app.token(ALPHA_FRONT_DESK);
    let assistant_member = member(&app, ALPHA_ASSISTANT).await;
    let away = doctor(&app, &owner, "Dr Away", Some(&assistant_member)).await;
    let free = doctor(&app, &owner, "Dr Free", None).await;
    let no_hours = doctor(&app, &owner, "Dr NoHours", None).await;
    let busy = doctor(&app, &owner, "Dr Busy", None).await;
    let gone = doctor(&app, &owner, "Dr Gone", None).await;
    let chairs = [
        chair(&app, &owner, "Chair 1").await,
        chair(&app, &owner, "Chair 2").await,
        chair(&app, &owner, "Chair 3").await,
    ];
    let priya = patient(&app, &desk, "Priya Sharma").await;
    // Monday 09:00 to 17:00 for the free doctor; the busy one is booked at the time asked.
    let (code, _) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{free}/working-hours"),
            Some(&owner),
            Some(json!({ "shifts": [{ "weekday": 1, "starts": "09:00", "ends": "17:00" }] })),
        )
        .await;
    assert_eq!(code, StatusCode::OK);
    let (code, _) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{busy}/working-hours"),
            Some(&owner),
            Some(json!({ "shifts": [{ "weekday": 1, "starts": "09:00", "ends": "17:00" }] })),
        )
        .await;
    assert_eq!(code, StatusCode::OK);
    created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &busy,
            &chairs[1],
            "2030-01-07T10:00:00+05:30",
            "2030-01-07T10:30:00+05:30",
        ),
    )
    .await;
    created(
        &app,
        &owner,
        "/api/v1/leave-blocks",
        json!({ "practitioner_id": gone, "starts_at": "2030-01-07T09:00:00+05:30",
                "ends_at": "2030-01-07T18:00:00+05:30", "reason": "Conference" }),
    )
    .await;
    let live = created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &away,
            &chairs[0],
            "2030-01-07T10:00:00+05:30",
            "2030-01-07T10:30:00+05:30",
        ),
    )
    .await["appointment"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let cancelled = created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &away,
            &chairs[2],
            "2030-01-07T12:00:00+05:30",
            "2030-01-07T12:30:00+05:30",
        ),
    )
    .await["appointment"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let (code, _) = post(
        &app,
        ALPHA,
        &desk,
        &format!("/api/v1/appointments/{cancelled}/status"),
        json!({ "status": "cancelled", "reason": "Patient asked" }),
    )
    .await;
    assert_eq!(code, StatusCode::OK);
    created(
        &app,
        &desk,
        "/api/v1/appointments",
        booking(
            &priya,
            &away,
            &chairs[0],
            "2030-01-09T10:00:00+05:30",
            "2030-01-09T10:30:00+05:30",
        ),
    )
    .await;

    let id = id_of(&created(&app, &assistant, "/api/v1/time-off", monday()).await);
    let (code, list) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{id}/affected-appointments"),
    )
    .await;
    assert_eq!(code, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 1, "{list}");
    let item = &items[0];
    assert_eq!(item["id"], live);
    assert_eq!(item["practitioner_id"], away);
    assert_eq!(item["status"], "booked");
    assert_eq!(item["patient_name"], "Priya Sharma");
    assert!(item["row_version"].as_i64().is_some());
    // Free doctors only: not the one away, the busy one or the one on leave; the one with hours
    // first, then the one with none set.
    let suggested: Vec<&str> = item["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["practitioner_id"].as_str().unwrap())
        .collect();
    assert_eq!(suggested, [free.as_str(), no_hours.as_str()]);
    assert_eq!(item["suggestions"][0]["in_hours"], true);
    assert_eq!(item["suggestions"][1]["in_hours"], false);

    // Moving it is the usual appointment change.
    let (code, moved) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("/api/v1/appointments/{live}"),
            Some(&desk),
            Some(json!({ "practitioner_id": free })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{moved}");
    let (_, after) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/time-off/{id}/affected-appointments"),
    )
    .await;
    assert_eq!(after["items"], json!([]));
    app.finish().await;
}
