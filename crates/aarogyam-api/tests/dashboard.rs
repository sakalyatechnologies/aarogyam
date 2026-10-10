//! The Today board's layout on a real database: the clinic's default, each member's own layout
//! and the fall-back between them, the registry's checks (400), roles and other clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use axum::http::{Method, StatusCode};
use sakalya_db::{DbError, DbErrorKind, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

const MINE: &str = "/api/v1/me/dashboard-layout";
const CLINIC: &str = "/api/v1/settings/dashboard-layout";

async fn call(
    app: &TestApp,
    method: Method,
    host: &str,
    path: &str,
    token: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(method, host, path, Some(token), body).await
}

async fn get(app: &TestApp, host: &str, path: &str, token: &str) -> (StatusCode, Value) {
    call(app, Method::GET, host, path, token, None).await
}

async fn put(
    app: &TestApp,
    host: &str,
    path: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    call(app, Method::PUT, host, path, token, Some(body)).await
}

/// The catalogue's layout for a template.
fn template(view: &Value, key: &str) -> Value {
    view["catalogue"]["templates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["key"] == key)
        .unwrap()["layout"]
        .clone()
}

fn index_of(layout: &Value, key: &str) -> usize {
    layout["items"]
        .as_array()
        .unwrap()
        .iter()
        .position(|item| item["key"] == key)
        .unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn with_nothing_saved_a_member_gets_medsync_and_the_catalogue() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, view) = get(&app, ALPHA, MINE, &owner).await;
    assert_eq!(status, StatusCode::OK, "{view}");
    assert_eq!(view["source"], "template");
    assert_eq!(view["layout"]["tpl"], "medsync");
    assert_eq!(view["layout"]["v"], 2);
    assert_eq!(view["layout"], template(&view, "medsync"));

    let catalogue = &view["catalogue"];
    let keys = |list: &Value| -> Vec<String> {
        list.as_array()
            .unwrap()
            .iter()
            .map(|e| e["key"].as_str().unwrap().to_owned())
            .collect()
    };
    assert_eq!(
        keys(&catalogue["templates"]),
        [
            "medsync",
            "executive",
            "care",
            "focus",
            "compact",
            "front_desk"
        ]
    );
    assert_eq!(catalogue["widgets"].as_array().unwrap().len(), 15);
    assert_eq!(catalogue["metrics"].as_array().unwrap().len(), 8);
    let widget = |key: &str| {
        catalogue["widgets"]
            .as_array()
            .unwrap()
            .iter()
            .find(|w| w["key"] == key)
            .unwrap()
            .clone()
    };
    assert_eq!(widget("collections")["requires"], "finance.view");
    assert_eq!(
        widget("collections")["options"][0]["choices"],
        json!([4, 8, 12])
    );
    assert_eq!(widget("kpis")["options"][0]["kind"], "metrics");
    assert_eq!(widget("kpis")["options"][0]["min"], 4);
    assert_eq!(widget("kpis")["options"][0]["max"], 6);
    assert_eq!(widget("nextup")["options"][0]["max"], 5);
    assert_eq!(widget("kpis")["zones"], json!(["top", "main"]));
    // Every template in the catalogue is itself a layout the API accepts.
    for t in catalogue["templates"].as_array().unwrap() {
        let (status, saved) = put(&app, ALPHA, MINE, &owner, t["layout"].clone()).await;
        assert_eq!(status, StatusCode::OK, "{}: {saved}", t["key"]);
        assert_eq!(saved["layout"], t["layout"]);
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_member_wins_then_the_clinic_and_reset_falls_back() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (_, view) = get(&app, ALPHA, MINE, &owner).await;

    // The owner sets the clinic default; the front desk now reads it.
    let care = template(&view, "care");
    let (status, saved) = put(&app, ALPHA, CLINIC, &owner, care.clone()).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["source"], "clinic");
    let (_, read) = get(&app, ALPHA, CLINIC, &owner).await;
    assert_eq!(read["layout"], care);
    let (_, seen) = get(&app, ALPHA, MINE, &desk).await;
    assert_eq!(seen["source"], "clinic");
    assert_eq!(seen["layout"], care);

    // The front desk saves their own, with changed options; it is theirs alone and is the same on
    // every read (another device signs in as the same person).
    let mut mine = template(&view, "front_desk");
    let nextup = index_of(&mine, "nextup");
    mine["items"][nextup]["opts"]["count"] = json!(4);
    mine["density"] = json!("cozy");
    let (status, saved) = put(&app, ALPHA, MINE, &desk, mine.clone()).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["source"], "member");
    assert_eq!(saved["layout"], mine);
    let other_device = app.token(ALPHA_FRONT_DESK);
    let (_, again) = get(&app, ALPHA, MINE, &other_device).await;
    assert_eq!(again["source"], "member");
    assert_eq!(again["layout"], mine);
    let (_, owners) = get(&app, ALPHA, MINE, &owner).await;
    assert_eq!(
        owners["source"], "clinic",
        "the owner has no layout of their own"
    );
    assert_eq!(owners["layout"], care);

    // Saving again replaces; options left out come back as defaults.
    let mut sparse = template(&view, "focus");
    sparse["items"] = json!([{ "key": "collections", "zone": "main", "size": "L" }]);
    sparse.as_object_mut().unwrap().remove("v");
    let (status, saved) = put(&app, ALPHA, MINE, &desk, sparse).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["layout"]["v"], 2);
    assert_eq!(saved["layout"]["items"][0]["opts"], json!({ "weeks": 8 }));
    let (_, replaced) = get(&app, ALPHA, MINE, &desk).await;
    assert_eq!(replaced["layout"]["items"].as_array().unwrap().len(), 1);

    // Reset: back to the clinic default; resetting again is fine; the clinic's reset goes to
    // MedSync for everyone without their own.
    let (status, reset) = call(&app, Method::DELETE, ALPHA, MINE, &desk, None).await;
    assert_eq!(status, StatusCode::OK, "{reset}");
    assert_eq!(reset["source"], "clinic");
    assert_eq!(reset["layout"], care);
    let (status, _) = call(&app, Method::DELETE, ALPHA, MINE, &desk, None).await;
    assert_eq!(status, StatusCode::OK);
    let (status, cleared) = call(&app, Method::DELETE, ALPHA, CLINIC, &owner, None).await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert_eq!(cleared["source"], "template");
    let (_, after) = get(&app, ALPHA, MINE, &desk).await;
    assert_eq!(after["layout"]["tpl"], "medsync");
    assert_eq!(after["source"], "template");
    app.finish().await;
}

#[tokio::test]
#[expect(
    clippy::too_many_lines,
    reason = "one table of bad layouts, clearest read top to bottom"
)]
#[ignore = "needs DATABASE_URL"]
async fn the_registry_refuses_bad_layouts_with_400_and_saves_nothing() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, view) = get(&app, ALPHA, MINE, &owner).await;
    let base = template(&view, "medsync");
    let kpis = index_of(&base, "kpis");
    let appointments = index_of(&base, "appointments");
    let collections = index_of(&base, "collections");
    let nextup = index_of(&base, "nextup");
    let chairs = index_of(&base, "chairs");

    let edit = |change: &dyn Fn(&mut Value)| {
        let mut layout = base.clone();
        change(&mut layout);
        layout
    };
    let bad = vec![
        (
            "unknown widget",
            edit(&|l| l["items"][1]["key"] = json!("weather")),
        ),
        (
            "repeated widget",
            edit(&|l| l["items"][1]["key"] = json!("kpis")),
        ),
        ("unknown template", edit(&|l| l["tpl"] = json!("zen"))),
        ("version 1", edit(&|l| l["v"] = json!(1))),
        ("density", edit(&|l| l["density"] = json!("tiny"))),
        ("card", edit(&|l| l["card"] = json!("glass"))),
        ("rail side", edit(&|l| l["rail"]["side"] = json!("top"))),
        ("rail width", edit(&|l| l["rail"]["width"] = json!("huge"))),
        (
            "kpis in the rail",
            edit(&|l| l["items"][kpis]["zone"] = json!("rail")),
        ),
        (
            "collections in the rail",
            edit(&|l| l["items"][collections]["zone"] = json!("rail")),
        ),
        (
            "a zone that does not exist",
            edit(&|l| l["items"][appointments]["zone"] = json!("bottom")),
        ),
        (
            "chairs size S",
            edit(&|l| l["items"][chairs]["size"] = json!("S")),
        ),
        (
            "size XL",
            edit(&|l| l["items"][appointments]["size"] = json!("XL")),
        ),
        (
            "kpis with three metrics",
            edit(&|l| {
                l["items"][kpis]["opts"]["metrics"] =
                    json!(["appointments", "waiting", "completed"]);
            }),
        ),
        (
            "kpis with seven metrics",
            edit(&|l| {
                l["items"][kpis]["opts"]["metrics"] = json!([
                    "appointments",
                    "completed",
                    "waiting",
                    "new_patients",
                    "collected",
                    "outstanding",
                    "chairs_busy"
                ]);
            }),
        ),
        (
            "kpis with an unknown metric",
            edit(&|l| {
                l["items"][kpis]["opts"]["metrics"] =
                    json!(["appointments", "completed", "waiting", "weather"]);
            }),
        ),
        (
            "kpis with a repeated metric",
            edit(&|l| {
                l["items"][kpis]["opts"]["metrics"] =
                    json!(["waiting", "waiting", "completed", "appointments"]);
            }),
        ),
        (
            "next up count 0",
            edit(&|l| l["items"][nextup]["opts"]["count"] = json!(0)),
        ),
        (
            "next up count 6",
            edit(&|l| l["items"][nextup]["opts"]["count"] = json!(6)),
        ),
        (
            "appointments view grid",
            edit(&|l| l["items"][appointments]["opts"]["view"] = json!("grid")),
        ),
        (
            "collections 6 weeks",
            edit(&|l| l["items"][collections]["opts"]["weeks"] = json!(6)),
        ),
        (
            "chart as text",
            edit(&|l| l["items"][chairs]["opts"]["show_chart"] = json!("yes")),
        ),
        (
            "an option the widget lacks",
            edit(&|l| l["items"][chairs]["opts"]["colour"] = json!("red")),
        ),
        (
            "a stray field",
            edit(&|l| l["items"][chairs]["border"] = json!(1)),
        ),
        (
            "a stray top-level field",
            edit(&|l| l["theme"] = json!("dark")),
        ),
    ];
    for (what, layout) in bad {
        // A stray field never reaches the registry: the JSON extractor turns it away first.
        let expected = if what.contains("stray") {
            StatusCode::UNPROCESSABLE_ENTITY
        } else {
            StatusCode::BAD_REQUEST
        };
        for path in [MINE, CLINIC] {
            let (status, error) = put(&app, ALPHA, path, &owner, layout.clone()).await;
            assert_eq!(status, expected, "{what} on {path}: {error}");
        }
    }
    // The message names the place, not the value.
    let (_, error) = put(
        &app,
        ALPHA,
        MINE,
        &owner,
        edit(&|l| l["items"][collections]["opts"]["weeks"] = json!(6)),
    )
    .await;
    let message = error["error"]["message"].as_str().unwrap();
    assert!(message.contains("weeks"), "{message}");
    // A body that is not a layout at all is turned away by the JSON extractor (422).
    let (status, _) = put(&app, ALPHA, MINE, &owner, json!({ "items": 3 })).await;
    assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);

    // None of it was saved.
    let (_, after) = get(&app, ALPHA, MINE, &owner).await;
    assert_eq!(after["source"], "template");
    let (count,): (i64,) = sqlx::query_as("select count(*) from aarogyam.dashboard_layouts")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(count, 0);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn roles_and_other_clinics() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (_, view) = get(&app, ALPHA, MINE, &owner).await;
    let care = template(&view, "care");
    put(&app, ALPHA, CLINIC, &owner, care.clone()).await;
    put(&app, ALPHA, MINE, &owner, template(&view, "executive")).await;

    // Any member has a layout of their own, even a role with no permissions; only
    // settings.manage sets or reads the clinic's default.
    let nothing = app.token(ALPHA_NOTHING);
    let (status, seen) = get(&app, ALPHA, MINE, &nothing).await;
    assert_eq!(status, StatusCode::OK, "{seen}");
    assert_eq!(seen["layout"], care);
    let (status, _) = put(&app, ALPHA, MINE, &nothing, template(&view, "focus")).await;
    assert_eq!(status, StatusCode::OK);
    let desk = app.token(ALPHA_FRONT_DESK);
    for (method, body) in [
        (Method::GET, None),
        (Method::PUT, Some(care.clone())),
        (Method::DELETE, None),
    ] {
        let (status, _) = call(&app, method.clone(), ALPHA, CLINIC, &desk, body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{method}");
    }
    let (_, still) = get(&app, ALPHA, CLINIC, &owner).await;
    assert_eq!(still["layout"], care);

    // Another clinic's owner gets 404 on Alpha's host, for every route and method.
    let beta = app.token(BETA_OWNER);
    for path in [MINE, CLINIC] {
        for (method, body) in [
            (Method::GET, None),
            (Method::PUT, Some(care.clone())),
            (Method::DELETE, None),
        ] {
            let (status, _) = call(&app, method.clone(), ALPHA, path, &beta, body).await;
            assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}");
        }
    }
    // At home Beta sees none of Alpha's layouts, and its own changes stay in Beta.
    let (_, home) = get(&app, BETA, MINE, &beta).await;
    assert_eq!(home["source"], "template");
    put(&app, BETA, CLINIC, &beta, template(&view, "compact")).await;
    let (_, alpha_clinic) = get(&app, ALPHA, CLINIC, &owner).await;
    assert_eq!(alpha_clinic["layout"], care);
    let (_, alpha_owner) = get(&app, ALPHA, MINE, &owner).await;
    assert_eq!(alpha_owner["layout"]["tpl"], "executive");

    // Beta can't hang a layout on one of Alpha's memberships, even writing the row directly.
    let (alpha, beta_id) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let (membership,): (uuid::Uuid,) =
        sqlx::query_as("select id from aarogyam.memberships where org_id = $1 limit 1")
            .bind(alpha)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    let error = app
        .api_db()
        .scoped(&Scope::tenant(beta_id), async |tx| {
            sqlx::query(
                "insert into aarogyam.dashboard_layouts (membership_id, layout)
                 values ($1, '{\"v\":2}'::jsonb)",
            )
            .bind(membership)
            .execute(tx.conn())
            .await
            .map_err(DbError::from)
        })
        .await
        .unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Conflict, "{error}");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_saved_layout_the_registry_no_longer_accepts_is_skipped() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let alpha = app.clinic_id("alpha").await;
    sqlx::query(
        "insert into aarogyam.dashboard_layouts (org_id, layout)
         values ($1, '{\"v\":2,\"tpl\":\"care\",\"items\":[{\"key\":\"retired\"}]}'::jsonb)",
    )
    .bind(alpha)
    .execute(&app.owner)
    .await
    .unwrap();
    let (status, view) = get(&app, ALPHA, MINE, &owner).await;
    assert_eq!(status, StatusCode::OK, "{view}");
    assert_eq!(view["source"], "template");
    // The database itself refuses a layout of another version, and a second clinic default.
    let wrong = sqlx::query(
        "insert into aarogyam.dashboard_layouts (org_id, membership_id, layout)
         values ($1, null, '{\"v\":2}'::jsonb)",
    )
    .bind(alpha)
    .execute(&app.owner)
    .await;
    assert!(wrong.is_err(), "one clinic default per clinic");
    app.finish().await;
}
