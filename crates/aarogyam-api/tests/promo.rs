//! Offers and referral codes on a real database (docs/plans/visit-story-v2-offers-design.md,
//! Part 2): giving codes at the end of a visit, holding them on drafts and collecting the shown
//! amount, issue, void and re-bill, the referral rules and rewards, the visit check, the
//! stale-hold sweep, erasure, RLS, and that nothing crosses clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test follows one flow from start to finish"
)]

mod support;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use uuid::Uuid;

async fn call(
    app: &TestApp,
    host: &str,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

async fn register(app: &TestApp, host: &str, token: &str, body: Value) -> String {
    let (status, made) = call(
        app,
        host,
        token,
        Method::POST,
        "/api/v1/patients",
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    made["id"].as_str().unwrap().to_owned()
}

async fn person(app: &TestApp, host: &str, token: &str, name: &str, phone: &str) -> String {
    register(
        app,
        host,
        token,
        json!({ "full_name": name, "sex": "female", "age_years": 34, "phone": phone }),
    )
    .await
}

async fn closed_visit(app: &TestApp, host: &str, token: &str, patient: &str) -> String {
    let (status, visit) = call(
        app,
        host,
        token,
        Method::POST,
        &format!("/api/v1/patients/{patient}/visits"),
        Some(json!({ "chief_complaint": "Check-up" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{visit}");
    let visit = visit["id"].as_str().unwrap().to_owned();
    let (status, body) = call(
        app,
        host,
        token,
        Method::POST,
        &format!("/api/v1/visits/{visit}/close"),
        Some(json!({})),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    visit
}

/// Gives the visit's offer and referral code; returns (status, body).
async fn give(
    app: &TestApp,
    host: &str,
    token: &str,
    visit: &str,
    body: Value,
) -> (StatusCode, Value) {
    call(
        app,
        host,
        token,
        Method::POST,
        &format!("/api/v1/visits/{visit}/offers"),
        Some(body),
    )
    .await
}

async fn draft(app: &TestApp, token: &str, patient: &str, extra: Value) -> Value {
    let mut body = json!({ "patient_id": patient,
        "items": [{ "description": "Crown", "unit_price_paise": 300_000 },
                  { "description": "X-ray", "unit_price_paise": 70_001 }] });
    for (key, value) in extra.as_object().unwrap() {
        body[key] = value.clone();
    }
    let (status, bill) = call(
        app,
        ALPHA,
        token,
        Method::POST,
        "/api/v1/invoices",
        Some(body),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{bill}");
    bill
}

async fn apply(app: &TestApp, token: &str, bill: &Value, code: &str) -> (StatusCode, Value) {
    let path = format!("/api/v1/invoices/{}/promo", bill["id"].as_str().unwrap());
    call(
        app,
        ALPHA,
        token,
        Method::POST,
        &path,
        Some(json!({ "code": code })),
    )
    .await
}

fn code(err: &Value) -> &str {
    err["error"]["code"].as_str().unwrap_or("")
}

async fn scalar_i64(app: &TestApp, sql: &str, id: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
        .bind(Uuid::parse_str(id).unwrap())
        .fetch_one(&app.owner)
        .await
        .unwrap()
}

async fn used(app: &TestApp, code_id: &str) -> i64 {
    scalar_i64(
        app,
        "select used_count::bigint from aarogyam.promo_codes where id = $1",
        code_id,
    )
    .await
}

async fn exec(app: &TestApp, sql: &str) {
    sqlx::raw_sql(sqlx::AssertSqlSafe(sql))
        .execute(&app.owner)
        .await
        .unwrap();
}

async fn put_settings(app: &TestApp, token: &str, body: Value) -> (StatusCode, Value) {
    call(
        app,
        ALPHA,
        token,
        Method::PUT,
        "/api/v1/settings/offers",
        Some(body),
    )
    .await
}

async fn pay(
    app: &TestApp,
    token: &str,
    patient: &str,
    bill: &str,
    paise: i64,
) -> (StatusCode, Value) {
    app.send_with(
        Method::POST,
        ALPHA,
        "/api/v1/payments",
        Some(token),
        Some(
            json!({ "patient_id": patient, "method": "cash", "amount_paise": paise,
                     "allocations": [{ "invoice_id": bill, "amount_paise": paise }] }),
        ),
        &[("idempotency-key", &Uuid::new_v4().to_string())],
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn offers_are_given_once_within_caps_and_never_cross_clinics() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let priya = person(&app, ALPHA, &owner, "Priya Sharma", "9876500001").await;
    let visit = closed_visit(&app, ALPHA, &owner, &priya).await;

    // Presets come back, bounded by the owner's caps.
    let (status, offers) = call(
        &app,
        ALPHA,
        &owner,
        Method::GET,
        &format!("/api/v1/visits/{visit}/offers"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{offers}");
    assert!(offers["patient_offer"].is_null());
    assert_eq!(offers["presets"]["offer_value"], 1000);

    let (status, made) = give(
        &app,
        ALPHA,
        &owner,
        &visit,
        json!({ "patient_offer": {}, "referral": true }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{made}");
    let offer = made["patient_offer"]["code"].as_str().unwrap().to_owned();
    assert!(offer.len() == 9 && offer.as_bytes()[4] == b'-', "{offer}");
    assert_eq!(made["patient_offer"]["max_discount_paise"], 500_000);
    assert_eq!(made["referral"]["purpose"], "referral");
    // Idempotent.
    let (status, again) = give(
        &app,
        ALPHA,
        &owner,
        &visit,
        json!({ "patient_offer": {}, "referral": true }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{again}");
    assert_eq!(again["patient_offer"]["code"], offer.as_str());

    // Over the caps; an open visit; a role without offers.give.
    let second = person(&app, ALPHA, &owner, "Ravi Kumar", "9876500002").await;
    let other_visit = closed_visit(&app, ALPHA, &owner, &second).await;
    let (status, body) = give(
        &app,
        ALPHA,
        &owner,
        &other_visit,
        json!({ "patient_offer": { "valid_days": 400 } }),
    )
    .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "over_cap"),
        "{body}"
    );
    let (status, _) = give(
        &app,
        ALPHA,
        &app.token(ALPHA_FRONT_DESK),
        &other_visit,
        json!({ "patient_offer": {} }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, open) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/patients/{second}/visits"),
        Some(json!({ "chief_complaint": "Pain" })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, body) = give(
        &app,
        ALPHA,
        &owner,
        open["id"].as_str().unwrap(),
        json!({ "patient_offer": {} }),
    )
    .await;
    assert_eq!((status, code(&body)), (StatusCode::CONFLICT, "visit_open"));

    // Settings: a by_role row without max_discount_paise is refused; a full one is kept.
    let (status, settings) = call(
        &app,
        ALPHA,
        &owner,
        Method::GET,
        "/api/v1/settings/offers",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let mut bad = settings.clone();
    bad["caps"]["by_role"] = json!([{ "role_id": Uuid::new_v4(), "max_percent_bps": 500,
        "max_fixed_paise": 10_000, "max_valid_days": 30 }]);
    assert_eq!(
        put_settings(&app, &owner, bad).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut unknown = settings.clone();
    unknown["colour"] = json!("red");
    assert_eq!(
        put_settings(&app, &owner, unknown).await.0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        put_settings(&app, &owner, settings.clone()).await.0,
        StatusCode::OK
    );
    assert_eq!(
        put_settings(&app, &app.token(ALPHA_ASSISTANT), settings)
            .await
            .0,
        StatusCode::FORBIDDEN
    );

    // Cross-clinic: Beta sees none of Alpha's visit, codes, patient or bills.
    let bill = draft(&app, &owner, &priya, json!({})).await;
    let bill_id = bill["id"].as_str().unwrap();
    let code_id = made["patient_offer"]["id"].as_str().unwrap();
    for (method, path, body) in [
        (Method::GET, format!("/api/v1/visits/{visit}/offers"), None),
        (
            Method::POST,
            format!("/api/v1/visits/{visit}/offers"),
            Some(json!({ "referral": true })),
        ),
        (
            Method::POST,
            format!("/api/v1/promo-codes/{code_id}/revoke"),
            Some(json!({ "reason": "staff" })),
        ),
        (
            Method::GET,
            format!("/api/v1/patients/{priya}/offers"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/invoices/{bill_id}/promo"),
            Some(json!({ "code": offer })),
        ),
        (
            Method::DELETE,
            format!("/api/v1/invoices/{bill_id}/promo"),
            None,
        ),
    ] {
        let (status, body) = call(&app, BETA, &beta, method, &path, body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}: {body}");
    }
    // A valid Alpha code on Beta's own bill is unknown there.
    let beta_patient = person(&app, BETA, &beta, "Bela Rao", "9876500003").await;
    let (status, beta_bill) = call(&app, BETA, &beta, Method::POST, "/api/v1/invoices",
        Some(json!({ "patient_id": beta_patient, "items": [{ "description": "Scaling", "unit_price_paise": 100_000 }] }))).await;
    assert_eq!(status, StatusCode::CREATED, "{beta_bill}");
    let (status, _) = call(
        &app,
        BETA,
        &beta,
        Method::POST,
        &format!(
            "/api/v1/invoices/{}/promo",
            beta_bill["id"].as_str().unwrap()
        ),
        Some(json!({ "code": offer })),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Beta's own settings are its own defaults.
    let (status, _) = call(
        &app,
        BETA,
        &beta,
        Method::GET,
        "/api/v1/settings/offers",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    // RLS: under Beta's scope the app role sees no Alpha rows; the change history masks the code.
    let beta_id = app.clinic_id("beta").await;
    let seen: i64 = app.api_db().scoped(&Scope::tenant(beta_id), async |tx| {
        sqlx::query_scalar("select (select count(*) from aarogyam.promo_codes) + (select count(*) from aarogyam.promo_redemptions)")
            .fetch_one(tx.conn()).await.map_err(DbError::from)
    }).await.unwrap();
    assert_eq!(seen, 0);
    let history: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events where table_name = 'aarogyam.promo_codes' and changes::text like '%' || $1 || '%'")
        .bind(offer.replace('-', "")).fetch_one(&app.owner).await.unwrap();
    assert_eq!(history, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_held_offer_is_collected_at_the_shown_amount_and_folds_in_at_issue() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let priya = person(&app, ALPHA, &owner, "Priya Sharma", "9876500001").await;
    let visit = closed_visit(&app, ALPHA, &owner, &priya).await;
    let (_, made) = give(&app, ALPHA, &owner, &visit, json!({ "patient_offer": {} })).await;
    let offer = made["patient_offer"]["code"]
        .as_str()
        .unwrap()
        .to_lowercase()
        .replace('-', " ");
    let code_id = made["patient_offer"]["id"].as_str().unwrap().to_owned();

    // The assistant (payments.collect only) applies the patient's own offer, typed loosely.
    let bill = draft(&app, &owner, &priya, json!({})).await;
    let bill_id = bill["id"].as_str().unwrap().to_owned();
    let (status, held) = apply(&app, &assistant, &bill, &offer).await;
    assert_eq!(status, StatusCode::OK, "{held}");
    assert_eq!(held["promo"]["status"], "held");
    assert!(held["promo"].get("code").is_none());
    // 10% of 3,700.01 = 370.00 (rounded), split 300.00 / 70.00 with the leftover paisa by remainder.
    assert_eq!(held["promo"]["discount_paise"], 37_000);
    let promo: i64 = held["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["promo_discount_paise"].as_i64().unwrap())
        .sum();
    assert_eq!(promo, 37_000);
    assert_eq!(held["total_paise"], 333_000);
    assert_eq!(used(&app, &code_id).await, 1);
    // N8: the bell's SQL total agrees.
    let sql_total = scalar_i64(
        &app,
        "select app.invoice_total_paise(i) from aarogyam.invoices i where i.id = $1",
        &bill_id,
    )
    .await;
    assert_eq!(sql_total, 333_000);

    // A PATCH of the manual discounts keeps the offer, recomputed on what is left.
    let (status, edited) = call(&app, ALPHA, &owner, Method::PATCH, &format!("/api/v1/invoices/{bill_id}"),
        Some(json!({ "items": [{ "description": "Crown", "unit_price_paise": 300_000, "discount_paise": 100_000 },
                               { "description": "X-ray", "unit_price_paise": 70_001 }] }))).await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["promo"]["discount_paise"], 27_000);
    let shown = edited["total_paise"].as_i64().unwrap();

    // B2: collect exactly what the desk shows; the draft is issued and the payment accepted.
    let (status, summary) = call(
        &app,
        ALPHA,
        &assistant,
        Method::GET,
        &format!("/api/v1/invoices/{bill_id}/collect-summary"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{summary}");
    assert_eq!(summary["total_paise"].as_i64().unwrap(), shown);
    let (status, paid) = pay(&app, &assistant, &priya, &bill_id, shown).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    let (_, issued) = call(
        &app,
        ALPHA,
        &owner,
        Method::GET,
        &format!("/api/v1/invoices/{bill_id}"),
        None,
    )
    .await;
    assert_eq!(issued["status"], "issued");
    assert_eq!(issued["total_paise"].as_i64().unwrap(), shown);
    assert_eq!(issued["promo"]["status"], "final");
    // N8: an issued line's discount is manual + promo, so gross − discount = taxable.
    for line in issued["items"].as_array().unwrap() {
        let gross = line["unit_price_paise"].as_i64().unwrap() * line["quantity"].as_i64().unwrap();
        assert_eq!(
            gross - line["discount_paise"].as_i64().unwrap(),
            line["taxable_paise"].as_i64().unwrap(),
            "{line}"
        );
    }
    assert_eq!(
        issued["items"][0]["discount_paise"].as_i64().unwrap(),
        100_000 + issued["items"][0]["promo_discount_paise"].as_i64().unwrap()
    );
    assert_eq!(used(&app, &code_id).await, 1);
    // Spent: a second use is refused.
    let again = draft(&app, &owner, &priya, json!({})).await;
    let (status, body) = apply(&app, &owner, &again, &offer).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_used"),
        "{body}"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn holds_move_revoke_and_remove_by_the_rules() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let priya = person(&app, ALPHA, &owner, "Priya Sharma", "9876500001").await;
    let visit = closed_visit(&app, ALPHA, &owner, &priya).await;
    let (_, made) = give(&app, ALPHA, &owner, &visit, json!({ "patient_offer": {} })).await;
    let offer = made["patient_offer"]["code"].as_str().unwrap().to_owned();
    let code_id = made["patient_offer"]["id"].as_str().unwrap().to_owned();

    let first = draft(&app, &owner, &priya, json!({})).await;
    let second = draft(&app, &owner, &priya, json!({})).await;
    assert_eq!(apply(&app, &owner, &first, &offer).await.0, StatusCode::OK);
    // R5: the assistant didn't apply it, so can't move it; billing.write can (N9).
    let (status, body) = apply(&app, &assistant, &second, &offer).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::FORBIDDEN, "hold_elsewhere"),
        "{body}"
    );
    let (status, moved) = apply(&app, &owner, &second, &offer).await;
    assert_eq!(status, StatusCode::OK, "{moved}");
    assert_eq!(used(&app, &code_id).await, 1);
    let (_, old) = call(
        &app,
        ALPHA,
        &owner,
        Method::GET,
        &format!("/api/v1/invoices/{}", first["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert!(old.get("promo").is_none(), "{old}");
    assert!(
        old["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|l| l["promo_discount_paise"] == 0)
    );
    // M9: the assistant can't remove the owner's hold.
    let remove = format!("/api/v1/invoices/{}/promo", second["id"].as_str().unwrap());
    let (status, body) = call(&app, ALPHA, &assistant, Method::DELETE, &remove, None).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::FORBIDDEN, "not_applier"),
        "{body}"
    );
    // Revoking a held code zeroes the draft's lines and gives the use back.
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/promo-codes/{code_id}/revoke"),
        Some(json!({ "reason": "undo" })),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(used(&app, &code_id).await, 0);
    let (_, after) = call(
        &app,
        ALPHA,
        &owner,
        Method::GET,
        &format!("/api/v1/invoices/{}", second["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert!(
        after.get("promo").is_none() && after["total_paise"] == 370_000,
        "{after}"
    );
    let (status, body) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/promo-codes/{code_id}/revoke"),
        Some(json!({ "reason": "undo" })),
    )
    .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "already_revoked")
    );
    let (status, body) = apply(&app, &owner, &second, &offer).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_revoked")
    );

    // A draft of only ₹0 lines takes no code.
    let visit2 = closed_visit(&app, ALPHA, &owner, &priya).await;
    let (_, made2) = give(&app, ALPHA, &owner, &visit2, json!({ "patient_offer": {} })).await;
    let offer2 = made2["patient_offer"]["code"].as_str().unwrap().to_owned();
    let (status, free) = call(&app, ALPHA, &owner, Method::POST, "/api/v1/invoices",
        Some(json!({ "patient_id": priya, "items": [{ "description": "Review", "unit_price_paise": 0 }] }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, body) = apply(&app, &owner, &free, &offer2).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_no_eligible_line")
    );
    // Remove gives the use back.
    assert_eq!(apply(&app, &owner, &first, &offer2).await.0, StatusCode::OK);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::DELETE,
        &format!("/api/v1/invoices/{}/promo", first["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        used(&app, made2["patient_offer"]["id"].as_str().unwrap()).await,
        0
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn referral_codes_are_for_new_unlinked_patients_and_mint_one_reward() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    // The assistant's role is capped at 5%; rewards and friends' discounts use the settings caps.
    let assistant_role: Uuid =
        sqlx::query_scalar("select id from aarogyam.roles where org_id = $1 and key = 'assistant'")
            .bind(clinic)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let (_, mut settings) = call(
        &app,
        ALPHA,
        &owner,
        Method::GET,
        "/api/v1/settings/offers",
        None,
    )
    .await;
    settings["caps"]["by_role"] = json!([{ "role_id": assistant_role, "max_percent_bps": 500,
        "max_fixed_paise": 10_000, "max_valid_days": 30, "max_discount_paise": 5_000 }]);
    settings["referral"]["reward"]["max_discount_paise"] = json!(15_000);
    assert_eq!(
        put_settings(&app, &owner, settings.clone()).await.0,
        StatusCode::OK
    );

    let asha = person(&app, ALPHA, &owner, "Asha Patel", "9876500010").await;
    let visit = closed_visit(&app, ALPHA, &owner, &asha).await;
    let (_, made) = give(&app, ALPHA, &owner, &visit, json!({ "referral": true })).await;
    let referral = made["referral"]["code"].as_str().unwrap().to_owned();
    let referral_id = made["referral"]["id"].as_str().unwrap().to_owned();

    // Refused: the owner, a same-phone patient, family, and someone with an earlier visit.
    let own = draft(&app, &owner, &asha, json!({})).await;
    let (status, body) = apply(&app, &owner, &own, &referral).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_not_this_patient")
    );
    let same_phone = person(&app, ALPHA, &owner, "Kiran Patel", "9876500010").await;
    let bill = draft(&app, &owner, &same_phone, json!({})).await;
    assert_eq!(
        code(&apply(&app, &owner, &bill, &referral).await.1),
        "promo_not_new_patient"
    );
    let family = person(&app, ALPHA, &owner, "Ved Patel", "9876500011").await;
    exec(&app, &format!(
        "insert into aarogyam.patient_relations (org_id, patient_id, related_patient_id, relation)
         values ('{clinic}', '{asha}', '{family}', 'sibling'), ('{clinic}', '{family}', '{asha}', 'sibling')")).await;
    let bill = draft(&app, &owner, &family, json!({})).await;
    assert_eq!(
        code(&apply(&app, &owner, &bill, &referral).await.1),
        "promo_not_new_patient"
    );
    let returning = person(&app, ALPHA, &owner, "Old Timer", "9876500012").await;
    closed_visit(&app, ALPHA, &owner, &returning).await;
    let later = closed_visit(&app, ALPHA, &owner, &returning).await;
    let bill = draft(&app, &owner, &returning, json!({ "encounter_id": later })).await;
    assert_eq!(
        code(&apply(&app, &owner, &bill, &referral).await.1),
        "promo_not_new_patient"
    );

    // D4: the assistant may not apply a friend's referral code.
    let friend = person(&app, ALPHA, &owner, "Nisha Rao", "9876500020").await;
    let friend_bill = draft(&app, &owner, &friend, json!({})).await;
    let (status, body) = apply(&app, &assistant, &friend_bill, &referral).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_needs_billing_write")
    );
    // billing.write holds it; the friend's 10% is capped by the settings (₹2,000), not a role cap.
    let (status, held) = apply(&app, &owner, &friend_bill, &referral).await;
    assert_eq!(status, StatusCode::OK, "{held}");
    assert_eq!(held["promo"]["discount_paise"], 37_000);
    // F1: the assistant collects; the payment succeeds and a reward capped by the settings is minted.
    let friend_bill_id = friend_bill["id"].as_str().unwrap().to_owned();
    let shown = held["total_paise"].as_i64().unwrap();
    let (status, paid) = pay(&app, &assistant, &friend, &friend_bill_id, shown).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    let reward: (Uuid, Option<i64>, Option<String>) = sqlx::query_as(
        "select id, max_discount_paise, revoke_reason from aarogyam.promo_codes where source_code_id = $1")
        .bind(Uuid::parse_str(&referral_id).unwrap()).fetch_one(&app.owner).await.unwrap();
    assert_eq!(reward.1, Some(15_000));
    let referred: Option<Uuid> =
        sqlx::query_scalar("select referred_by_patient_id from aarogyam.patients where id = $1")
            .bind(Uuid::parse_str(&friend).unwrap())
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(referred, Some(Uuid::parse_str(&asha).unwrap()));
    // The owner sees the reward at their next Collect.
    let (_, mine) = call(
        &app,
        ALPHA,
        &assistant,
        Method::GET,
        &format!("/api/v1/patients/{asha}/offers"),
        None,
    )
    .await;
    assert_eq!(
        mine["codes"][0]["offer"]["purpose"], "referrer_reward",
        "{mine}"
    );

    // A second friend, billed without payment so it can be voided: void returns the use and
    // revokes the unredeemed reward; the re-bill holds the code again and re-issue restores the
    // same reward row instead of minting another.
    let second = person(&app, ALPHA, &owner, "Tara Rao", "9876500021").await;
    let bill = draft(&app, &owner, &second, json!({})).await;
    let bill_id = bill["id"].as_str().unwrap().to_owned();
    assert_eq!(
        apply(&app, &owner, &bill, &referral).await.0,
        StatusCode::OK
    );
    let (status, issued) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{bill_id}/issue"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    let total = issued["total_paise"].as_i64().unwrap();
    let uses_after_issue = used(&app, &referral_id).await;
    assert_eq!(uses_after_issue, 2);
    let rewards = "select count(*) from aarogyam.promo_codes where purpose = 'referrer_reward' and source_patient_id = $1";
    assert_eq!(scalar_i64(&app, rewards, &second).await, 1);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{bill_id}/void"),
        Some(json!({ "reason": "wrong price" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(used(&app, &referral_id).await, 1);
    let revoked = scalar_i64(&app, "select count(*) from aarogyam.promo_codes where source_patient_id = $1 and revoke_reason = 'source_void'", &second).await;
    assert_eq!(revoked, 1);
    // F2: copied lines with the folded discount, or an edited price keeping it, are refused.
    let folded: Vec<Value> = issued["items"].as_array().unwrap().iter().map(|l| json!({
        "description": l["description"], "unit_price_paise": l["unit_price_paise"], "discount_paise": l["discount_paise"] })).collect();
    let rebill = |items: Value| json!({ "patient_id": second, "replaces_invoice_id": bill_id, "items": items });
    let (status, body) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        "/api/v1/invoices",
        Some(rebill(json!(folded))),
    )
    .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::BAD_REQUEST, "rebill_discount_includes_offer"),
        "{body}"
    );
    let mut repriced = folded.clone();
    repriced[0]["unit_price_paise"] = json!(400_000);
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        "/api/v1/invoices",
        Some(rebill(json!(repriced))),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let manual: Vec<Value> = issued["items"].as_array().unwrap().iter().map(|l| json!({
        "description": l["description"], "unit_price_paise": l["unit_price_paise"],
        "discount_paise": l["discount_paise"].as_i64().unwrap() - l["promo_discount_paise"].as_i64().unwrap() })).collect();
    let (status, again) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        "/api/v1/invoices",
        Some(rebill(json!(manual))),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{again}");
    assert_eq!(again["promo"]["status"], "held");
    assert_eq!(again["total_paise"].as_i64().unwrap(), total);
    let again_id = again["id"].as_str().unwrap();
    let (status, _) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{again_id}/issue"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(scalar_i64(&app, rewards, &second).await, 1);
    let live = scalar_i64(&app, "select count(*) from aarogyam.promo_codes where source_patient_id = $1 and revoked_at is null", &second).await;
    assert_eq!(live, 1);

    // No reward under the minimum bill, or over the monthly cap.
    settings["referral"]["reward"]["max_per_month"] = json!(2);
    assert_eq!(put_settings(&app, &owner, settings).await.0, StatusCode::OK);
    let third = person(&app, ALPHA, &owner, "Uma Rao", "9876500022").await;
    let bill = draft(&app, &owner, &third, json!({})).await;
    assert_eq!(
        apply(&app, &owner, &bill, &referral).await.0,
        StatusCode::OK
    );
    call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{}/issue", bill["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert_eq!(scalar_i64(&app, rewards, &third).await, 0);
    let fourth = person(&app, ALPHA, &owner, "Vani Rao", "9876500023").await;
    let (_, small) = call(&app, ALPHA, &owner, Method::POST, "/api/v1/invoices",
        Some(json!({ "patient_id": fourth, "items": [{ "description": "Consult", "unit_price_paise": 30_000 }] }))).await;
    settings_reset(&app, &owner).await;
    assert_eq!(
        apply(&app, &owner, &small, &referral).await.0,
        StatusCode::OK
    );
    call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{}/issue", small["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert_eq!(scalar_i64(&app, rewards, &fourth).await, 0);

    // F1: a failing mint never fails the issue.
    exec(&app, "create function public.promo_test_fail() returns trigger language plpgsql as $$ begin raise exception 'mint fails'; end $$;
                create trigger fail_reward before insert on aarogyam.promo_codes for each row
                  when (new.purpose = 'referrer_reward') execute function public.promo_test_fail();").await;
    settings_reset(&app, &owner).await;
    let fifth = person(&app, ALPHA, &owner, "Wren Rao", "9876500024").await;
    let bill = draft(&app, &owner, &fifth, json!({})).await;
    assert_eq!(
        apply(&app, &owner, &bill, &referral).await.0,
        StatusCode::OK
    );
    let (status, issued) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{}/issue", bill["id"].as_str().unwrap()),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert_eq!(issued["promo"]["status"], "final");
    assert_eq!(scalar_i64(&app, rewards, &fifth).await, 0);
    app.finish().await;
}

/// Back to the default settings (rewards on, 3 a month).
async fn settings_reset(app: &TestApp, owner: &str) {
    exec(
        app,
        "update aarogyam.org_settings set billing = billing - 'offers'",
    )
    .await;
    let (status, _) = call(
        app,
        ALPHA,
        owner,
        Method::GET,
        "/api/v1/settings/offers",
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_targeted_offer_needs_the_visit_to_record_its_target() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let assistant = app.token(ALPHA_ASSISTANT);
    let priya = person(&app, ALPHA, &owner, "Priya Sharma", "9876500001").await;
    let visit = closed_visit(&app, ALPHA, &owner, &priya).await;
    let (_, made) = give(&app, ALPHA, &owner, &visit, json!({ "patient_offer": {} })).await;
    let offer = made["patient_offer"]["code"].as_str().unwrap().to_owned();
    let code_id = made["patient_offer"]["id"].as_str().unwrap().to_owned();
    exec(&app, &format!("update aarogyam.promo_codes set applies_to =
        '{{\"tooth\": 21, \"procedure_term\": \"crown\", \"words\": \"the crown on 21\"}}' where id = '{code_id}'")).await;

    let review = closed_visit(&app, ALPHA, &owner, &priya).await;
    let bill = draft(&app, &owner, &priya, json!({ "encounter_id": review })).await;
    let bill_id = bill["id"].as_str().unwrap().to_owned();
    let (status, body) = apply(&app, &owner, &bill, &offer).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_not_for_this_visit")
    );
    let (_, listed) = call(
        &app,
        ALPHA,
        &assistant,
        Method::GET,
        &format!("/api/v1/patients/{priya}/offers?invoice_id={bill_id}"),
        None,
    )
    .await;
    assert_eq!(listed["codes"][0]["eligible"], false, "{listed}");
    assert_eq!(listed["codes"][0]["reason"], "promo_not_for_this_visit");
    // payments.collect may not override; billing.write may.
    let path = format!("/api/v1/invoices/{bill_id}/promo");
    let (status, body) = call(
        &app,
        ALPHA,
        &assistant,
        Method::POST,
        &path,
        Some(json!({ "code": offer, "override": true })),
    )
    .await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_needs_billing_write")
    );
    let (status, held) = call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &path,
        Some(json!({ "code": offer, "override": true })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{held}");
    let overridden: bool =
        sqlx::query_scalar("select override from aarogyam.promo_redemptions where invoice_id = $1")
            .bind(Uuid::parse_str(&bill_id).unwrap())
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert!(overridden);
    call(&app, ALPHA, &owner, Method::DELETE, &path, None).await;

    // A chart entry crown on 21 in that visit passes (the chart-only path).
    let entry: Uuid = sqlx::query_scalar(
        "insert into aarogyam.specialty_records (org_id, encounter_id, patient_id, module, kind, schema_version, data)
         select e.org_id, e.id, e.patient_id, 'dental', 'tooth', 1, '{\"tooth\": 21, \"procedure\": \"crown\"}'
         from aarogyam.encounters e where e.id = $1 returning id")
        .bind(Uuid::parse_str(&review).unwrap()).fetch_one(&app.owner).await.unwrap();
    let (status, held) = apply(&app, &owner, &bill, &offer).await;
    assert_eq!(status, StatusCode::OK, "{held}");
    assert!(held["promo"]["discount_paise"].as_i64().unwrap() > 0);
    call(&app, ALPHA, &owner, Method::DELETE, &path, None).await;
    // F3: corrected to a filling, the crown no longer counts.
    exec(&app, &format!(
        "update aarogyam.specialty_records set status = 'superseded' where id = '{entry}';
         insert into aarogyam.specialty_records (org_id, encounter_id, patient_id, module, kind, schema_version, data, supersedes_id)
         select org_id, encounter_id, patient_id, module, kind, 1, '{{\"tooth\": 21, \"procedure\": \"filling\"}}', id
         from aarogyam.specialty_records where id = '{entry}'")).await;
    let (status, body) = apply(&app, &owner, &bill, &offer).await;
    assert_eq!(
        (status, code(&body)),
        (StatusCode::CONFLICT, "promo_not_for_this_visit"),
        "{body}"
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn two_holds_on_a_single_use_code_take_one() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, mut settings) = call(
        &app,
        ALPHA,
        &owner,
        Method::GET,
        "/api/v1/settings/offers",
        None,
    )
    .await;
    settings["referral"]["max_uses"] = json!(1);
    assert_eq!(put_settings(&app, &owner, settings).await.0, StatusCode::OK);
    let asha = person(&app, ALPHA, &owner, "Asha Patel", "9876500010").await;
    let visit = closed_visit(&app, ALPHA, &owner, &asha).await;
    let (_, made) = give(&app, ALPHA, &owner, &visit, json!({ "referral": true })).await;
    let referral = made["referral"]["code"].as_str().unwrap().to_owned();
    let a = person(&app, ALPHA, &owner, "Friend One", "9876500030").await;
    let b = person(&app, ALPHA, &owner, "Friend Two", "9876500031").await;
    let bill_a = draft(&app, &owner, &a, json!({})).await;
    let bill_b = draft(&app, &owner, &b, json!({})).await;
    let (one, two) = tokio::join!(
        apply(&app, &owner, &bill_a, &referral),
        apply(&app, &owner, &bill_b, &referral)
    );
    let mut codes = [one.0, two.0];
    codes.sort();
    assert_eq!(
        codes,
        [StatusCode::OK, StatusCode::CONFLICT],
        "{} {}",
        one.1,
        two.1
    );
    let refused = if one.0 == StatusCode::CONFLICT {
        one.1
    } else {
        two.1
    };
    assert_eq!(code(&refused), "promo_used");
    assert_eq!(
        used(&app, made["referral"]["id"].as_str().unwrap()).await,
        1
    );
    app.finish().await;
}

async fn sweep(app: &TestApp) -> Vec<(Uuid, i32)> {
    sqlx::query_as("select org_id, released from app.promo_release_stale_holds(500)")
        .fetch_all(&app.owner)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_sweep_releases_stale_holds_by_each_clinics_date_and_never_an_issued_one() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let priya = person(&app, ALPHA, &owner, "Priya Sharma", "9876500001").await;
    let visit = closed_visit(&app, ALPHA, &owner, &priya).await;
    let (_, made) = give(&app, ALPHA, &owner, &visit, json!({ "patient_offer": {} })).await;
    let offer = made["patient_offer"]["code"].as_str().unwrap().to_owned();
    let code_id = made["patient_offer"]["id"].as_str().unwrap().to_owned();
    let bill = draft(&app, &owner, &priya, json!({})).await;
    let bill_id = bill["id"].as_str().unwrap().to_owned();
    assert_eq!(apply(&app, &owner, &bill, &offer).await.0, StatusCode::OK);

    // Two clinics 25 hours apart: Kiritimati's date is always a day or two after Pago Pago's.
    // Both holds end on Pago Pago's date − 7: stale in Kiritimati only.
    exec(&app, "update aarogyam.organizations set timezone = 'Pacific/Pago_Pago' where slug = 'alpha';
                update aarogyam.organizations set timezone = 'Pacific/Kiritimati' where slug = 'beta';").await;
    let beta = app.token(BETA_OWNER);
    let beta_patient = person(&app, BETA, &beta, "Bela Rao", "9876500003").await;
    let beta_visit = closed_visit(&app, BETA, &beta, &beta_patient).await;
    let (_, beta_made) = give(
        &app,
        BETA,
        &beta,
        &beta_visit,
        json!({ "patient_offer": {} }),
    )
    .await;
    let (status, beta_bill) = call(&app, BETA, &beta, Method::POST, "/api/v1/invoices",
        Some(json!({ "patient_id": beta_patient, "items": [{ "description": "Scaling", "unit_price_paise": 100_000 }] }))).await;
    assert_eq!(status, StatusCode::CREATED);
    let beta_bill = beta_bill["id"].as_str().unwrap().to_owned();
    let (status, body) = call(
        &app,
        BETA,
        &beta,
        Method::POST,
        &format!("/api/v1/invoices/{beta_bill}/promo"),
        Some(json!({ "code": beta_made["patient_offer"]["code"] })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let beta_code = beta_made["patient_offer"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    exec(&app, &format!("update aarogyam.promo_codes set valid_from = valid_from - 30,
        valid_to = (now() at time zone 'Pacific/Pago_Pago')::date - 7 where id in ('{code_id}', '{beta_code}')")).await;
    assert_eq!(sweep(&app).await, vec![(app.clinic_id("beta").await, 1)]);
    assert_eq!(used(&app, &beta_code).await, 0);
    assert_eq!(used(&app, &code_id).await, 1);
    let lines = "select coalesce(sum(promo_discount_paise), 0)::bigint from aarogyam.invoice_items where invoice_id = $1";
    assert_eq!(scalar_i64(&app, lines, &beta_bill).await, 0);
    let actor: String = sqlx::query_scalar("select actor_kind from audit.audit_events where table_name = 'aarogyam.promo_redemptions' order by at desc limit 1")
        .fetch_one(&app.owner).await.unwrap();
    assert_eq!(actor, "system");
    // A day later in Pago Pago too: Alpha's hold goes and its lines are zeroed.
    exec(
        &app,
        &format!("update aarogyam.promo_codes set valid_to = valid_to - 1 where id = '{code_id}'"),
    )
    .await;
    assert_eq!(sweep(&app).await, vec![(app.clinic_id("alpha").await, 1)]);
    assert_eq!(used(&app, &code_id).await, 0);
    assert_eq!(scalar_i64(&app, lines, &bill_id).await, 0);
    // The code is usable again (N9) once its dates allow.
    exec(&app, &format!("update aarogyam.promo_codes set valid_to = (now() at time zone 'Pacific/Pago_Pago')::date + 30 where id = '{code_id}'")).await;
    assert_eq!(apply(&app, &owner, &bill, &offer).await.0, StatusCode::OK);

    // F4: an issue queued on the code lock before the sweep wins; the sweep skips the final use.
    exec(&app, &format!("update aarogyam.promo_codes set valid_to = (now() at time zone 'Pacific/Pago_Pago')::date - 20 where id = '{code_id}'")).await;
    let mut blocker = app.owner.begin().await.unwrap();
    sqlx::query("select 1 from aarogyam.promo_codes where id = $1 for update")
        .bind(Uuid::parse_str(&code_id).unwrap())
        .execute(&mut *blocker)
        .await
        .unwrap();
    let issuing = async {
        call(
            &app,
            ALPHA,
            &owner,
            Method::POST,
            &format!("/api/v1/invoices/{bill_id}/issue"),
            None,
        )
        .await
    };
    let sweeping = async {
        tokio::time::sleep(Duration::from_millis(300)).await;
        sweep(&app).await
    };
    let releasing = async {
        tokio::time::sleep(Duration::from_millis(700)).await;
        blocker.commit().await.unwrap();
    };
    let ((status, issued), swept, ()) = tokio::join!(issuing, sweeping, releasing);
    assert_eq!(status, StatusCode::OK, "{issued}");
    assert!(swept.is_empty(), "{swept:?}");
    assert_eq!(issued["promo"]["status"], "final");
    assert!(
        issued["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|l| l["promo_discount_paise"].as_i64().unwrap() > 0)
    );
    assert_eq!(used(&app, &code_id).await, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn erasing_a_referrer_revokes_their_codes_and_keeps_friends_history() {
    let app = TestApp::start().await;
    let clinic = app.clinic_id("alpha").await;
    let owner = app.token(ALPHA_OWNER);
    let asha = person(&app, ALPHA, &owner, "Asha Patel", "9876500010").await;
    let visit = closed_visit(&app, ALPHA, &owner, &asha).await;
    let (_, made) = give(
        &app,
        ALPHA,
        &owner,
        &visit,
        json!({ "patient_offer": {}, "referral": true }),
    )
    .await;
    let referral = made["referral"]["code"].as_str().unwrap().to_owned();
    let friend = person(&app, ALPHA, &owner, "Nisha Rao", "9876500020").await;
    let bill = draft(&app, &owner, &friend, json!({})).await;
    assert_eq!(
        apply(&app, &owner, &bill, &referral).await.0,
        StatusCode::OK
    );
    call(
        &app,
        ALPHA,
        &owner,
        Method::POST,
        &format!("/api/v1/invoices/{}/issue", bill["id"].as_str().unwrap()),
        None,
    )
    .await;
    let history =
        "select count(*) from audit.audit_events where row_id = $1 and changes is not null";
    let before = scalar_i64(&app, history, &friend).await;
    assert!(before > 0);
    let erased: bool = sqlx::query_scalar("select app.erase_patient($1, $2, gen_random_uuid())")
        .bind(clinic)
        .bind(Uuid::parse_str(&asha).unwrap())
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert!(erased);
    let live = scalar_i64(&app, "select count(*) from aarogyam.promo_codes where patient_id = $1 and revoke_reason is distinct from 'erased'", &asha).await;
    assert_eq!(live, 0);
    assert_eq!(scalar_i64(&app, history, &friend).await, before);
    app.finish().await;
}
