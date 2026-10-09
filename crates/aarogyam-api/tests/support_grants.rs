//! Support grants: an owner lets Sakalya staff read the clinic for up to seven days. Staff read
//! through the normal clinic routes on the clinic's host, can't write, are recorded per request
//! with the grant, and lose access when the grant is revoked or ends.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, CONSOLE, TestApp};
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};

fn in_hours(hours: i64) -> String {
    (OffsetDateTime::now_utc() + Duration::hours(hours))
        .format(&Rfc3339)
        .unwrap()
}

async fn grant(app: &TestApp, host: &str, token: &str, body: Value) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        host,
        "/api/v1/support-grants",
        Some(token),
        Some(body),
    )
    .await
}

fn staff_grant() -> Value {
    json!({ "staff_email": "staff@sakalya.test", "reason": "Help with the letterhead", "ends_at": in_hours(4) })
}

/// Under a grant, reads work through the normal routes; writes and member-only routes don't.
async fn reads_but_never_writes(app: &TestApp, staff: &str, patient: &str) {
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(staff), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, one) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/patients/{patient}"),
            Some(staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{one}");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(staff),
            Some(json!({ "full_name": "X Y" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/support-grants",
            Some(staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/me/working-hours",
            Some(staff),
            None,
        )
        .await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "member-only routes stay closed"
    );
}

/// Every request under the grant is recorded with it, by route template, never a value; the
/// access record names support as the reader.
async fn recorded_under_the_grant(app: &TestApp, owner: &str, id: &str, patient: &str) {
    let (status, actions) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/support-grants/{id}/actions"),
            Some(owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{actions}");
    let routes: Vec<&str> = actions["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["route"].as_str().unwrap())
        .collect();
    assert!(routes.contains(&"/api/v1/patients/{id}"), "{routes:?}");
    assert!(routes.contains(&"/api/v1/patients"), "{routes:?}");
    assert!(!routes.iter().any(|route| route.contains(patient)));
    // The access record names support as the reader, for the support purpose.
    let (kind, purpose): (String, String) = sqlx::query_as(
        "select actor_kind, purpose from audit.access_log where patient_id = $1::uuid order by at desc limit 1",
    )
    .bind(patient)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((kind.as_str(), purpose.as_str()), ("support", "support"));
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_read_under_a_grant_until_it_is_revoked() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let staff = app.token(STAFF);
    let (status, patient) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/patients",
            Some(&owner),
            Some(json!({ "full_name": "Kavya Rao" })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{patient}");
    let patient = patient["id"].as_str().unwrap().to_owned();

    // No grant: staff are strangers to the clinic.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&staff), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, created) = grant(&app, ALPHA, &owner, staff_grant()).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    assert_eq!(created["status"], "active");
    assert_eq!(created["access"], "read");
    assert_eq!(created["staff_name"], "Sakalya Staff");
    let id = created["id"].as_str().unwrap().to_owned();

    reads_but_never_writes(&app, &staff, &patient).await;
    // The grant is for Alpha only.
    let (status, _) = app
        .send(Method::GET, BETA, "/api/v1/patients", Some(&staff), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // A single factor isn't enough.
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/patients",
            Some(&app.token_aal1(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    recorded_under_the_grant(&app, &owner, &id, &patient).await;

    // The console lists it for the staff member.
    let (status, mine) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/support-grants",
            Some(&staff),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{mine}");
    assert_eq!(mine["items"][0]["slug"], "alpha");
    assert_eq!(mine["items"][0]["status"], "active");

    // Revoked: access stops at once, and a second revoke is a conflict.
    let revoke = format!("/api/v1/support-grants/{id}/revoke");
    let (status, revoked) = app
        .send(Method::POST, ALPHA, &revoke, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{revoked}");
    assert_eq!(revoked["status"], "revoked");
    assert_eq!(revoked["revoked_by"], "Asha Owner");
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&staff), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::POST, ALPHA, &revoke, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_owners_grant_and_other_clinics_see_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    for person in [ALPHA_FRONT_DESK, ALPHA_ASSISTANT] {
        let token = app.token(person);
        let (status, _) = grant(&app, ALPHA, &token, staff_grant()).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = app
            .send(
                Method::GET,
                ALPHA,
                "/api/v1/support-grants",
                Some(&token),
                None,
            )
            .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, created) = grant(&app, ALPHA, &owner, staff_grant()).await;
    assert_eq!(status, StatusCode::CREATED, "{created}");
    let id = created["id"].as_str().unwrap();
    let front_desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/support-grants/{id}/revoke"),
            Some(&front_desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/support-grants/{id}/actions"),
            Some(&front_desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // Beta's owner can't see, revoke or read Alpha's grant.
    let beta = app.token(BETA_OWNER);
    let (status, list) = app
        .send(
            Method::GET,
            BETA,
            "/api/v1/support-grants",
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 0);
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            &format!("/api/v1/support-grants/{id}/revoke"),
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(
            Method::GET,
            BETA,
            &format!("/api/v1/support-grants/{id}/actions"),
            Some(&beta),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Only staff list their grants, on the console host only.
    let (status, _) = app
        .send(
            Method::GET,
            CONSOLE,
            "/api/v1/console/support-grants",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/console/support-grants",
            Some(&app.token(STAFF)),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn grants_are_short_named_single_and_end_by_themselves() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let reason = "Help with the letterhead";
    for (body, field) in [
        (
            json!({ "staff_email": "staff@sakalya.test", "reason": reason, "ends_at": in_hours(24 * 7 + 1) }),
            "ends_at",
        ),
        (
            json!({ "staff_email": "staff@sakalya.test", "reason": reason, "ends_at": in_hours(0) }),
            "ends_at",
        ),
        (
            json!({ "staff_email": "staff@sakalya.test", "reason": "x", "ends_at": in_hours(2) }),
            "reason",
        ),
        (
            json!({ "staff_email": "asha@alpha.test", "reason": reason, "ends_at": in_hours(2) }),
            "staff_email",
        ),
        (
            json!({ "staff_email": "nobody", "reason": reason, "ends_at": in_hours(2) }),
            "staff_email",
        ),
    ] {
        let (status, value) = grant(&app, ALPHA, &owner, body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{field}: {value}");
        assert!(value.to_string().contains(field), "{value}");
    }
    let (status, _) = grant(&app, ALPHA, &owner, staff_grant()).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, _) = grant(&app, ALPHA, &owner, staff_grant()).await;
    assert_eq!(status, StatusCode::CONFLICT, "one active grant per person");

    // Nothing but revocation changes a grant, even for the schema owner.
    sqlx::query("update aarogyam.support_grants set ends_at = ends_at + interval '1 day'")
        .execute(&app.owner)
        .await
        .unwrap_err();
    // A grant whose end has passed lets nobody in, and lists as ended.
    sqlx::query("alter table aarogyam.support_grants disable trigger guard")
        .execute(&app.owner)
        .await
        .unwrap();
    sqlx::query("update aarogyam.support_grants set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day'")
        .execute(&app.owner)
        .await
        .unwrap();
    let staff = app.token(STAFF);
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&staff), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, list) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/support-grants",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(list["items"][0]["status"], "ended");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_database_refuses_writes_from_support() {
    use sakalya_db::{ActorKind, DbError, Scope};
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let support_kind = ActorKind::new("support").unwrap();
    let scope = Scope::tenant(alpha)
        .with_user(uuid::Uuid::now_v7())
        .with_actor_kind(support_kind);
    let error = app
        .api_db()
        .scoped(&scope, async |tx| {
            sqlx::query("insert into aarogyam.rooms (name, kind) values ('Chair 9', 'chair')")
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), sakalya_db::DbErrorKind::Forbidden, "{error}");
    app.finish().await;
}
