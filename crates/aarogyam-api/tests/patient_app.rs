//! The patient app on a real database: linking by a clinic-issued code or a match the clinic
//! confirms (never by phone or name), a patient seeing only their own records at clinics that
//! linked them (other patients and other clinics are invisible, in the API and in a direct
//! query under row-level security), booking and cancelling through the online booking rules,
//! shared files, and the access record.
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
use time::{Duration, OffsetDateTime, UtcOffset};
use uuid::{Uuid, uuid};

const APP: &str = "app.localtest.me";
const RAVI: Uuid = uuid!("e0000000-0000-4000-8000-000000000001");
const MEERA: Uuid = uuid!("e0000000-0000-4000-8000-000000000002");

const PATIENT_ACCOUNT: ActorKind = match ActorKind::new("patient_account") {
    Ok(kind) => kind,
    Err(_) => panic!("invalid actor kind"),
};

fn id_of(body: &Value) -> String {
    body["id"].as_str().unwrap().to_owned()
}

fn patient_token(app: &TestApp, who: Uuid, email: &str) -> String {
    app.tokens.mint_with_email(who, Some(email)).unwrap()
}

async fn created(app: &TestApp, host: &str, token: &str, path: &str, body: Value) -> Value {
    let (status, value) = app
        .send(Method::POST, host, path, Some(token), Some(body))
        .await;
    assert!(status.is_success(), "POST {path}: {status} {value}");
    value
}

async fn register(
    app: &TestApp,
    host: &str,
    token: &str,
    name: &str,
    email: Option<&str>,
) -> String {
    let mut body =
        json!({ "full_name": name, "sex": "male", "age_years": 40, "phone": "+919876543210" });
    if let Some(email) = email {
        body["email"] = json!(email);
    }
    id_of(&created(app, host, token, "/api/v1/patients", body).await)
}

async fn get(app: &TestApp, host: &str, token: &str, path: &str) -> (StatusCode, Value) {
    app.send(Method::GET, host, path, Some(token), None).await
}

/// Issues a link code for a patient through "Invite to patient app".
async fn invite(app: &TestApp, host: &str, token: &str, patient: &str) -> String {
    let path = format!("/api/v1/patients/{patient}/app-invitations");
    let (status, body) = app.send(Method::POST, host, &path, Some(token), None).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["emailed"], true);
    body["code"].as_str().unwrap().to_owned()
}

async fn redeem(app: &TestApp, token: &str, code: &str) -> (StatusCode, Value) {
    app.send(
        Method::POST,
        APP,
        "/api/v1/me/patient/links",
        Some(token),
        Some(json!({ "code": code })),
    )
    .await
}

async fn issued_prescription(app: &TestApp, token: &str, patient: &str) -> String {
    let path = format!("/api/v1/patients/{patient}/prescriptions");
    let items = json!([{ "drug_name": "Ibuprofen", "dose": "1 tablet", "frequency": "1-1-1" }]);
    let draft = created(app, ALPHA, token, &path, json!({ "items": items })).await;
    let id = id_of(&draft);
    created(
        app,
        ALPHA,
        token,
        &format!("/api/v1/prescriptions/{id}/issue"),
        json!({}),
    )
    .await;
    id
}

async fn issued_bill(app: &TestApp, token: &str, patient: &str) -> String {
    let items = json!([{ "description": "Scaling", "unit_price_paise": 100_000 }]);
    let bill = created(
        app,
        ALPHA,
        token,
        "/api/v1/invoices",
        json!({ "patient_id": patient, "items": items }),
    )
    .await;
    let id = id_of(&bill);
    created(
        app,
        ALPHA,
        token,
        &format!("/api/v1/invoices/{id}/issue"),
        json!({}),
    )
    .await;
    id
}

async fn doctor_with_hours(app: &TestApp, token: &str) -> String {
    let doctor = id_of(
        &created(
            app,
            ALPHA,
            token,
            "/api/v1/practitioners",
            json!({ "display_name": "Dr Asha" }),
        )
        .await,
    );
    let shifts: Vec<Value> = (1..=7)
        .map(|weekday| json!({ "weekday": weekday, "starts": "00:00", "ends": "23:45" }))
        .collect();
    let (status, body) = app
        .send(
            Method::PUT,
            ALPHA,
            &format!("/api/v1/practitioners/{doctor}/working-hours"),
            Some(token),
            Some(json!({ "shifts": shifts })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    doctor
}

fn ist(at: OffsetDateTime) -> String {
    at.to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap()
}

async fn book_by_staff(
    app: &TestApp,
    token: &str,
    patient: &str,
    doctor: &str,
    starts: OffsetDateTime,
) -> String {
    let body = json!({
        "patient_id": patient, "practitioner_id": doctor,
        "starts_at": ist(starts), "ends_at": ist(starts + Duration::minutes(15))
    });
    let booked = created(app, ALPHA, token, "/api/v1/appointments", body).await;
    booked["id"]
        .as_str()
        .or_else(|| booked["appointment"]["id"].as_str())
        .unwrap()
        .to_owned()
}

async fn upload(app: &TestApp, token: &str, patient: &str, share: bool) -> String {
    let mut jpeg = vec![0xFF_u8, 0xD8, 0xFF, 0xE0];
    jpeg.extend_from_slice(&[7_u8; 256]);
    let (status, file) = app
        .upload(
            ALPHA,
            token,
            patient,
            &jpeg,
            &[("kind", "xray"), ("label", "OPG")],
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{file}");
    let id = id_of(&file);
    if share {
        let (status, body) = app
            .send(
                Method::PUT,
                ALPHA,
                &format!("/api/v1/attachments/{id}/sharing"),
                Some(token),
                Some(json!({ "shared_with_patient": true })),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    id
}

fn ids(list: &Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_clinic_code_links_one_record_and_the_patient_sees_only_it() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let ravi = patient_token(&app, RAVI, "ravi@example.test");
    let meera = patient_token(&app, MEERA, "meera@example.test");

    // Ravi's record and another patient with the same phone and name.
    let mine = register(&app, ALPHA, &owner, "Ravi Kumar", Some("ravi@example.test")).await;
    let other = register(
        &app,
        ALPHA,
        &owner,
        "Ravi Kumar",
        Some("other@example.test"),
    )
    .await;
    let doctor = doctor_with_hours(&app, &owner).await;
    let tomorrow = OffsetDateTime::now_utc() + Duration::days(1);
    let my_visit = book_by_staff(&app, &owner, &mine, &doctor, tomorrow).await;
    let other_visit =
        book_by_staff(&app, &owner, &other, &doctor, tomorrow + Duration::hours(1)).await;
    let my_rx = issued_prescription(&app, &owner, &mine).await;
    issued_prescription(&app, &owner, &other).await;
    let path = format!("/api/v1/patients/{mine}/prescriptions");
    let draft_items =
        json!([{ "drug_name": "Paracetamol", "dose": "1 tablet", "frequency": "1-0-1" }]);
    let draft = id_of(&created(&app, ALPHA, &owner, &path, json!({ "items": draft_items })).await);
    let my_bill = issued_bill(&app, &owner, &mine).await;
    issued_bill(&app, &owner, &other).await;
    let shared = upload(&app, &owner, &mine, true).await;
    let private = upload(&app, &owner, &mine, false).await;
    let others_file = upload(&app, &owner, &other, true).await;

    // Signed in, not linked: an account and nothing else; never matched by phone or name.
    let (status, me) = get(&app, APP, &ravi, "/api/v1/me/patient").await;
    assert_eq!(status, StatusCode::OK, "{me}");
    assert_eq!(me["email"], "ravi@example.test");
    assert_eq!(me["clinics"], json!([]));
    let (_, nothing) = get(&app, APP, &ravi, "/api/v1/me/patient/appointments").await;
    assert_eq!(nothing, json!({ "upcoming": [], "past": [] }));
    // Patient routes live on the app host only; clinic hosts and the console answer 404.
    let (status, _) = get(&app, ALPHA, &ravi, "/api/v1/me/patient").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // A token without a verified email can't make an account.
    let (status, refused) = get(&app, APP, &app.token(STRANGER), "/api/v1/me/patient").await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{refused}");

    // The code the clinic issued links exactly that record, once.
    let code = invite(&app, ALPHA, &owner, &mine).await;
    let (status, bad) = redeem(&app, &ravi, "not a code").await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    let (status, linked) = redeem(&app, &ravi, &code.to_lowercase().replace('-', " ")).await;
    assert_eq!(status, StatusCode::CREATED, "{linked}");
    assert_eq!(linked["outcome"], "linked");
    assert_eq!(
        linked["clinic_id"],
        app.clinic_id("alpha").await.to_string()
    );
    let (status, _) = redeem(&app, &meera, &code).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "a used code is gone");

    let (_, me) = get(&app, APP, &ravi, "/api/v1/me/patient").await;
    assert_eq!(me["clinics"].as_array().unwrap().len(), 1);
    assert_eq!(me["clinics"][0]["slug"], "alpha");
    assert_eq!(me["clinics"][0]["host"], "alpha.localtest.me");
    assert!(
        me["clinics"][0]["patient_number"]
            .as_str()
            .unwrap()
            .starts_with("AD-")
    );

    let (status, visits) = get(&app, APP, &ravi, "/api/v1/me/patient/appointments").await;
    assert_eq!(status, StatusCode::OK, "{visits}");
    assert_eq!(ids(&visits["upcoming"]), [my_visit.as_str()]);
    assert_eq!(visits["upcoming"][0]["doctor_name"], "Dr Asha");
    assert!(
        visits["upcoming"][0]["starts_at"]
            .as_str()
            .unwrap()
            .ends_with("+05:30")
    );

    let (_, rx) = get(&app, APP, &ravi, "/api/v1/me/patient/prescriptions").await;
    assert_eq!(
        ids(&rx["items"]),
        [my_rx],
        "issued only, never the draft {draft}"
    );
    assert_eq!(rx["items"][0]["items"][0]["drug_name"], "IBUPROFEN");
    let verify = rx["items"][0]["verify_url"].as_str().unwrap();
    assert!(
        verify.starts_with("https://alpha.localtest.me/verify/prescriptions/"),
        "{verify}"
    );

    let (_, bills) = get(&app, APP, &ravi, "/api/v1/me/patient/bills").await;
    assert_eq!(ids(&bills["items"]), [my_bill]);
    assert_eq!(bills["items"][0]["balance_paise"], 100_000);
    assert_eq!(bills["balance_paise"], 100_000);
    assert_eq!(bills["items"][0]["items"][0]["description"], "Scaling");

    let (_, files) = get(&app, APP, &ravi, "/api/v1/me/patient/files").await;
    assert_eq!(
        ids(&files["items"]),
        [shared.as_str()],
        "shared files only, not {private}"
    );

    let (status, home) = get(&app, APP, &ravi, "/api/v1/me/patient/home").await;
    assert_eq!(status, StatusCode::OK, "{home}");
    assert_eq!(home["next_appointment"]["id"], my_visit);
    assert_eq!(home["balance_paise"], 100_000);
    assert_eq!(home["clinics"][0]["prescriptions"], 1);

    // The shared file streams from the clinic's host; the private one and others' don't.
    let content = |id: &str| format!("/api/v1/me/patient/files/{id}/content");
    let (status, _) = get(&app, ALPHA, &ravi, &content(&shared)).await;
    assert_eq!(status, StatusCode::OK);
    for id in [&private, &others_file] {
        let (status, _) = get(&app, ALPHA, &ravi, &content(id)).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    // Another clinic, and another patient account, get nothing.
    let (status, _) = get(&app, BETA, &ravi, &content(&shared)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "Beta never linked Ravi");
    let (status, _) = get(&app, ALPHA, &meera, &content(&shared)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "Meera isn't linked at Alpha");
    let (_, theirs) = get(&app, APP, &meera, "/api/v1/me/patient/appointments").await;
    assert_eq!(theirs, json!({ "upcoming": [], "past": [] }));

    // Another patient's appointment can't be cancelled, here or at another clinic.
    let cancel = |id: &str| format!("/api/v1/me/patient/appointments/{id}/cancel");
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &cancel(&other_visit),
            Some(&ravi),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::POST, BETA, &cancel(&my_visit), Some(&ravi), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Every read is in the access record, as the patient, about Ravi's record only.
    let (logged, about_other): (i64, i64) = sqlx::query_as(
        "select count(*) filter (where patient_id = $1::uuid), count(*) filter (where patient_id = $2::uuid)
         from audit.access_log where actor_kind = 'patient' and purpose = 'patient_self'",
    )
    .bind(&mine)
    .bind(&other)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert!(logged >= 6, "{logged} patient reads recorded");
    assert_eq!(about_other, 0);

    // The patient ends the link: the clinic's records leave the app.
    let link = me["clinics"][0]["link_id"].as_str().unwrap();
    let path = format!("/api/v1/me/patient/links/{link}/revoke");
    let (status, _) = app.send(Method::POST, APP, &path, Some(&meera), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "not Meera's link");
    let (status, _) = app.send(Method::POST, APP, &path, Some(&ravi), None).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_, gone) = get(&app, APP, &ravi, "/api/v1/me/patient/prescriptions").await;
    assert_eq!(gone["items"], json!([]));
    let (status, _) = get(&app, ALPHA, &ravi, &content(&shared)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn row_level_security_limits_a_patient_account_in_a_direct_query() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let ravi = patient_token(&app, RAVI, "ravi@example.test");
    let mine = register(&app, ALPHA, &owner, "Ravi Kumar", Some("ravi@example.test")).await;
    let other = register(&app, ALPHA, &owner, "Asha Rao", None).await;
    issued_prescription(&app, &owner, &mine).await;
    issued_prescription(&app, &owner, &other).await;
    let path = format!("/api/v1/patients/{mine}/prescriptions");
    let items = json!([{ "drug_name": "Paracetamol", "dose": "1 tablet", "frequency": "1-0-1" }]);
    created(&app, ALPHA, &owner, &path, json!({ "items": items })).await;
    created(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{mine}/visits"),
        json!({ "chief_complaint": "Pain" }),
    )
    .await;
    upload(&app, &owner, &mine, true).await;
    upload(&app, &owner, &mine, false).await;
    let code = invite(&app, ALPHA, &owner, &mine).await;
    assert_eq!(redeem(&app, &ravi, &code).await.0, StatusCode::CREATED);
    let account: Uuid =
        sqlx::query_scalar("select id from aarogyam.patient_accounts where auth_uid = $1")
            .bind(RAVI)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let stranger = Uuid::now_v7();
    let (alpha, beta) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();
    let count = async |clinic: Uuid, who: Uuid, query: &str| -> i64 {
        let scope = Scope::tenant(clinic)
            .with_user(who)
            .with_actor_kind(PATIENT_ACCOUNT);
        db.scoped(&scope, async |tx| {
            sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(query.to_owned()))
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap()
    };
    let cases = [
        ("select count(*) from aarogyam.patients", 1),
        ("select count(*) from aarogyam.prescriptions", 1),
        ("select count(*) from aarogyam.prescription_items", 1),
        ("select count(*) from aarogyam.attachments", 1),
        ("select count(*) from aarogyam.encounters", 0),
        ("select count(*) from aarogyam.clinical_notes", 0),
        ("select count(*) from aarogyam.patient_link_codes", 0),
        ("select count(*) from aarogyam.memberships", 0),
        ("select count(*) from audit.audit_events", 0),
        ("select count(*) from aarogyam.patient_links", 1),
    ];
    for (query, expected) in cases {
        assert_eq!(
            count(alpha, account, query).await,
            expected,
            "linked: {query}"
        );
        assert_eq!(
            count(alpha, stranger, query).await,
            0,
            "unlinked account: {query}"
        );
        assert_eq!(
            count(beta, account, query).await,
            0,
            "other clinic: {query}"
        );
    }
    // Staff still see the whole clinic through the same tables.
    let staff = db
        .scoped(&Scope::tenant(alpha), async |tx| {
            sqlx::query_scalar::<_, i64>("select count(*) from aarogyam.patients")
                .fetch_one(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await
        .unwrap();
    assert_eq!(staff, 2);
    // A patient account can't write another patient's access entry or change clinic settings.
    let scope = Scope::tenant(alpha)
        .with_user(account)
        .with_actor_kind(PATIENT_ACCOUNT);
    let refused = db
        .scoped(&scope, async |tx| {
            sqlx::query(
                "insert into audit.access_log (actor_user_id, actor_kind, patient_id, resource, action, purpose)
                 values ($1, 'patient', $2::uuid, 'chart', 'view', 'patient_self')",
            )
            .bind(account)
            .bind(&other)
            .execute(tx.conn())
            .await
            .map_err(DbError::from)
        })
        .await;
    assert!(refused.is_err());
    let changed = db
        .scoped(&scope, async |tx| {
            sqlx::query("update aarogyam.organizations set name = 'Mine now'")
                .execute(tx.conn())
                .await
                .map_err(DbError::from)
        })
        .await;
    assert!(changed.is_err() || changed.unwrap().rows_affected() == 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_match_the_patient_asks_for_waits_for_the_clinic() {
    let app = TestApp::start().await;
    let alpha_owner = app.token(ALPHA_OWNER);
    let beta_owner = app.token(BETA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let ravi = patient_token(&app, RAVI, "ravi@example.test");
    let at_beta = register(
        &app,
        BETA,
        &beta_owner,
        "Ravi Kumar",
        Some("ravi@example.test"),
    )
    .await;
    // Same name and phone, other email: never matched.
    register(
        &app,
        ALPHA,
        &alpha_owner,
        "Ravi Kumar",
        Some("someone@example.test"),
    )
    .await;

    let ask = async |clinic: &str| {
        app.send(
            Method::POST,
            APP,
            "/api/v1/me/patient/link-requests",
            Some(&ravi),
            Some(json!({ "clinic": clinic })),
        )
        .await
        .0
    };
    for clinic in ["alpha", "nowhere", "beta"] {
        assert_eq!(
            ask(clinic).await,
            StatusCode::ACCEPTED,
            "the same answer for {clinic}"
        );
    }
    let (pending,): (i64,) =
        sqlx::query_as("select count(*) from aarogyam.patient_links where status = 'pending'")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(pending, 1, "only Beta's record has Ravi's email");

    // Nothing is visible until the clinic confirms.
    let (_, me) = get(&app, APP, &ravi, "/api/v1/me/patient").await;
    assert_eq!(me["clinics"], json!([]));
    let access_path = format!("/api/v1/patients/{at_beta}/app-access");
    let (status, access) = get(&app, BETA, &beta_owner, &access_path).await;
    assert_eq!(status, StatusCode::OK, "{access}");
    assert_eq!(access["links"][0]["status"], "pending");
    assert_eq!(access["links"][0]["account_email"], "ravi@example.test");
    let link = access["links"][0]["id"].as_str().unwrap().to_owned();
    // Another clinic can't see or decide it.
    let (status, _) = get(&app, ALPHA, &alpha_owner, &access_path).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let confirm = format!("/api/v1/patient-links/{link}/confirm");
    let (status, _) = app
        .send(Method::POST, ALPHA, &confirm, Some(&alpha_owner), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::POST, ALPHA, &confirm, Some(&assistant), None)
        .await;
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "deciding needs patients.write"
    );

    let (status, decided) = app
        .send(Method::POST, BETA, &confirm, Some(&beta_owner), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{decided}");
    assert_eq!(decided["status"], "active");
    let (_, me) = get(&app, APP, &ravi, "/api/v1/me/patient").await;
    assert_eq!(me["clinics"][0]["slug"], "beta");

    // A second link to the same record can't be made, and a code for it is a repeat.
    let code = invite(&app, BETA, &beta_owner, &at_beta).await;
    let (status, again) = redeem(&app, &ravi, &code).await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["outcome"], "already_linked");
    let meera = patient_token(&app, MEERA, "meera@example.test");
    let code = invite(&app, BETA, &beta_owner, &at_beta).await;
    let (status, taken) = redeem(&app, &meera, &code).await;
    assert_eq!(status, StatusCode::CONFLICT, "{taken}");

    // The clinic revokes it.
    let revoke = format!("/api/v1/patient-links/{link}/revoke");
    let (status, _) = app
        .send(Method::POST, BETA, &revoke, Some(&beta_owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, me) = get(&app, APP, &ravi, "/api/v1/me/patient").await;
    assert_eq!(me["clinics"], json!([]));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn invitations_need_an_email_and_patients_write_and_stay_in_the_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let beta = app.token(BETA_OWNER);
    let with_email = register(&app, ALPHA, &owner, "Ravi Kumar", Some("ravi@example.test")).await;
    let without = register(&app, ALPHA, &owner, "Asha Rao", None).await;
    let path = |id: &str| format!("/api/v1/patients/{id}/app-invitations");

    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &path(&with_email),
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(Method::POST, BETA, &path(&with_email), Some(&beta), None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, refused) = app
        .send(Method::POST, ALPHA, &path(&without), Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");

    let first = invite(&app, ALPHA, &owner, &with_email).await;
    let second = invite(&app, ALPHA, &owner, &with_email).await;
    assert_ne!(first, second);
    // The email carries the newest code; the code is kept only until it is sent.
    let (to, secret, payload): (String, String, Value) = sqlx::query_as(
        "select recipient, secret, payload from aarogyam.outbox_events
         where event_key = 'patient_app.invited' order by created_at desc limit 1",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(
        (to.as_str(), secret.as_str()),
        ("ravi@example.test", second.as_str())
    );
    assert_eq!(payload["clinic_name"], "Alpha Dental");
    assert!(payload.get("full_name").is_none());
    let (stored,): (i64,) = sqlx::query_as(
        "select count(*) from aarogyam.patient_link_codes where code_hash = $1 or code_hash = $2",
    )
    .bind(&first)
    .bind(&second)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(stored, 0, "codes are stored only as hashes");
    // The replaced code no longer works.
    let ravi = patient_token(&app, RAVI, "ravi@example.test");
    assert_eq!(redeem(&app, &ravi, &first).await.0, StatusCode::NOT_FOUND);
    assert_eq!(redeem(&app, &ravi, &second).await.0, StatusCode::CREATED);

    // Sharing a file: clinical.write, inside the clinic.
    let file = upload(&app, &owner, &with_email, false).await;
    let sharing = format!("/api/v1/attachments/{file}/sharing");
    let body = json!({ "shared_with_patient": true });
    let (status, _) = app
        .send(
            Method::PUT,
            ALPHA,
            &sharing,
            Some(&assistant),
            Some(body.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .send(Method::PUT, BETA, &sharing, Some(&beta), Some(body.clone()))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = app
        .send(Method::PUT, ALPHA, &sharing, Some(&owner), Some(body))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, list) = get(
        &app,
        ALPHA,
        &owner,
        &format!("/api/v1/patients/{with_email}/attachments"),
    )
    .await;
    assert_eq!(list["items"][0]["shared_with_patient"], true);
    let (_, files) = get(&app, APP, &ravi, "/api/v1/me/patient/files").await;
    assert_eq!(ids(&files["items"]), [file]);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn patients_book_and_cancel_through_the_online_booking_rules() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let ravi = patient_token(&app, RAVI, "ravi@example.test");
    let mine = register(&app, ALPHA, &owner, "Ravi Kumar", Some("ravi@example.test")).await;
    let doctor = doctor_with_hours(&app, &owner).await;
    let code = invite(&app, ALPHA, &owner, &mine).await;
    assert_eq!(redeem(&app, &ravi, &code).await.0, StatusCode::CREATED);

    let tomorrow = (OffsetDateTime::now_utc() + Duration::days(1))
        .to_offset(UtcOffset::from_hms(5, 30, 0).unwrap())
        .date();
    let (status, free) = get(
        &app,
        ALPHA,
        &ravi,
        &format!("/api/v1/public/availability?date={tomorrow}&practitioner_id={doctor}"),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{free}");
    let slot = free["slots"][4].as_str().unwrap().to_owned();
    let booking = json!({ "practitioner_id": doctor, "starts_at": slot, "reason": "Check-up" });

    // Only at a clinic that linked the patient, and only offered slots.
    let (status, _) = app
        .send(
            Method::POST,
            BETA,
            "/api/v1/me/patient/bookings",
            Some(&ravi),
            Some(booking.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let mut odd = booking.clone();
    odd["starts_at"] = json!(format!("{tomorrow}T03:07:00+05:30"));
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/me/patient/bookings",
            Some(&ravi),
            Some(odd),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, booked) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/me/patient/bookings",
            Some(&ravi),
            Some(booking.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{booked}");
    assert_eq!(booked["status"], "requested");
    assert_eq!(booked["can_cancel"], true);
    let id = id_of(&booked);
    let (patient_id, source): (Uuid, String) =
        sqlx::query_as("select patient_id, source from aarogyam.appointments where id = $1::uuid")
            .bind(&id)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(
        (patient_id.to_string(), source.as_str()),
        (mine.clone(), "app")
    );
    // The slot is taken now.
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/me/patient/bookings",
            Some(&ravi),
            Some(booking),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let cancel = format!("/api/v1/me/patient/appointments/{id}/cancel");
    let (status, cancelled) = app
        .send(Method::POST, ALPHA, &cancel, Some(&ravi), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{cancelled}");
    assert_eq!(cancelled["status"], "cancelled");
    let (status, _) = app
        .send(Method::POST, ALPHA, &cancel, Some(&ravi), None)
        .await;
    assert_eq!(status, StatusCode::OK, "repeating is fine");
    let (_, visits) = get(&app, APP, &ravi, "/api/v1/me/patient/appointments").await;
    assert_eq!(visits["upcoming"], json!([]));
    assert_eq!(visits["past"][0]["status"], "cancelled");

    // Inside the clinic's notice (an hour by default) the app refuses.
    let soon = book_by_staff(
        &app,
        &owner,
        &mine,
        &doctor,
        OffsetDateTime::now_utc() + Duration::minutes(30),
    )
    .await;
    let (status, refused) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("/api/v1/me/patient/appointments/{soon}/cancel"),
            Some(&ravi),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{refused}");
    app.finish().await;
}
