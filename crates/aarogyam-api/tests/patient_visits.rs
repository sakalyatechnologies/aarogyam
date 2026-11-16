//! The patient app's visits, `/me/patient/visits`: only the patient's own closed visits, the Plan
//! of signed notes as advice and nothing else, and what row-level security (migration 0712) lets
//! a patient account read of `encounters`, `procedures`, `recalls` and `clinical_notes`.
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
use sakalya_db::{ActorKind, DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::{Uuid, uuid};

const APP: &str = "app.localtest.me";
const RAVI: Uuid = uuid!("e0000000-0000-4000-8000-000000000011");
const MEERA: Uuid = uuid!("e0000000-0000-4000-8000-000000000012");

const PATIENT_ACCOUNT: ActorKind = match ActorKind::new("patient_account") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

async fn send(
    app: &TestApp,
    method: Method,
    host: &str,
    token: Option<&str>,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, token, body).await
}

async fn created(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = send(app, Method::POST, host, Some(token), path, Some(body)).await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn register(app: &TestApp, host: &str, token: &str, name: &str, email: &str) -> String {
    id_of(
        &created(
            app,
            host,
            token,
            "/api/v1/patients",
            json!({ "full_name": name, "sex": "male", "age_years": 40, "email": email }),
        )
        .await,
    )
}

/// A visit with one signed SOAP note (plan `plan`), one draft note, and one done procedure.
/// Closed when `close`, otherwise left open.
async fn visit(
    app: &TestApp,
    host: &str,
    token: &str,
    patient: &str,
    plan: &str,
    close: bool,
) -> String {
    let visit = id_of(
        &created(
            app,
            host,
            token,
            &format!("/api/v1/patients/{patient}/visits"),
            json!({ "chief_complaint": "Check-up" }),
        )
        .await,
    );
    let note = created(
        app,
        host,
        token,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "sections": {
            "subjective": "SECRET-S pain", "objective": "SECRET-O swelling",
            "assessment": "SECRET-A abscess", "plan": plan
        } }),
    )
    .await;
    let (status, signed) = send(
        app,
        Method::POST,
        host,
        Some(token),
        &format!("/api/v1/notes/{}/sign", id_of(&note)),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{signed}");
    created(
        app,
        host,
        token,
        &format!("/api/v1/visits/{visit}/notes"),
        json!({ "kind": "progress", "sections": { "plan": "DRAFT-PLAN not signed" } }),
    )
    .await;
    created(
        app,
        host,
        token,
        &format!("/api/v1/visits/{visit}/procedures"),
        json!({ "name": "Scaling", "tooth": 36, "price_paise": 123_400 }),
    )
    .await;
    if close {
        let (status, closed) = send(
            app,
            Method::POST,
            host,
            Some(token),
            &format!("/api/v1/visits/{visit}/close"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{closed}");
    }
    visit
}

async fn link(app: &TestApp, owner: &str, patient: &str, account: &str) {
    let invitation = created(
        app,
        ALPHA,
        owner,
        &format!("/api/v1/patients/{patient}/app-invitations"),
        json!({}),
    )
    .await;
    let (status, linked) = send(
        app,
        Method::POST,
        APP,
        Some(account),
        "/api/v1/me/patient/links",
        Some(json!({ "code": invitation["code"] })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{linked}");
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_patient_app_shows_own_closed_visits_only() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    let ravi = app
        .tokens
        .mint_with_email(RAVI, Some("ravi@example.test"))
        .unwrap();
    let meera = app
        .tokens
        .mint_with_email(MEERA, Some("meera@example.test"))
        .unwrap();
    let mine = register(&app, ALPHA, &owner, "Ravi Kumar", "ravi@example.test").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar", "other@example.test").await;
    let at_beta = register(&app, BETA, &beta_owner, "Ravi Kumar", "ravi@example.test").await;
    let closed = visit(
        &app,
        ALPHA,
        &owner,
        &mine,
        "Rinse with warm salt water",
        true,
    )
    .await;
    let other_visit = visit(&app, ALPHA, &owner, &other, "OTHER-PLAN", true).await;
    let beta_visit = visit(&app, BETA, &beta_owner, &at_beta, "BETA-PLAN", true).await;
    created(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{mine}/recalls"),
        json!({ "due_on": "2099-01-01", "reason": "Review" }),
    )
    .await;

    // Not linked: nothing, and no visit by id.
    let (status, none) = send(
        &app,
        Method::GET,
        APP,
        Some(&ravi),
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{none}");
    assert_eq!(none["items"], json!([]));
    link(&app, &owner, &mine, &ravi).await;

    // An open visit never shows, with a signed plan of its own.
    let open = visit(&app, ALPHA, &owner, &mine, "OPEN-PLAN", false).await;

    let (status, list) = send(
        &app,
        Method::GET,
        APP,
        Some(&ravi),
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    let items = list["items"].as_array().unwrap();
    assert_eq!(items.len(), 1, "{list}");
    let item = &items[0];
    assert_eq!(item["id"], closed);
    assert_eq!(item["clinic_id"], app.clinic_id("alpha").await.to_string());
    assert_eq!(item["advice"], "Rinse with warm salt water");
    assert_eq!(item["treatments"][0]["name"], "Scaling");
    assert_eq!(item["treatments"][0]["tooth"], 36);
    assert_eq!(item["next_follow_up"]["due_on"], "2099-01-01");
    let text = list.to_string();
    for hidden in [
        "SECRET-",
        "DRAFT-PLAN",
        "OPEN-PLAN",
        "OTHER-PLAN",
        "BETA-PLAN",
        "price",
        "123400",
    ] {
        assert!(!text.contains(hidden), "{hidden} leaked: {text}");
    }

    let path = format!("/api/v1/me/patient/visits/{closed}");
    let (status, one) = send(&app, Method::GET, APP, Some(&ravi), &path, None).await;
    assert_eq!(status, StatusCode::OK, "{one}");
    assert_eq!(one["id"], closed);
    assert_eq!(one["advice"], "Rinse with warm salt water");
    // A correction replaces the note: the patient sees only the corrected plan, never both.
    let (_, detail) = send(
        &app,
        Method::GET,
        ALPHA,
        Some(&owner),
        &format!("/api/v1/visits/{closed}"),
        None,
    )
    .await;
    let signed = detail["notes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["status"] == "signed")
        .unwrap();
    let (status, fixed) = send(
        &app,
        Method::POST,
        ALPHA,
        Some(&owner),
        &format!("/api/v1/notes/{}/amend", id_of(signed)),
        Some(json!({ "sections": { "plan": "Rinse with cold water" } })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{fixed}");
    let (_, again) = send(&app, Method::GET, APP, Some(&ravi), &path, None).await;
    assert_eq!(again["advice"], "Rinse with cold water", "{again}");
    // An open visit of their own, another patient's, another clinic's, and an unlinked
    // account: all 404.
    for id in [&open, &other_visit, &beta_visit] {
        let (status, _) = send(
            &app,
            Method::GET,
            APP,
            Some(&ravi),
            &format!("/api/v1/me/patient/visits/{id}"),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{id}");
    }
    let (status, _) = send(&app, Method::GET, APP, Some(&meera), &path, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Closing the open visit makes it appear, with its own plan.
    send(
        &app,
        Method::POST,
        ALPHA,
        Some(&owner),
        &format!("/api/v1/visits/{open}/close"),
        None,
    )
    .await;
    let (status, shown) = send(
        &app,
        Method::GET,
        APP,
        Some(&ravi),
        &format!("/api/v1/me/patient/visits/{open}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{shown}");
    assert_eq!(shown["advice"], "OPEN-PLAN");
    // Patient routes live on the app host only.
    let (status, _) = send(
        &app,
        Method::GET,
        ALPHA,
        Some(&ravi),
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(
        &app,
        Method::GET,
        APP,
        None,
        "/api/v1/me/patient/visits",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_patient_account_reads_visits_through_row_level_security_and_never_writes() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let ravi = app
        .tokens
        .mint_with_email(RAVI, Some("ravi@example.test"))
        .unwrap();
    let mine = register(&app, ALPHA, &owner, "Ravi Kumar", "ravi@example.test").await;
    let other = register(&app, ALPHA, &owner, "Ravi Kumar", "other@example.test").await;
    let closed = visit(
        &app,
        ALPHA,
        &owner,
        &mine,
        "Rinse with warm salt water",
        true,
    )
    .await;
    visit(&app, ALPHA, &owner, &other, "OTHER-PLAN", true).await;
    created(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{mine}/recalls"),
        json!({ "due_on": "2099-01-01", "reason": "Review" }),
    )
    .await;
    created(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{other}/recalls"),
        json!({ "due_on": "2099-01-01", "reason": "Review" }),
    )
    .await;
    link(&app, &owner, &mine, &ravi).await;
    let open = visit(&app, ALPHA, &owner, &mine, "OPEN-PLAN", false).await;

    let account: Uuid =
        sqlx::query_scalar("select id from aarogyam.patient_accounts where auth_uid = $1")
            .bind(RAVI)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let alpha = app.clinic_id("alpha").await;
    let beta = app.clinic_id("beta").await;
    let mine_id: Uuid = mine.parse().unwrap();
    let db = app.api_db();
    let patient_scope = |clinic: Uuid, who: Uuid| {
        Scope::tenant(clinic)
            .with_user(who)
            .with_actor_kind(PATIENT_ACCOUNT)
    };
    let count = async |scope: Scope, query: &str| -> i64 {
        db.scoped(&scope, async |tx| {
            sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(query.to_owned()))
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap()
    };
    let advice = async |scope: Scope, visit: &str| -> Option<String> {
        let visit: Uuid = visit.parse().unwrap();
        db.scoped(&scope, async |tx| {
            sqlx::query_scalar::<_, Option<String>>("select app.visit_advice($1)")
                .bind(visit)
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap()
    };

    // Reads: own closed rows only; notes stay closed.
    let stranger = Uuid::now_v7();
    let cases = [
        ("select count(*) from aarogyam.encounters", 1),
        ("select count(*) from aarogyam.procedures", 1),
        ("select count(*) from aarogyam.recalls", 1),
        ("select count(*) from aarogyam.clinical_notes", 0),
    ];
    for (query, expected) in cases {
        assert_eq!(
            count(patient_scope(alpha, account), query).await,
            expected,
            "linked: {query}"
        );
        assert_eq!(
            count(patient_scope(alpha, stranger), query).await,
            0,
            "unlinked: {query}"
        );
        assert_eq!(
            count(patient_scope(beta, account), query).await,
            0,
            "other clinic: {query}"
        );
    }
    // Staff are unchanged: all three visits, both procedure rows of closed visits and the open
    // one, every note.
    assert_eq!(
        count(
            Scope::tenant(alpha),
            "select count(*) from aarogyam.encounters"
        )
        .await,
        3
    );
    assert_eq!(
        count(
            Scope::tenant(alpha),
            "select count(*) from aarogyam.procedures"
        )
        .await,
        3
    );
    assert_eq!(
        count(
            Scope::tenant(alpha),
            "select count(*) from aarogyam.recalls"
        )
        .await,
        2
    );
    assert_eq!(
        count(
            Scope::tenant(alpha),
            "select count(*) from aarogyam.clinical_notes"
        )
        .await,
        6
    );

    // The advice: the Plan of the signed note, for the owner of a closed visit only.
    assert_eq!(
        advice(patient_scope(alpha, account), &closed)
            .await
            .as_deref(),
        Some("Rinse with warm salt water")
    );
    assert_eq!(advice(patient_scope(alpha, account), &open).await, None);
    assert_eq!(advice(patient_scope(alpha, stranger), &closed).await, None);
    assert_eq!(advice(patient_scope(beta, account), &closed).await, None);
    assert_eq!(advice(Scope::tenant(alpha), &closed).await, None);

    // Writes are refused by row-level security, never silently dropped.
    let writes = [
        format!(
            "insert into aarogyam.encounters (number, patient_id, clinician_id) values ('V-999999', '{mine_id}', '{ALPHA_OWNER}')"
        ),
        "update aarogyam.encounters set status = 'open', ended_at = null".to_owned(),
        format!(
            "insert into aarogyam.procedures (patient_id, encounter_id, name) values ('{mine_id}', '{closed}', 'Free filling')"
        ),
        "update aarogyam.procedures set name = 'Free filling'".to_owned(),
        format!(
            "insert into aarogyam.recalls (patient_id, due_on) values ('{mine_id}', '2099-02-02')"
        ),
        "update aarogyam.recalls set status = 'dismissed'".to_owned(),
    ];
    for query in writes {
        let refused = db
            .scoped(&patient_scope(alpha, account), async |tx| {
                sqlx::query(sqlx::AssertSqlSafe(query.clone()))
                    .execute(tx.conn())
                    .await
                    .map_err(DbError::from)
            })
            .await;
        let message = format!("{:?}", refused.unwrap_err());
        assert!(
            // A done procedure is also final by its own trigger, which fires first.
            message.contains("row-level security") || message.contains("row is final"),
            "{query} failed for another reason: {message}"
        );
    }
    app.finish().await;
}
