//! First-run setup on a real database: the owner's wizard state (permissions, validation,
//! resume, cross-clinic isolation) and a doctor's own one screen.
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

const CLINIC: &str = "/api/v1/settings/onboarding";
const MINE: &str = "/api/v1/me/onboarding";

fn statuses(setup: &Value) -> Vec<(String, String)> {
    setup["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| {
            (
                step["key"].as_str().unwrap().to_owned(),
                step["status"].as_str().unwrap().to_owned(),
            )
        })
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_owner_answers_steps_and_resumes_where_they_left() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);

    // A new clinic: nothing answered, every step to do, in order.
    let (status, setup) = app
        .send(Method::GET, ALPHA, CLINIC, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{setup}");
    assert_eq!(setup["standing"], "new");
    assert_eq!(
        statuses(&setup)
            .iter()
            .map(|(key, state)| format!("{key}:{state}"))
            .collect::<Vec<_>>(),
        [
            "clinic:todo",
            "hours:todo",
            "look:todo",
            "services:todo",
            "team:todo"
        ]
    );

    // Progress is saved per step, and a later visit finds it.
    let (status, setup) = app
        .send(
            Method::PATCH,
            ALPHA,
            CLINIC,
            Some(&owner),
            Some(json!({ "step": "clinic", "status": "done", "practice": "team" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{setup}");
    assert_eq!(setup["standing"], "in_progress");
    assert_eq!(setup["practice"], "team");
    app.send(
        Method::PATCH,
        ALPHA,
        CLINIC,
        Some(&owner),
        Some(json!({ "step": "hours", "status": "skipped" })),
    )
    .await;
    let (_, again) = app
        .send(Method::GET, ALPHA, CLINIC, Some(&owner), None)
        .await;
    assert_eq!(again["standing"], "in_progress");
    assert_eq!(again["practice"], "team");
    assert_eq!(statuses(&again)[0], ("clinic".into(), "done".into()));
    assert_eq!(statuses(&again)[1], ("hours".into(), "skipped".into()));
    assert_eq!(statuses(&again)[2], ("look".into(), "todo".into()));

    // Dismissing hides the card but keeps the answers; reopening brings it back.
    let (_, setup) = app
        .send(
            Method::PATCH,
            ALPHA,
            CLINIC,
            Some(&owner),
            Some(json!({ "dismissed": true })),
        )
        .await;
    assert_eq!(setup["standing"], "dismissed");
    assert_eq!(statuses(&setup)[0], ("clinic".into(), "done".into()));
    let (_, setup) = app
        .send(
            Method::PATCH,
            ALPHA,
            CLINIC,
            Some(&owner),
            Some(json!({ "dismissed": false })),
        )
        .await;
    assert_eq!(setup["standing"], "in_progress");

    // Answering every step completes it; reopening one makes it resumable again.
    for key in ["look", "services", "team"] {
        app.send(
            Method::PATCH,
            ALPHA,
            CLINIC,
            Some(&owner),
            Some(json!({ "step": key, "status": "done" })),
        )
        .await;
    }
    let (_, setup) = app
        .send(Method::GET, ALPHA, CLINIC, Some(&owner), None)
        .await;
    assert_eq!(setup["standing"], "complete");
    let (_, setup) = app
        .send(
            Method::PATCH,
            ALPHA,
            CLINIC,
            Some(&owner),
            Some(json!({ "step": "look", "status": "todo" })),
        )
        .await;
    assert_eq!(setup["standing"], "in_progress");

    // Bad input names the field and changes nothing.
    for body in [
        json!({ "step": "profile", "status": "done" }),
        json!({ "step": "look", "status": "maybe" }),
        json!({ "step": "look" }),
        json!({ "practice": "chain" }),
    ] {
        let (status, error) = app
            .send(
                Method::PATCH,
                ALPHA,
                CLINIC,
                Some(&owner),
                Some(body.clone()),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_settings_managers_touch_the_clinic_setup_and_clinics_stay_apart() {
    let app = TestApp::start().await;
    for (who, expected) in [
        (ALPHA_ASSISTANT, StatusCode::FORBIDDEN),
        (ALPHA_FRONT_DESK, StatusCode::FORBIDDEN),
        (ALPHA_NOTHING, StatusCode::FORBIDDEN),
        (STRANGER, StatusCode::NOT_FOUND),
        // Another clinic's owner is not a member here.
        (BETA_OWNER, StatusCode::NOT_FOUND),
    ] {
        let token = app.token(who);
        let (status, _) = app
            .send(Method::GET, ALPHA, CLINIC, Some(&token), None)
            .await;
        assert_eq!(status, expected, "GET as {who}");
        let (status, _) = app
            .send(
                Method::PATCH,
                ALPHA,
                CLINIC,
                Some(&token),
                Some(json!({ "step": "clinic", "status": "done" })),
            )
            .await;
        assert_eq!(status, expected, "PATCH as {who}");
        let (status, _) = app.send(Method::GET, ALPHA, MINE, Some(&token), None).await;
        if who == ALPHA_ASSISTANT || who == ALPHA_FRONT_DESK || who == ALPHA_NOTHING {
            assert_eq!(status, StatusCode::OK, "own setup as {who}");
        } else {
            assert_eq!(status, StatusCode::NOT_FOUND, "own setup as {who}");
        }
    }

    // Alpha's progress doesn't show in Beta's setup.
    let alpha = app.token(ALPHA_OWNER);
    app.send(
        Method::PATCH,
        ALPHA,
        CLINIC,
        Some(&alpha),
        Some(json!({ "step": "clinic", "status": "done", "practice": "solo" })),
    )
    .await;
    let beta = app.token(BETA_OWNER);
    let (status, setup) = app.send(Method::GET, BETA, CLINIC, Some(&beta), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(setup["standing"], "new");
    assert_eq!(setup["practice"], Value::Null);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_invited_doctor_fills_in_their_own_screen_and_nothing_else() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);

    // Not a doctor yet: no record, so the profile and hours answer 404.
    for path in ["/api/v1/me/practitioner", "/api/v1/me/working-hours"] {
        let (status, _) = app
            .send(Method::GET, ALPHA, path, Some(&assistant), None)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }

    // Without the right to issue prescriptions there is no doctor record to make.
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/me/practitioner",
            Some(&assistant),
            Some(json!({ "qualifications": "BDS" })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // A member who can issue prescriptions gets their record on first save, named after their
    // account and linked to them.
    let (status, own) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/me/practitioner",
            Some(&owner),
            Some(json!({ "qualifications": "BDS, MDS", "registration_number": "MH-9" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{own}");
    assert_eq!(own["display_name"], "Asha Owner");
    assert_eq!(own["qualifications"], "BDS, MDS");
    let (status, again) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/me/practitioner",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["id"], own["id"]);

    // The owner makes the member a doctor, as the invitation flow does.
    let (_, session) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/session",
            Some(&assistant),
            None,
        )
        .await;
    let membership = session["membership"]["id"].as_str().unwrap().to_owned();
    let (status, doctor) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/practitioners",
            Some(&owner),
            Some(json!({ "membership_id": membership, "display_name": "Dr Arun", "calendar_color": "#112233" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{doctor}");

    // The doctor sets their own details; colour and availability are not theirs to change.
    let (status, mine) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/me/practitioner",
            Some(&assistant),
            Some(json!({
                "qualifications": "BDS, MDS",
                "registration_number": "MH-1234",
                "calendar_color": "#AABBCC",
                "active": false,
                "membership_id": ""
            })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{mine}");
    assert_eq!(mine["qualifications"], "BDS, MDS");
    assert_eq!(mine["registration_number"], "MH-1234");
    assert_eq!(mine["calendar_color"], "#112233");
    assert_eq!(mine["active"], true);
    assert_eq!(mine["membership_id"], membership.as_str());
    let (status, error) = app
        .send(
            Method::PATCH,
            ALPHA,
            "/api/v1/me/practitioner",
            Some(&assistant),
            Some(json!({ "qualifications": "x".repeat(161) })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");

    // Split shifts; overlapping ones are refused.
    let shifts = json!({ "shifts": [
        { "weekday": 1, "starts": "09:00", "ends": "13:00" },
        { "weekday": 1, "starts": "17:00", "ends": "20:00" }
    ] });
    let (status, hours) = app
        .send(
            Method::PUT,
            ALPHA,
            "/api/v1/me/working-hours",
            Some(&assistant),
            Some(shifts),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{hours}");
    assert_eq!(hours["shifts"].as_array().unwrap().len(), 2);
    let overlapping = json!({ "shifts": [
        { "weekday": 2, "starts": "09:00", "ends": "13:00" },
        { "weekday": 2, "starts": "12:00", "ends": "14:00" }
    ] });
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            "/api/v1/me/working-hours",
            Some(&assistant),
            Some(overlapping),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (_, hours) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/me/working-hours",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(hours["shifts"].as_array().unwrap().len(), 2);

    // The owner sees the same hours on the doctor's record.
    let id = doctor["id"].as_str().unwrap();
    let (_, seen) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/practitioners/{id}/working-hours"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(seen["shifts"].as_array().unwrap().len(), 2);

    // Their own setup is theirs: it doesn't touch the clinic's, nor another member's.
    let (status, setup) = app
        .send(
            Method::PATCH,
            ALPHA,
            MINE,
            Some(&assistant),
            Some(json!({ "step": "profile", "status": "done" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{setup}");
    assert_eq!(setup["standing"], "complete");
    let (_, owner_own) = app.send(Method::GET, ALPHA, MINE, Some(&owner), None).await;
    assert_eq!(owner_own["standing"], "new");
    let (_, clinic) = app
        .send(Method::GET, ALPHA, CLINIC, Some(&owner), None)
        .await;
    assert_eq!(clinic["standing"], "new");
    // Clinic-only steps and fields are refused on a member's setup.
    for body in [
        json!({ "step": "clinic", "status": "done" }),
        json!({ "practice": "solo" }),
    ] {
        let (status, _) = app
            .send(Method::PATCH, ALPHA, MINE, Some(&assistant), Some(body))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    app.finish().await;
}
