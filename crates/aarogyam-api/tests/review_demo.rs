//! The review clinic's daily refresh on a real database: it fills the synthetic `review` clinic,
//! a second call adds nothing, and no other clinic (including a lookalike slug) is touched.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_dal::review_demo::refresh;
use support::TestApp;
use time::{Date, Duration, OffsetDateTime};
use uuid::Uuid;

/// A clinic named like the review clinic, with a doctor, made as the schema owner.
async fn make_clinic(app: &TestApp, slug: &str, tag: u128) -> Uuid {
    let mut tx = app.owner.begin().await.unwrap();
    let (org,): (Uuid,) = sqlx::query_as(
        "select app.create_clinic($1, 'Aarogyam Demo Dental', 'AD', 'dental', $2, null)",
    )
    .bind(slug)
    .bind(format!("{slug}.localtest.me"))
    .fetch_one(&mut *tx)
    .await
    .unwrap();
    sqlx::query("select set_config('app.tenant_id', $1, true)")
        .bind(org.to_string())
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("update aarogyam.organizations set status = 'active', legal_name = 'Aarogyam Demo Dental' where id = $1")
        .bind(org)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("update aarogyam.branches set phone_e164 = '+919000009000' where org_id = $1 and is_default")
        .bind(org)
        .execute(&mut *tx)
        .await
        .unwrap();
    let user = Uuid::from_u128(0xd0_0000 + tag);
    let member = Uuid::from_u128(0xd1_0000 + tag);
    sqlx::query("insert into aarogyam.users (id, auth_uid, display_name, email) values ($1, $2, 'Dr Demo', $3)")
        .bind(user)
        .bind(Uuid::from_u128(0xd2_0000 + tag))
        .bind(format!("demo{tag}@example.com"))
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("insert into aarogyam.memberships (id, org_id, user_id, role_id, status) select $1, $2, $3, id, 'active' from aarogyam.roles where org_id = $2 and key = 'doctor'")
        .bind(member)
        .bind(org)
        .bind(user)
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("insert into aarogyam.practitioners (membership_id, display_name, registration_number) values ($1, 'Dr Demo', 'A-1')")
        .bind(member)
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    org
}

/// Patients, tokens, appointments, closed visits, system audit rows in one clinic.
async fn counts(app: &TestApp, org: Uuid) -> [i64; 5] {
    let row: (i64, i64, i64, i64, i64) = sqlx::query_as(
        "select (select count(*) from aarogyam.patients where org_id = $1),
                (select count(*) from aarogyam.queue_tokens where org_id = $1),
                (select count(*) from aarogyam.appointments where org_id = $1),
                (select count(*) from aarogyam.encounters where org_id = $1 and status = 'closed'),
                (select count(*) from audit.audit_events where org_id = $1 and actor_kind = 'system')",
    )
    .bind(org)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    [row.0, row.1, row.2, row.3, row.4]
}

#[tokio::test]
#[ignore = "needs a Postgres server (DATABASE_URL)"]
async fn refresh_fills_the_review_clinic_once_and_touches_no_other() {
    let app = TestApp::start().await;
    let review = make_clinic(&app, "review", 1).await;
    let lookalike = make_clinic(&app, "review-two", 2).await;
    let alpha = app.clinic_id("alpha").await;
    let alpha_before = counts(&app, alpha).await;
    let lookalike_before = counts(&app, lookalike).await;
    // A day well in the past: the queue is not held back by the clinic's opening time.
    let today: Date = (OffsetDateTime::now_utc() + Duration::hours(5) - Duration::days(3)).date();
    let pool = app.api_db();

    let first = refresh(pool.pool(), today).await.unwrap().unwrap();
    assert_eq!(first.org_id, review);
    assert_eq!((first.patients, first.visits, first.tokens), (10, 3, 5));
    assert!(first.appointments >= 5);
    let after = counts(&app, review).await;
    assert!(
        after[0] >= 10 && after[1] == 5 && after[2] >= 5 && after[3] >= 3,
        "{after:?}"
    );
    assert!(after[4] > 0, "audited as system");
    let (statuses,): (i64,) = sqlx::query_as(
        "select count(distinct status) from aarogyam.queue_tokens where org_id = $1 and day = $2",
    )
    .bind(review)
    .bind(today)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(statuses, 4, "waiting, in_chair, ready_to_bill, done");
    let (phones,): (i64,) = sqlx::query_as(
        "select count(*) from aarogyam.patients where org_id = $1 and phone_e164 ~ '^\\+9198[0-9]{8}$'",
    )
    .bind(review)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!(phones, 10);

    let second = refresh(pool.pool(), today).await.unwrap().unwrap();
    assert!(!second.any(), "{second:?}");
    assert_eq!(counts(&app, review).await, after);

    // Another clinic, and one named the same but under another slug, are left alone.
    assert_eq!(counts(&app, alpha).await, alpha_before);
    assert_eq!(counts(&app, lookalike).await, lookalike_before);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs a Postgres server (DATABASE_URL)"]
async fn refresh_does_nothing_without_a_review_clinic() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let before = counts(&app, alpha).await;
    let today = OffsetDateTime::now_utc().date();
    assert!(refresh(app.api_db().pool(), today).await.unwrap().is_none());
    assert_eq!(counts(&app, alpha).await, before);
    app.finish().await;
}
