//! A patient booked twice at the same time: allowed, but the booking carries a `patient_overlap`
//! warning. Cancelled, no-show and completed appointments hold nothing; other clinics are invisible.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "one journey end to end: book, overlap, reschedule, cancel, other clinic"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn created(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert_eq!(status, StatusCode::CREATED, "POST {path}: {value}");
    value
}

async fn make(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> String {
    id_of(&created(app, host, token, path, body).await)
}

fn booking(patient: &str, doctor: &str, room: Option<&str>, starts: &str, ends: &str) -> Value {
    let mut body = json!({
        "patient_id": patient, "practitioner_id": doctor,
        "starts_at": starts, "ends_at": ends, "reason": "Check-up"
    });
    if let Some(room) = room {
        body["room_id"] = json!(room);
    }
    body
}

/// How many overlapping appointments the response lists; the field is left out when none.
fn overlaps(saved: &Value) -> usize {
    saved
        .get("patient_overlaps")
        .map_or(0, |list| list.as_array().unwrap().len())
}

fn codes(saved: &Value) -> Vec<String> {
    saved["warnings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| w["code"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_same_patient_in_one_slot_gets_a_warning_with_any_doctor_or_chair() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let beta_owner = app.token(BETA_OWNER);
    let chair1 = make(
        &app,
        ALPHA,
        &owner,
        "/api/v1/rooms",
        json!({ "name": "Chair 1" }),
    )
    .await;
    let chair2 = make(
        &app,
        ALPHA,
        &owner,
        "/api/v1/rooms",
        json!({ "name": "Chair 2" }),
    )
    .await;
    let asha = make(
        &app,
        ALPHA,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
    )
    .await;
    let dev = make(
        &app,
        ALPHA,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Dev", "calendar_color": "#1d4ed8" }),
    )
    .await;
    let person = json!({ "full_name": "Elon Test", "sex": "male", "age_years": 40 });
    let elon = make(&app, ALPHA, &desk, "/api/v1/patients", person.clone()).await;
    let path = "/api/v1/appointments";
    let (s10, e10) = ("2030-01-07T10:00:00+05:30", "2030-01-07T10:30:00+05:30");

    let first = created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(&elon, &asha, Some(&chair1), s10, e10),
    )
    .await;
    assert!(first.get("patient_overlaps").is_none(), "{first}");
    let first_id = id_of(&first["appointment"]);

    // Another doctor, another chair: allowed, with the patient warning (and no doctor warning).
    let second = created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(
            &elon,
            &dev,
            Some(&chair2),
            "2030-01-07T10:15:00+05:30",
            "2030-01-07T10:45:00+05:30",
        ),
    )
    .await;
    assert!(
        codes(&second).is_empty(),
        "old clients see no new warning code: {second}"
    );
    assert_eq!(overlaps(&second), 1);
    let clash = &second["patient_overlaps"][0];
    assert_eq!(clash["appointment_id"], first_id);
    assert_eq!(clash["practitioner_name"], "Dr Asha");
    assert_eq!(clash["room_name"], "Chair 1");
    assert_eq!(clash["starts_at"], "2030-01-07T04:30:00Z");
    // No chair at all: still warned.
    let third = created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(&elon, &dev, None, s10, e10),
    )
    .await;
    assert_eq!(overlaps(&third), 2, "{third}");
    // Back to back is not an overlap.
    let after = created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(
            &elon,
            &asha,
            None,
            "2030-01-07T11:00:00+05:30",
            "2030-01-07T11:30:00+05:30",
        ),
    )
    .await;
    assert_eq!(overlaps(&after), 0, "{after}");

    // Rescheduling into another appointment's time warns too.
    let (code, moved) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("{path}/{}", id_of(&after["appointment"])),
            Some(&desk),
            Some(json!({ "starts_at": "2030-01-07T10:00:00+05:30", "ends_at": "2030-01-07T10:30:00+05:30" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{moved}");
    assert!(overlaps(&moved) >= 1, "{moved}");
    // A note-only edit moves nothing, so it doesn't warn again.
    let (code, noted) = app
        .send(
            Method::PATCH,
            ALPHA,
            &format!("{path}/{}", id_of(&after["appointment"])),
            Some(&desk),
            Some(json!({ "notes": "bring the X-ray" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{noted}");
    assert_eq!(overlaps(&noted), 0, "{noted}");
    // Moving and confirming (the /move path) reports the clash too.
    created(
        &app,
        ALPHA,
        &desk,
        path,
        booking(
            &elon,
            &dev,
            None,
            "2030-01-07T15:00:00+05:30",
            "2030-01-07T15:30:00+05:30",
        ),
    )
    .await;
    let (code, shifted) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{path}/{}/move", id_of(&after["appointment"])),
            Some(&desk),
            Some(json!({ "starts_at": "2030-01-07T15:10:00+05:30" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK, "{shifted}");
    assert!(overlaps(&shifted) >= 1, "{shifted}");

    // Cancelled, no-show and completed hold nothing: a clean patient, one of each.
    let ana = make(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients",
        json!({ "full_name": "Ana Test", "sex": "female", "age_years": 30 }),
    )
    .await;
    let mut ids = Vec::new();
    for hour in ["09", "13", "14"] {
        let s = format!("2030-01-08T{hour}:00:00+05:30");
        let e = format!("2030-01-08T{hour}:30:00+05:30");
        let saved = created(&app, ALPHA, &desk, path, booking(&ana, &asha, None, &s, &e)).await;
        ids.push(id_of(&saved["appointment"]));
    }
    let (code, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{path}/{}/status", ids[0]),
            Some(&desk),
            Some(json!({ "status": "cancelled", "reason": "Patient called" })),
        )
        .await;
    assert_eq!(code, StatusCode::OK);
    sqlx::query("update aarogyam.appointments set status = 'no_show' where id = $1::uuid")
        .bind(&ids[1])
        .execute(&app.owner)
        .await
        .unwrap();
    sqlx::query("update aarogyam.appointments set status = 'completed' where id = $1::uuid")
        .bind(&ids[2])
        .execute(&app.owner)
        .await
        .unwrap();
    for (hour, other) in [("09", &dev), ("13", &dev), ("14", &dev)] {
        let s = format!("2030-01-08T{hour}:10:00+05:30");
        let e = format!("2030-01-08T{hour}:40:00+05:30");
        let saved = created(&app, ALPHA, &desk, path, booking(&ana, other, None, &s, &e)).await;
        assert_eq!(overlaps(&saved), 0, "{hour}: {saved}");
    }

    // Another clinic never sees Alpha's bookings, even for a same-named patient.
    let beta_doctor = make(
        &app,
        BETA,
        &beta_owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Beta", "calendar_color": "#0f766e" }),
    )
    .await;
    let beta_elon = make(&app, BETA, &beta_owner, "/api/v1/patients", person).await;
    let beta = created(
        &app,
        BETA,
        &beta_owner,
        path,
        booking(&beta_elon, &beta_doctor, None, s10, e10),
    )
    .await;
    assert_eq!(overlaps(&beta), 0, "{beta}");

    // The list still carries who is who: the first appointment is new, a later one a follow-up
    // only after a completed visit (covered in today_v2); here just that the field is present.
    let (code, day) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("{path}?from=2030-01-07&to=2030-01-07"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(code, StatusCode::OK);
    let row = day["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["id"] == first_id)
        .unwrap();
    assert_eq!(row["patient_type"], "new");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_imported_last_visit_before_the_appointment_makes_it_a_follow_up() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let doctor = make(
        &app,
        ALPHA,
        &owner,
        "/api/v1/practitioners",
        json!({ "display_name": "Dr Asha", "calendar_color": "#0f766e" }),
    )
    .await;
    let imported = make(
        &app,
        ALPHA,
        &desk,
        "/api/v1/patients",
        json!({ "full_name": "Imported Test", "sex": "male", "age_years": 50 }),
    )
    .await;
    let booked = created(
        &app,
        ALPHA,
        &desk,
        "/api/v1/appointments",
        booking(
            &imported,
            &doctor,
            None,
            "2030-02-04T10:00:00+05:30",
            "2030-02-04T10:30:00+05:30",
        ),
    )
    .await;
    let id = id_of(&booked["appointment"]);
    let kind = |last_visit: Option<&'static str>| {
        let (app, desk, id, imported) = (&app, &desk, &id, &imported);
        async move {
            sqlx::query(
                "update aarogyam.patients set last_visit_at = $2::timestamptz where id = $1::uuid",
            )
            .bind(imported)
            .bind(last_visit)
            .execute(&app.owner)
            .await
            .unwrap();
            let (code, day) = app
                .send(
                    Method::GET,
                    ALPHA,
                    "/api/v1/appointments?from=2030-02-04&to=2030-02-04",
                    Some(desk),
                    None,
                )
                .await;
            assert_eq!(code, StatusCode::OK);
            day["items"]
                .as_array()
                .unwrap()
                .iter()
                .find(|a| a["id"] == *id)
                .unwrap()["patient_type"]
                .as_str()
                .unwrap()
                .to_owned()
        }
    };
    assert_eq!(kind(None).await, "new");
    assert_eq!(kind(Some("2029-11-01T00:00:00Z")).await, "follow_up");
    // A "last visit" after the appointment's start is not history yet.
    assert_eq!(kind(Some("2030-02-05T00:00:00Z")).await, "new");
}
