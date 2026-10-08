//! The retention dry run lists records past their class's period, per clinic, and changes
//! nothing. Children stay until 21.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_dal::retention as dal;
use aarogyam_domain::retention::{Class, adult_born_on_or_before};
use axum::http::{Method, StatusCode};
use serde_json::json;
use support::TestApp;
use support::people::ALPHA_OWNER;
use time::OffsetDateTime;

async fn patient(app: &TestApp, name: &str, birth: Option<&str>) -> String {
    let mut body = json!({ "full_name": name });
    if let Some(birth) = birth {
        body["date_of_birth"] = json!(birth);
    }
    let (status, value) = app
        .send(
            Method::POST,
            support::ALPHA,
            "/api/v1/patients",
            Some(&app.token(ALPHA_OWNER)),
            Some(body),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{value}");
    value["id"].as_str().unwrap().to_owned()
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn records_past_retention_are_listed_and_nothing_is_changed() {
    let app = TestApp::start().await;
    let now = OffsetDateTime::now_utc();
    let old_adult = patient(&app, "Old Adult", Some("1960-01-01")).await;
    let old_unknown_age = patient(&app, "Old Unknown", None).await;
    let old_child = patient(&app, "Old Child", Some("2020-01-01")).await;
    let recent = patient(&app, "Recent", Some("1990-01-01")).await;
    // Registered nine years ago, never seen since (the child too: they are under 21).
    // The row trigger keeps created_at honest, so switch it off for the backdating only.
    sqlx::query("alter table aarogyam.patients disable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    for id in [&old_adult, &old_unknown_age, &old_child] {
        sqlx::query("update aarogyam.patients set created_at = now() - interval '9 years' where id = $1::uuid")
            .bind(id)
            .execute(&app.owner)
            .await
            .unwrap();
    }
    sqlx::query("alter table aarogyam.patients enable trigger set_row_meta")
        .execute(&app.owner)
        .await
        .unwrap();
    // A message sent 100 days ago, and one sent yesterday.
    let (alpha,): (uuid::Uuid,) =
        sqlx::query_as("select id from aarogyam.organizations where slug = 'alpha'")
            .fetch_one(&app.owner)
            .await
            .unwrap();
    for days in [100, 1] {
        sqlx::query(
            "insert into aarogyam.outbox_events (org_id, event_key, channel, recipient, status, processed_at)
             values ($1, 'invitation.created', 'email', 'x@example.test', 'sent', now() - make_interval(days => $2))",
        )
        .bind(alpha)
        .bind(days)
        .execute(&app.owner)
        .await
        .unwrap();
    }

    let cutoff = Class::PatientRecord.cutoff(now);
    let groups = dal::patient_records(&app.owner, cutoff, adult_born_on_or_before(now), 10)
        .await
        .unwrap();
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].org_id, Some(alpha));
    assert_eq!(
        groups[0].count, 2,
        "the adult and the one with no birth date"
    );
    let listed: Vec<String> = groups[0].sample.iter().map(ToString::to_string).collect();
    assert!(listed.contains(&old_adult) && listed.contains(&old_unknown_age));
    assert!(!listed.contains(&old_child) && !listed.contains(&recent));
    assert!(groups[0].oldest.is_some());

    let messages = dal::outbox(&app.owner, Class::Outbox.cutoff(now), 10)
        .await
        .unwrap();
    assert_eq!(messages.iter().map(|g| g.count).sum::<i64>(), 1);

    // The sample is capped, and a dry run changes nothing.
    let capped = dal::patient_records(&app.owner, cutoff, adult_born_on_or_before(now), 1)
        .await
        .unwrap();
    assert_eq!(capped[0].sample.len(), 1);
    assert_eq!(capped[0].count, 2);
    let (still_there,): (i64,) = sqlx::query_as("select count(*) from aarogyam.patients")
        .fetch_one(&app.owner)
        .await
        .unwrap();
    assert!(still_there >= 4);

    // Every class runs without error against the schema.
    let report = aarogyam_app::retention::report(&app.owner_db(), now, 3)
        .await
        .unwrap();
    assert_eq!(report.len(), Class::ALL.len());
    app.finish().await;
}
