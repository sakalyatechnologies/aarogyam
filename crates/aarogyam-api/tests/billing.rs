//! Money on a real database: the price list, bills with GST, payments with idempotency keys,
//! and that none of it crosses clinics.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_domain::access::{Authorization, ClinicActor, ClinicPlace, MembershipStatus};
use aarogyam_domain::ids::{ClinicId, InvoiceId, MembershipId, UserId};
use aarogyam_domain::permission::{Permission, PermissionSet, Scope};
use axum::http::{Method, StatusCode};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::macros::datetime;
use uuid::Uuid;

/// Makes Alpha GST-registered in Maharashtra.
async fn register_for_gst(app: &TestApp) {
    sqlx::raw_sql(
        "update aarogyam.organizations set gstin = '27AAPFU0939F1ZV', legal_name = 'Alpha Dental LLP'
           where slug = 'alpha';
         update aarogyam.branches set state_code = '27'
           where org_id = (select id from aarogyam.organizations where slug = 'alpha');",
    )
    .execute(&app.owner)
    .await
    .unwrap();
}

async fn patient(app: &TestApp, host: &str, token: &str) -> String {
    let body = json!({ "full_name": "Priya Sharma", "sex": "female", "age_years": 36 });
    let (status, body) = app
        .send(
            Method::POST,
            host,
            "/api/v1/patients",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["id"].as_str().unwrap().to_owned()
}

async fn price_item(app: &TestApp, token: &str, body: Value) -> String {
    let (status, item) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/price-items",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{item}");
    item["id"].as_str().unwrap().to_owned()
}

/// A draft for `patient` with the given lines; returns the bill.
async fn draft(app: &TestApp, host: &str, token: &str, patient: &str, items: Value) -> Value {
    let body = json!({ "patient_id": patient, "items": items });
    let (status, bill) = app
        .send(
            Method::POST,
            host,
            "/api/v1/invoices",
            Some(token),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{bill}");
    bill
}

async fn issue(app: &TestApp, token: &str, id: &str) -> Value {
    let path = format!("/api/v1/invoices/{id}/issue");
    let (status, bill) = app
        .send(Method::POST, ALPHA, &path, Some(token), None)
        .await;
    assert_eq!(status, StatusCode::OK, "{bill}");
    bill
}

/// A bill of ₹1,000.00 exempt, issued.
async fn issued_bill(app: &TestApp, token: &str, patient: &str) -> Value {
    let items = json!([{ "description": "Scaling", "unit_price_paise": 100_000 }]);
    let bill = draft(app, ALPHA, token, patient, items).await;
    issue(app, token, bill["id"].as_str().unwrap()).await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bills_charge_gst_per_line_and_freeze_when_issued() {
    let app = TestApp::start().await;
    register_for_gst(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let consult = json!({ "name": "Consultation", "code": "CONS", "category": "consultation",
                          "sac_hsn": "9993", "price_paise": 50_000 });
    let consult = price_item(&app, &owner, consult).await;
    let paste = json!({ "name": "Sensitivity toothpaste", "category": "products", "sac_hsn": "3306",
                        "price_paise": 14_999, "gst_rate": 18 });
    let paste = price_item(&app, &owner, paste).await;
    let (_, list) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/price-items",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(list["items"].as_array().unwrap().len(), 2);
    assert_eq!(list["items"][1]["taxable"], true);

    let items = json!([
        { "price_item_id": consult },
        { "price_item_id": paste, "quantity": 2, "discount_paise": 0 },
        { "description": "X-ray (IOPA)", "unit_price_paise": 20_000, "discount_paise": 5_000 }
    ]);
    let bill = draft(&app, ALPHA, &owner, &patient, items).await;
    let id = bill["id"].as_str().unwrap().to_owned();
    assert_eq!(bill["status"], "draft");
    assert_eq!(bill["number"], Value::Null);
    // A preview: 500 + 299.98 + 150 taxable, 18% on the paste only.
    assert_eq!(bill["taxable_paise"], 94_998);
    assert_eq!(bill["cgst_paise"], 2_700);

    let bill = issue(&app, &owner, &id).await;
    let number = bill["number"].as_str().unwrap();
    assert!(
        number.starts_with("AD/") && number.ends_with("/000001"),
        "{number}"
    );
    assert_eq!(bill["doc_type"], "tax_invoice");
    assert_eq!(bill["payment_state"], "unpaid");
    assert_eq!(
        (bill["cgst_paise"].as_i64(), bill["sgst_paise"].as_i64()),
        (Some(2_700), Some(2_700))
    );
    assert_eq!(bill["igst_paise"], 0);
    // 949.98 + 54.00 = 1,003.98 → 1,004.00.
    assert_eq!(bill["round_off_paise"], 2);
    assert_eq!(bill["total_paise"], 100_400);
    assert_eq!(bill["balance_paise"], 100_400);
    assert_eq!(bill["supplier"]["gstin"], "27AAPFU0939F1ZV");
    assert_eq!(bill["supplier"]["legal_name"], "Alpha Dental LLP");
    assert_eq!(bill["recipient"]["name"], "Priya Sharma");
    assert_eq!(bill["items"][1]["sac_hsn"], "3306");
    assert_eq!(bill["items"][0]["gst_rate"], 0);

    // Issued bills never change: not through the API, nor straight in the database.
    let path = format!("/api/v1/invoices/{id}");
    let (status, _) = app
        .send(
            Method::PATCH,
            ALPHA,
            &path,
            Some(&owner),
            Some(json!({ "notes": "x" })),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{path}/issue"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let frozen = sqlx::query("update aarogyam.invoices set total_paise = 1 where id = $1::uuid")
        .bind(&id)
        .execute(&app.owner)
        .await;
    assert!(frozen.unwrap_err().to_string().contains("is final"));
    let line =
        sqlx::query("update aarogyam.invoice_items set quantity = 9 where invoice_id = $1::uuid")
            .bind(&id)
            .execute(&app.owner)
            .await;
    assert!(line.unwrap_err().to_string().contains("final document"));

    // Opening it writes the access record.
    let (status, opened) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(opened["items"].as_array().unwrap().len(), 3);
    let (views,): (i64,) = sqlx::query_as(
        "select count(*) from audit.access_log where resource = 'invoice' and resource_id = $1::uuid",
    )
    .bind(&id)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(views, 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "one bill's life reads best as one test"
)]
async fn drafts_are_edited_voided_and_billed_again() {
    let app = TestApp::start().await;
    register_for_gst(&app).await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let items = json!([{ "description": "Mouthwash", "unit_price_paise": 10_000, "gst_rate": 12 }]);
    let bill = draft(&app, ALPHA, &owner, &patient, items).await;
    let id = bill["id"].as_str().unwrap().to_owned();
    let path = format!("/api/v1/invoices/{id}");

    // Another state's place of supply makes it IGST.
    let edit = json!({ "place_of_supply": "29", "items": [
        { "description": "Mouthwash", "unit_price_paise": 10_000, "gst_rate": 12, "quantity": 3 }
    ] });
    let (status, edited) = app
        .send(Method::PATCH, ALPHA, &path, Some(&owner), Some(edit))
        .await;
    assert_eq!(status, StatusCode::OK, "{edited}");
    assert_eq!(edited["items"].as_array().unwrap().len(), 1);
    assert_eq!(edited["igst_paise"], 3_600);
    assert_eq!(edited["cgst_paise"], 0);
    let bad = json!({ "items": [{ "description": "X", "unit_price_paise": 100, "gst_rate": 28 }] });
    let (status, body) = app
        .send(Method::PATCH, ALPHA, &path, Some(&owner), Some(bad))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(
        body["error"]["message"]
            .as_str()
            .unwrap()
            .contains("gst_rate"),
        "{body}"
    );

    let bill = issue(&app, &owner, &id).await;
    assert_eq!(bill["total_paise"], 33_600);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{path}/void"),
            Some(&owner),
            Some(json!({ "reason": "" })),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let reason = json!({ "reason": "Wrong quantity" });
    let (status, void) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{path}/void"),
            Some(&owner),
            Some(reason.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{void}");
    assert_eq!(void["status"], "void");
    assert_eq!(void["number"], bill["number"]);
    assert_eq!(void["payment_state"], Value::Null);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{path}/void"),
            Some(&owner),
            Some(reason),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    // The correction replaces it, once.
    let again = json!({ "patient_id": patient, "replaces_invoice_id": id,
                        "items": [{ "description": "Mouthwash", "unit_price_paise": 10_000 }] });
    let (status, replacement) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/invoices",
            Some(&owner),
            Some(again.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{replacement}");
    assert_eq!(replacement["replaces_invoice_id"], id.as_str());
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/invoices",
            Some(&owner),
            Some(again),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);

    let (status, list) = app
        .send(
            Method::GET,
            ALPHA,
            &format!("/api/v1/invoices?status=void&patient_id={patient}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 1);
    app.finish().await;
}

async fn owner_actor(app: &TestApp) -> ClinicActor {
    let (user_id, membership_id): (Uuid, Uuid) = sqlx::query_as(
        "select u.id, m.id from aarogyam.users u join aarogyam.memberships m on m.user_id = u.id
         where u.auth_uid = $1",
    )
    .bind(ALPHA_OWNER)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    let clinic = ClinicId::from_uuid(app.clinic_id("alpha").await);
    let authorization = Authorization {
        user_id: UserId::from_uuid(user_id),
        user_active: true,
        membership_id: MembershipId::from_uuid(membership_id),
        membership_status: Some(MembershipStatus::Active),
        role_key: "owner".into(),
        permissions: PermissionSet::EMPTY.with(Permission::BillingWrite, Scope::All),
        session_revoked: false,
    };
    let place = ClinicPlace {
        id: clinic,
        timezone: "Asia/Kolkata".into(),
        number_prefix: "AD".into(),
    };
    ClinicActor::admit(place, authorization).unwrap()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bill_numbers_restart_at_the_financial_year_in_clinic_time() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let actor = owner_actor(&app).await;
    let db = app.api_db();
    let items = json!([{ "description": "Filling", "unit_price_paise": 150_000 }]);
    let mut numbers = Vec::new();
    // 23:59 IST on 31 March, then 00:01 IST on 1 April (still 31 March in UTC), twice.
    for now in [
        datetime!(2027-03-31 18:29 UTC),
        datetime!(2027-03-31 18:31 UTC),
        datetime!(2027-03-31 18:45 UTC),
    ] {
        let bill = draft(&app, ALPHA, &owner, &patient, items.clone()).await;
        let id = InvoiceId::from_uuid(bill["id"].as_str().unwrap().parse().unwrap());
        let issued = aarogyam_app::billing::issue(&db, &actor, None, id, now)
            .await
            .unwrap();
        numbers.push(issued.number.unwrap());
    }
    assert_eq!(
        numbers,
        ["AD/26-27/000001", "AD/27-28/000001", "AD/27-28/000002"]
    );
    // An unregistered clinic issues a bill of supply.
    let bill = draft(&app, ALPHA, &owner, &patient, items).await;
    let bill = issue(&app, &owner, bill["id"].as_str().unwrap()).await;
    assert_eq!(bill["doc_type"], "bill_of_supply");
    app.finish().await;
}

async fn pay(app: &TestApp, token: &str, key: &str, body: Value) -> (StatusCode, Value) {
    app.send_with(
        Method::POST,
        ALPHA,
        "/api/v1/payments",
        Some(token),
        Some(body),
        &[("idempotency-key", key)],
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn payments_are_idempotent_and_never_overpay_a_bill() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let bill = issued_bill(&app, &owner, &patient).await;
    let bill_id = bill["id"].as_str().unwrap();
    let first = json!({ "patient_id": patient, "method": "upi", "amount_paise": 40_000,
                        "reference": "UPI123", "allocations": [{ "invoice_id": bill_id, "amount_paise": 40_000 }] });
    let (status, paid) = pay(&app, &desk, "key-0000-0001", first.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    assert!(paid["number"].as_str().unwrap().ends_with("/000001"));
    // The retry finds the same payment; the same key with another amount is refused.
    let (status, again) = pay(&app, &desk, "key-0000-0001", first.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(again["id"], paid["id"]);
    let mut changed = first.clone();
    changed["amount_paise"] = json!(45_000);
    changed["allocations"][0]["amount_paise"] = json!(45_000);
    let (status, _) = pay(&app, &desk, "key-0000-0001", changed).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (count,): (i64,) = sqlx::query_as("select count(*) from aarogyam.payments")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert_eq!(count, 1);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/payments",
            Some(&desk),
            Some(first),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "the key is required");

    let path = format!("/api/v1/invoices/{bill_id}");
    let (_, partial) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(partial["payment_state"], "partial");
    assert_eq!(partial["balance_paise"], 60_000);
    assert_eq!(partial["methods"], json!(["upi"]));

    // More than the balance, or allocations past the payment, are refused.
    let over = json!({ "patient_id": patient, "method": "cash", "amount_paise": 70_000,
                       "allocations": [{ "invoice_id": bill_id, "amount_paise": 60_001 }] });
    let (status, body) = pay(&app, &desk, "key-0000-0002", over).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    let past = json!({ "patient_id": patient, "method": "cash", "amount_paise": 100,
                       "allocations": [{ "invoice_id": bill_id, "amount_paise": 200 }] });
    let (status, _) = pay(&app, &desk, "key-0000-0003", past).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);

    let rest = json!({ "patient_id": patient, "method": "cash", "amount_paise": 60_000,
                       "allocations": [{ "invoice_id": bill_id, "amount_paise": 60_000 }] });
    let (status, second) = pay(&app, &desk, "key-0000-0004", rest).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(second["number"].as_str().unwrap().ends_with("/000002"));
    let (_, done) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(done["payment_state"], "paid");
    assert_eq!(done["balance_paise"], 0);

    // A bill with payments can't be voided; voiding a payment brings the balance back.
    let reason = json!({ "reason": "Entered twice" });
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            &format!("{path}/void"),
            Some(&owner),
            Some(reason.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let void_path = format!("/api/v1/payments/{}/void", second["id"].as_str().unwrap());
    let (status, voided) = app
        .send(
            Method::POST,
            ALPHA,
            &void_path,
            Some(&desk),
            Some(reason.clone()),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{voided}");
    assert_eq!(voided["status"], "void");
    let (status, _) = app
        .send(Method::POST, ALPHA, &void_path, Some(&desk), Some(reason))
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (_, after) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(after["payment_state"], "partial");

    let (status, list) = app
        .send(Method::GET, ALPHA, "/api/v1/payments", Some(&desk), None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["items"].as_array().unwrap().len(), 2);
    assert_eq!(
        list["items"][1]["allocations"][0]["invoice_number"],
        bill["number"]
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn a_payment_larger_than_the_balance_due_is_refused() {
    let app = TestApp::start().await;
    let desk = app.token(ALPHA_FRONT_DESK);
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    // A bill of u20b91,000.00.
    let bill = issued_bill(&app, &owner, &patient).await;
    let bill_id = bill["id"].as_str().unwrap();

    // More than the balance is refused, with the field "amount".
    let over = json!({ "patient_id": patient, "method": "cash", "amount_paise": 400_000,
                       "allocations": [{ "invoice_id": bill_id, "amount_paise": 100_000 }] });
    let (status, body) = pay(&app, &desk, "key-over-0001", over).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body["error"]["message"],
        "amount: must not be more than the balance due"
    );
    assert_eq!(body["error"]["code"], "invalid_request");

    // Exactly the balance succeeds, and the bill becomes paid.
    let exact = json!({ "patient_id": patient, "method": "upi", "amount_paise": 100_000,
                        "allocations": [{ "invoice_id": bill_id, "amount_paise": 100_000 }] });
    let (status, paid) = pay(&app, &desk, "key-exact-0002", exact).await;
    assert_eq!(status, StatusCode::CREATED, "{paid}");
    let path = format!("/api/v1/invoices/{bill_id}");
    let (_, done) = app
        .send(Method::GET, ALPHA, &path, Some(&owner), None)
        .await;
    assert_eq!(done["payment_state"], "paid");
    assert_eq!(done["balance_paise"], 0);

    // A second payment after the bill is fully paid is refused.
    let second = json!({ "patient_id": patient, "method": "cash", "amount_paise": 50_000,
                         "allocations": [{ "invoice_id": bill_id, "amount_paise": 50_000 }] });
    let (status, body) = pay(&app, &desk, "key-second-0003", second).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(
        body["error"]["message"],
        "amount: must not be more than the balance due"
    );

    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn drafts_take_no_payments_and_advances_stay_unallocated() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let items = json!([{ "description": "Crown", "unit_price_paise": 800_000 }]);
    let draft = draft(&app, ALPHA, &owner, &patient, items).await;
    let body = json!({ "patient_id": patient, "method": "card", "amount_paise": 100,
                       "allocations": [{ "invoice_id": draft["id"], "amount_paise": 100 }] });
    let (status, _) = pay(&app, &owner, "key-draft-0001", body).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let advance = json!({ "patient_id": patient, "method": "cash", "amount_paise": 500_000 });
    let (status, paid) = pay(&app, &owner, "key-advance-01", advance).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(paid["unallocated_paise"], 500_000);
    // An allocation straight in the database is checked too.
    let sneak = sqlx::query(
        "insert into aarogyam.payment_allocations (org_id, payment_id, invoice_id, patient_id, amount_paise)
         select org_id, id, $2::uuid, patient_id, 100 from aarogyam.payments where id = $1::uuid",
    )
    .bind(paid["id"].as_str().unwrap())
    .bind(draft["id"].as_str().unwrap())
    .execute(&app.owner)
    .await;
    assert!(sneak.unwrap_err().to_string().contains("only issued bills"));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn bills_and_payments_stay_within_the_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let beta = app.token(BETA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let item = price_item(
        &app,
        &owner,
        json!({ "name": "Scaling", "price_paise": 100 }),
    )
    .await;
    let bill = issued_bill(&app, &owner, &patient).await;
    let bill_id = bill["id"].as_str().unwrap();
    let body = json!({ "patient_id": patient, "method": "cash", "amount_paise": 100,
                       "allocations": [{ "invoice_id": bill_id, "amount_paise": 100 }] });
    let (_, paid) = pay(&app, &owner, "key-cross-0001", body).await;
    let payment_id = paid["id"].as_str().unwrap();
    let reason = json!({ "reason": "Not ours" });
    let cases = [
        (Method::GET, format!("/api/v1/invoices/{bill_id}"), None),
        (
            Method::PATCH,
            format!("/api/v1/invoices/{bill_id}"),
            Some(json!({})),
        ),
        (
            Method::POST,
            format!("/api/v1/invoices/{bill_id}/issue"),
            None,
        ),
        (
            Method::POST,
            format!("/api/v1/invoices/{bill_id}/void"),
            Some(reason.clone()),
        ),
        (
            Method::PATCH,
            format!("/api/v1/price-items/{item}"),
            Some(json!({ "price_paise": 1 })),
        ),
        (Method::GET, format!("/api/v1/payments/{payment_id}"), None),
        (
            Method::POST,
            format!("/api/v1/payments/{payment_id}/void"),
            Some(reason),
        ),
        (
            Method::POST,
            "/api/v1/invoices".into(),
            Some(json!({ "patient_id": patient })),
        ),
    ];
    for (method, path, body) in cases {
        let (status, _) = app
            .send(method.clone(), BETA, &path, Some(&beta), body)
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND, "{method} {path}");
    }
    let beta_patient = patient_in_beta(&app, &beta).await;
    let steal = json!({ "patient_id": beta_patient, "method": "cash", "amount_paise": 100,
                        "allocations": [{ "invoice_id": bill_id, "amount_paise": 100 }] });
    let (status, _) = app
        .send_with(
            Method::POST,
            BETA,
            "/api/v1/payments",
            Some(&beta),
            Some(steal),
            &[("idempotency-key", "key-cross-0002")],
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    for path in [
        "/api/v1/invoices",
        "/api/v1/payments",
        "/api/v1/price-items",
    ] {
        let (_, list) = app.send(Method::GET, BETA, path, Some(&beta), None).await;
        assert_eq!(list["items"], json!([]), "{path}");
    }
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn billing_follows_the_role() {
    let app = TestApp::start().await;
    // Roles: an assistant sees no bills; the front desk takes payments but can't price.
    let assistant = app.token(ALPHA_ASSISTANT);
    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/invoices",
            Some(&assistant),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let desk = app.token(ALPHA_FRONT_DESK);
    let (status, _) = app
        .send(
            Method::POST,
            ALPHA,
            "/api/v1/price-items",
            Some(&desk),
            Some(json!({ "name": "X", "price_paise": 1 })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    app.finish().await;
}

async fn patient_in_beta(app: &TestApp, token: &str) -> String {
    patient(app, BETA, token).await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
#[expect(
    clippy::too_many_lines,
    reason = "the reports read the same day's money, so one test"
)]
async fn reports_show_collections_revenue_mix_and_dues() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let patient = patient(&app, ALPHA, &owner).await;
    let rct = json!({ "name": "Root canal", "category": "endodontics", "price_paise": 400_000 });
    let rct = price_item(&app, &owner, rct).await;
    let fresh = draft(
        &app,
        ALPHA,
        &owner,
        &patient,
        json!([{ "price_item_id": rct }]),
    )
    .await;
    let fresh = issue(&app, &owner, fresh["id"].as_str().unwrap()).await;
    // A bill issued 45 days ago, through the use case with that clock.
    let old = draft(
        &app,
        ALPHA,
        &owner,
        &patient,
        json!([{ "description": "Scaling", "unit_price_paise": 100_000 }]),
    )
    .await;
    let old_id = InvoiceId::from_uuid(old["id"].as_str().unwrap().parse().unwrap());
    let then = time::OffsetDateTime::now_utc() - time::Duration::days(45);
    aarogyam_app::billing::issue(&app.api_db(), &owner_actor(&app).await, None, old_id, then)
        .await
        .unwrap();
    let upi = json!({ "patient_id": patient, "method": "upi", "amount_paise": 300_000,
                      "allocations": [{ "invoice_id": fresh["id"], "amount_paise": 300_000 }] });
    assert_eq!(
        pay(&app, &owner, "key-report-001", upi).await.0,
        StatusCode::CREATED
    );
    let cash = json!({ "patient_id": patient, "method": "cash", "amount_paise": 100_000 });
    assert_eq!(
        pay(&app, &owner, "key-report-002", cash).await.0,
        StatusCode::CREATED
    );

    let (status, report) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/reports/collections",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{report}");
    assert_eq!(report["collected_paise"], 400_000);
    assert_eq!(report["by_day"].as_array().unwrap().len(), 7);
    assert_eq!(report["by_day"][6]["amount_paise"], 400_000);
    let upi_share = report["by_method"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["method"] == "upi")
        .unwrap();
    assert_eq!(upi_share["share_bps"], 7_500);
    assert_eq!(
        report["revenue_mix"],
        json!([{ "category": "endodontics", "amount_paise": 400_000, "share_bps": 10_000 }])
    );
    assert_eq!(report["outstanding_paise"], 200_000);

    let (_, pending) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/reports/pending",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(pending["items"].as_array().unwrap().len(), 2);
    assert_eq!(pending["items"][0]["bucket"], "31_60");
    assert_eq!(
        pending["buckets"],
        json!({ "0_30": 100_000, "31_60": 100_000, "61_90": 0, "90_plus": 0 })
    );
    assert_eq!(pending["patients"], 1);

    let (status, money) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/today/money",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{money}");
    assert_eq!(money["collected_paise"], 400_000);
    assert_eq!(money["invoices_today"], 1);
    assert_eq!(money["pending_dues_paise"], 200_000);
    assert_eq!(money["pending_dues_patients"], 1);
    assert_eq!(money["pending"].as_array().unwrap().len(), 2);

    let (status, _) = app
        .send(
            Method::GET,
            ALPHA,
            "/api/v1/reports/collections?from=2026-01-01&to=2025-01-01",
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let desk = app.token(ALPHA_FRONT_DESK);
    for path in [
        "/api/v1/reports/collections",
        "/api/v1/reports/pending",
        "/api/v1/today/money",
    ] {
        let (status, _) = app.send(Method::GET, ALPHA, path, Some(&desk), None).await;
        assert_eq!(status, StatusCode::FORBIDDEN, "{path}");
    }
    let beta = app.token(BETA_OWNER);
    let (_, theirs) = app
        .send(Method::GET, BETA, "/api/v1/today/money", Some(&beta), None)
        .await;
    assert_eq!(
        (
            theirs["collected_paise"].as_i64(),
            theirs["pending_dues_paise"].as_i64()
        ),
        (Some(0), Some(0))
    );
    app.finish().await;
}
