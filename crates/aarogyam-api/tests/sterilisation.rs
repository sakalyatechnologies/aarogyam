//! Sterilisation cycles (BK-16) and the monthly revenue target (BK-15) on a real database:
//! recording and listing cycles, the Today count, who may do what, that none of it crosses
//! clinics, and the target on the settings and the money card.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use serde_json::json;
use support::people::*;
use support::{ALPHA, BETA, TestApp};

const PATH: &str = "/api/v1/sterilisation-cycles";

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_record_cycles_and_today_counts_them() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, cycle) = app
        .send(
            Method::POST,
            ALPHA,
            PATH,
            Some(&desk),
            Some(json!({ "load_note": "  Handpieces and trays " })),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{cycle}");
    assert_eq!(cycle["load_note"], "Handpieces and trays");
    let (status, _) = app
        .send(Method::POST, ALPHA, PATH, Some(&desk), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, list) = app.send(Method::GET, ALPHA, PATH, Some(&desk), None).await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["items"].as_array().unwrap().len(), 2);

    let (status, today) = app
        .send(Method::GET, ALPHA, "/api/v1/today", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{today}");
    assert_eq!(today["sterilisation_cycles_today"], 2);

    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            PATH,
            Some(&desk),
            Some(json!({ "load_note": "x".repeat(121) })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("{PATH}?date=soon"),
            Some(&desk),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    app.finish().await;
}

/// Beta's owner sees none of Alpha's cycles, over HTTP or directly (row-level security), and
/// someone with no permissions can neither record nor list.
#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn cycles_stay_in_their_clinic_and_need_a_permission() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let (status, _) = app
        .send(Method::POST, ALPHA, PATH, Some(&owner), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let (status, theirs) = app.send(Method::GET, BETA, PATH, Some(&beta), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(theirs["items"], json!([]));
    let (_, today) = app
        .send(Method::GET, BETA, "/api/v1/today", Some(&beta), None)
        .await;
    assert_eq!(today["sterilisation_cycles_today"], 0);

    let (alpha, beta_org) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let db = app.api_db();
    for (org, expected) in [(alpha, 1_i64), (beta_org, 0)] {
        let seen = db
            .scoped(&sakalya_db::Scope::tenant(org), async |tx| {
                sqlx::query_scalar::<_, i64>("select count(*) from aarogyam.sterilisation_cycles")
                    .fetch_one(tx.conn())
                    .await
                    .map_err(sakalya_db::DbError::from)
            })
            .await
            .unwrap();
        assert_eq!(seen, expected);
    }

    // Cycles are never edited or deleted.
    let changed = sqlx::query("update aarogyam.sterilisation_cycles set load_note = 'x'")
        .execute(&app.owner)
        .await;
    assert!(changed.is_err());

    // Beta's owner can't record into Alpha's clinic.
    let (status, _) = app
        .send(Method::POST, ALPHA, PATH, Some(&beta), Some(json!({})))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let nobody = app.token(ALPHA_NOTHING);
    for method in [Method::GET, Method::POST] {
        let body = (method == Method::POST).then(|| json!({}));
        let (status, _) = app.send(method, ALPHA, PATH, Some(&nobody), body).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_monthly_target_is_set_shown_and_cleared() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let settings = "/api/v1/settings/clinic";
    let money = "/api/v1/today/money";

    let (_, before) = app
        .send(Method::GET, ALPHA, money, Some(&owner), None)
        .await;
    assert_eq!(before["month_target_paise"], serde_json::Value::Null);
    assert_eq!(
        before["month_collected_paise"],
        before["collected_this_month_paise"]
    );

    let (status, saved) = app
        .send(
            Method::PATCH,
            ALPHA,
            settings,
            Some(&owner),
            Some(json!({ "month_revenue_target_paise": 50_000_000 })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["month_revenue_target_paise"], 50_000_000);
    let (_, shown) = app
        .send(Method::GET, ALPHA, money, Some(&owner), None)
        .await;
    assert_eq!(shown["month_target_paise"], 50_000_000);

    // Another change leaves the target alone; another clinic has none.
    let (status, kept) = app
        .send(
            Method::PATCH,
            ALPHA,
            settings,
            Some(&owner),
            Some(json!({ "upi_id": "alpha@okicici" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{kept}");
    assert_eq!(kept["month_revenue_target_paise"], 50_000_000);
    let beta = app.token(BETA_OWNER);
    let (_, theirs) = app.send(Method::GET, BETA, money, Some(&beta), None).await;
    assert_eq!(theirs["month_target_paise"], serde_json::Value::Null);

    for bad in [-5, 100_000_000_001_i64] {
        let (status, _) = app
            .send(
                Method::PATCH,
                ALPHA,
                settings,
                Some(&owner),
                Some(json!({ "month_revenue_target_paise": bad })),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{bad}");
    }
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            settings,
            Some(&desk),
            Some(json!({ "month_revenue_target_paise": 1 })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, cleared) = app
        .send(
            Method::PATCH,
            ALPHA,
            settings,
            Some(&owner),
            Some(json!({ "month_revenue_target_paise": 0 })),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert_eq!(
        cleared["month_revenue_target_paise"],
        serde_json::Value::Null
    );
    app.finish().await;
}
