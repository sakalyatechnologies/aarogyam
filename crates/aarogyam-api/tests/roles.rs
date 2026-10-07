//! Roles and access on a real database: the catalogue, editing a role's permissions, custom
//! roles, the guards that keep the owner in control, the change record, and clinic isolation.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]
#![expect(
    clippy::too_many_lines,
    reason = "each test walks one story end to end"
)]

mod support;

use aarogyam_domain::permission::Permission;
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};

/// The permission keys of a role or template, as the API lists them.
fn keys(permissions: &Value) -> Vec<String> {
    permissions
        .as_array()
        .unwrap()
        .iter()
        .map(|permission| permission["key"].as_str().unwrap().to_owned())
        .collect()
}

async fn role(app: &TestApp, token: &str, key: &str) -> Value {
    let (status, body) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/roles/{key}"),
            Some(token),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}

async fn set(app: &TestApp, token: &str, key: &str, permissions: Value) -> (StatusCode, Value) {
    app.send(
        Method::PUT,
        ALPHA,
        &format!("/api/v1/roles/{key}/permissions"),
        Some(token),
        Some(json!({ "permissions": permissions })),
    )
    .await
}

fn message(error: &Value) -> &str {
    error["error"]["message"].as_str().unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_catalogue_matches_the_code_and_finance_stays_with_owner_and_finance() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, catalogue) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/permissions",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{catalogue}");
    let mut listed = keys(&catalogue["permissions"]);
    listed.sort();
    let mut code: Vec<String> = Permission::ALL.iter().map(|p| p.key().to_owned()).collect();
    code.sort();
    assert_eq!(listed, code);
    for entry in catalogue["permissions"].as_array().unwrap() {
        let permission = Permission::from_key(entry["key"].as_str().unwrap()).unwrap();
        let scopes: Vec<&str> = permission.scopes().iter().map(|s| s.key()).collect();
        assert_eq!(entry["scopes"], json!(scopes), "{permission}");
        assert_ne!(entry["description"], "");
    }

    // Safe defaults: money totals only for the owner and finance; roles.manage only for the owner.
    let (_, roles) = app
        .send(Method::GET, ALPHA, "/api/v1/roles", Some(&owner), None)
        .await;
    for item in roles["items"].as_array().unwrap() {
        let held = keys(&item["permissions"]);
        let key = item["key"].as_str().unwrap();
        assert_eq!(
            held.iter().any(|k| k == "finance.view"),
            ["owner", "finance"].contains(&key),
            "{key}"
        );
        assert_eq!(
            held.iter().any(|k| k == "roles.manage"),
            key == "owner",
            "{key}"
        );
    }
    let templates = catalogue["templates"].as_array().unwrap();
    for template in templates {
        let key = template["key"].as_str().unwrap();
        let held = keys(&template["permissions"]);
        assert_eq!(
            held.iter().any(|k| k == "finance.view"),
            ["owner", "finance"].contains(&key)
        );
    }

    // Front desk has no roles.manage: every roles route is refused.
    let desk = app.token(ALPHA_FRONT_DESK);
    for (method, path, body) in [
        (Method::GET, "/api/v1/permissions", None),
        (Method::GET, "/api/v1/roles/doctor", None),
        (
            Method::PUT,
            "/api/v1/roles/doctor/permissions",
            Some(json!({ "permissions": [] })),
        ),
        (
            Method::POST,
            "/api/v1/roles",
            Some(json!({ "name": "Nurse", "template_key": "assistant" })),
        ),
        (Method::DELETE, "/api/v1/roles/nothing", None),
    ] {
        let (status, _) = app.send(method, ALPHA, path, Some(&desk), body).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_changed_role_applies_at_once_and_is_recorded() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let desk = app.token(ALPHA_FRONT_DESK);
    // The desk's permissions are now cached.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    let before = role(&app, &owner, "front_desk").await;
    assert_eq!(before["template_key"], "front_desk");
    assert_eq!(before["member_count"], 1);
    assert_eq!(before["editable"], true);
    assert_eq!(before["permissions"], before["default_permissions"]);
    let without_patients: Vec<Value> = before["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| !p["key"].as_str().unwrap().starts_with("patients."))
        .cloned()
        .collect();
    let (status, saved) = set(&app, &owner, "front_desk", json!(without_patients)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(saved["changed"], true);
    // At once, not when the cache expires.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (_, session) = app
        .send(Method::GET, ALPHA, "/api/v1/session", Some(&desk), None)
        .await;
    assert!(
        !session["membership"]["permissions"]
            .as_array()
            .unwrap()
            .contains(&json!("patients.read"))
    );

    // Who changed what, before and after.
    let after = role(&app, &owner, "front_desk").await;
    let change = &after["history"][0];
    assert_eq!(change["action"], "permissions_changed");
    assert_eq!(change["changed_by_name"], "Asha Owner");
    assert_eq!(change["before"], before["permissions"]);
    assert_eq!(change["after"], json!(without_patients));
    // The same list again records nothing.
    let (_, saved) = set(&app, &owner, "front_desk", json!(without_patients)).await;
    assert_eq!(saved["changed"], false);
    assert_eq!(
        role(&app, &owner, "front_desk").await["history"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    // The table-level change history has the rows too.
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events
         where table_name = 'aarogyam.role_permissions' and action = 'delete'",
    )
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(audited, 3);

    // Reset to default: the defaults restore patients.
    let (status, saved) = set(
        &app,
        &owner,
        "front_desk",
        before["default_permissions"].clone(),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/patients", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK);

    // Scopes: narrowed where the catalogue allows it, refused elsewhere.
    let (status, saved) = set(
        &app,
        &owner,
        "assistant",
        json!([{ "key": "patients.read", "scope": "assigned" }, { "key": "appointments.read" }]),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert_eq!(
        saved["permissions"],
        json!([{ "key": "appointments.read", "scope": "all" }, { "key": "patients.read", "scope": "assigned" }])
    );
    for (permissions, field) in [
        (
            json!([{ "key": "finance.view", "scope": "own" }]),
            "permissions",
        ),
        (json!([{ "key": "root.everything" }]), "permissions"),
        (
            json!([{ "key": "billing.read" }, { "key": "billing.read" }]),
            "permissions",
        ),
        (
            json!([{ "key": "billing.read", "scope": "most" }]),
            "permissions",
        ),
    ] {
        let (status, error) = set(&app, &owner, "assistant", permissions).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(message(&error).starts_with(field));
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn the_owner_role_stays_whole_and_nobody_grants_what_they_lack() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, error) = set(&app, &owner, "owner", json!([])).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(message(&error).contains("owner role"));
    let (status, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            "/api/v1/roles/owner",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(role(&app, &owner, "owner").await["editable"], false);

    // A manager with roles.manage, patients.read and billing.read, but no finance.view.
    sqlx::raw_sql(
        "insert into aarogyam.role_permissions (org_id, role_id, permission)
         select org_id, id, p from aarogyam.roles, unnest(array['roles.manage', 'patients.read', 'billing.read']) p
         where key = 'nothing'",
    )
    .execute(&app.owner)
    .await
    .unwrap();
    let manager = app.token(ALPHA_NOTHING);
    // roles.manage without staff.manage still lists the roles: the editor needs the list.
    let (status, listed) = app
        .send(Method::GET, ALPHA, "/api/v1/roles", Some(&manager), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{listed}");
    // ...but not the staff list, which stays behind staff.manage.
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/staff", Some(&manager), None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = set(
        &app,
        &manager,
        "nothing",
        json!([{ "key": "finance.view" }]),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "their own role");
    let (status, _) = set(&app, &manager, "owner", json!([])).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, error) = set(
        &app,
        &manager,
        "assistant",
        json!([{ "key": "patients.read" }, { "key": "finance.view" }]),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert!(message(&error).contains("only give access you have"));
    // Nothing was written.
    let assistant = role(&app, &owner, "assistant").await;
    assert!(!keys(&assistant["permissions"]).contains(&"finance.view".to_owned()));
    // Keeping what the role already has is not granting: the finance role keeps finance.view
    // while the manager takes away reports.export.
    let finance = role(&app, &owner, "finance").await;
    let kept: Vec<Value> = finance["permissions"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|p| p["key"] != "reports.export")
        .cloned()
        .collect();
    let (status, saved) = set(&app, &manager, "finance", json!(kept)).await;
    assert_eq!(status, StatusCode::OK, "{saved}");
    assert!(keys(&saved["permissions"]).contains(&"finance.view".to_owned()));
    // But not putting reports.export back, which the manager lacks.
    let (status, _) = set(&app, &manager, "finance", finance["permissions"].clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    // Narrowing within what they hold is fine.
    let (status, _) = set(
        &app,
        &manager,
        "assistant",
        json!([{ "key": "patients.read", "scope": "own" }]),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    // A template that grants what they lack can't be copied.
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/roles",
            Some(&manager),
            Some(json!({ "name": "Accounts", "template_key": "finance" })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn custom_roles_start_from_a_template_and_go_when_unused() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let create = |body: Value| {
        let app = &app;
        let owner = &owner;
        async move {
            app.send(
                Method::POST,
                ALPHA,
                "/api/v1/roles",
                Some(owner),
                Some(body),
            )
            .await
        }
    };
    let (status, nurse) =
        create(json!({ "name": "Senior nurse", "template_key": "assistant" })).await;
    assert_eq!(status, StatusCode::CREATED, "{nurse}");
    assert_eq!(nurse["key"], "senior_nurse");
    assert_eq!(nurse["is_template"], false);
    assert_eq!(nurse["template_key"], "assistant");
    assert_eq!(nurse["permissions"], nurse["default_permissions"]);
    assert_eq!(nurse["history"][0]["action"], "created");
    let (status, _) = create(json!({ "name": "Senior Nurse", "template_key": "assistant" })).await;
    assert_eq!(status, StatusCode::CONFLICT);
    for (body, field) in [
        (
            json!({ "name": "Boss", "template_key": "owner" }),
            "template_key",
        ),
        (
            json!({ "name": "Wizard", "template_key": "wizard" }),
            "template_key",
        ),
        (json!({ "name": "नर्स", "template_key": "assistant" }), "key"),
        (json!({ "name": " ", "template_key": "assistant" }), "name"),
    ] {
        let (status, error) = create(body).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{error}");
        assert!(message(&error).starts_with(field), "{error}");
    }

    // Assigned to the desk, it is in use; moved back, it can go.
    let (_, staff) = app
        .send(Method::GET, ALPHA, "/api/v1/staff", Some(&owner), None)
        .await;
    let desk = staff["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["display_name"] == "Farah Desk")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let member = format!("/api/v1/staff/{desk}");
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &member,
            Some(&owner),
            Some(json!({ "role_key": "senior_nurse" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, error) = app
        .send(
            Method::DELETE,
            ALPHA,
            "/api/v1/roles/senior_nurse",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(message(&error).contains("move them to another role"));
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &member,
            Some(&owner),
            Some(json!({ "role_key": "front_desk" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = app
        .send(
            Method::DELETE,
            ALPHA,
            "/api/v1/roles/senior_nurse",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/roles/senior_nurse",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, roles) = app
        .send(Method::GET, ALPHA, "/api/v1/roles", Some(&owner), None)
        .await;
    assert!(
        !roles["items"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["key"] == "senior_nurse")
    );
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &member,
            Some(&owner),
            Some(json!({ "role_key": "senior_nurse" })),
        )
        .await;
    assert_eq!(
        status,
        StatusCode::BAD_REQUEST,
        "a removed role can't be given"
    );
    // The key is free again, and the removal is on record.
    let (status, _) = create(json!({ "name": "Senior nurse", "template_key": "doctor" })).await;
    assert_eq!(status, StatusCode::CREATED);
    let removals: i64 =
        sqlx::query_scalar("select count(*) from aarogyam.role_changes where action = 'deleted'")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(removals, 1);
    // Standard roles stay.
    let (status, error) = app
        .send(
            Method::DELETE,
            ALPHA,
            "/api/v1/roles/doctor",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(message(&error).starts_with("standard roles"));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn roles_stay_within_their_clinic() {
    let app = TestApp::start().await;
    let alpha = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    // Beta's owner, on Alpha's host, is no member there.
    for (method, path, body) in [
        (Method::GET, "/api/v1/permissions", None),
        (Method::GET, "/api/v1/roles/front_desk", None),
        (
            Method::PUT,
            "/api/v1/roles/front_desk/permissions",
            Some(json!({ "permissions": [] })),
        ),
        (
            Method::POST,
            "/api/v1/roles",
            Some(json!({ "name": "Nurse", "template_key": "assistant" })),
        ),
        (Method::DELETE, "/api/v1/roles/nothing", None),
    ] {
        let (status, _) = app.send(method, ALPHA, path, Some(&beta), body).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    // On Beta's host, Alpha's own custom role doesn't exist.
    for (method, path) in [
        (Method::GET, "/api/v1/roles/nothing"),
        (Method::DELETE, "/api/v1/roles/nothing"),
    ] {
        let (status, _) = app.send(method, BETA, path, Some(&beta), None).await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{path}");
    }
    let (status, _) = app
        .send(
            Method::PUT,
            BETA,
            "/api/v1/roles/nothing/permissions",
            Some(&beta),
            Some(json!({ "permissions": [] })),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    // Beta changing its front desk leaves Alpha's alone.
    let (status, _) = app
        .send(
            Method::PUT,
            BETA,
            "/api/v1/roles/front_desk/permissions",
            Some(&beta),
            Some(json!({ "permissions": [{ "key": "appointments.read" }] })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let ours = role(&app, &alpha, "front_desk").await;
    assert_eq!(ours["permissions"], ours["default_permissions"]);
    assert_eq!(ours["history"], json!([]));
    app.finish().await;
}
