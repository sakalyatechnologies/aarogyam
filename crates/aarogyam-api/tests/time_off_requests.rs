//! Time-off requests and the staff-operations settings, on a real database: the leave block an
//! approval makes and a cancellation removes, what other staff may see, what blocks online
//! booking, the window rules, and the settings route.
#![expect(
    clippy::unwrap_used,
    reason = "tests fail loudly instead of returning errors"
)]

mod support;

use aarogyam_dal::time_off::{self as dal, NewTimeOff, TimeOffRow, Viewer};
use aarogyam_dal::{appointments, booking};
use aarogyam_domain::time_off::{Kind, Window};
use axum::http::{Method, StatusCode};
use sakalya_db::{ActorKind, DbError, DbErrorKind, Scope};
use serde_json::{Value, json};
use support::people::*;
use support::{ALPHA, BETA, TestApp};
use time::OffsetDateTime;
use time::macros::{date, datetime};
use uuid::Uuid;

/// A clinic transaction as staff of `clinic` (a seeded slug), through the API's login role.
fn scope(clinic: Uuid) -> Scope {
    Scope::tenant(clinic).with_actor_kind(ActorKind::new("staff").unwrap())
}

async fn member(app: &TestApp, clinic: Uuid, auth_uid: Uuid) -> Uuid {
    sqlx::query_scalar(
        "select m.id from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
         where m.org_id = $1 and u.auth_uid = $2",
    )
    .bind(clinic)
    .bind(auth_uid)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

/// Gives a member a practitioner row, like a doctor has.
async fn make_doctor(app: &TestApp, clinic: Uuid, membership: Uuid) -> Uuid {
    sqlx::query_scalar(
        "insert into aarogyam.practitioners (org_id, membership_id, display_name)
         values ($1, $2, 'Dr Test') returning id",
    )
    .bind(clinic)
    .bind(membership)
    .fetch_one(&app.owner)
    .await
    .unwrap()
}

async fn blocks(app: &TestApp, clinic: Uuid) -> Vec<(Uuid, String)> {
    sqlx::query_as("select id, reason from aarogyam.leave_blocks where org_id = $1")
        .bind(clinic)
        .fetch_all(&app.owner)
        .await
        .unwrap()
}

const FROM: OffsetDateTime = datetime!(2030-03-01 00:00 UTC);
const TO: OffsetDateTime = datetime!(2030-03-31 00:00 UTC);
const DAY_START: OffsetDateTime = datetime!(2030-03-10 04:00 UTC);
const DAY_END: OffsetDateTime = datetime!(2030-03-10 12:00 UTC);

async fn create(
    app: &TestApp,
    clinic: Uuid,
    membership: Uuid,
    window: Window,
    reason: Option<&str>,
) -> Result<TimeOffRow, DbError> {
    app.api_db()
        .scoped(&scope(clinic), async |tx| {
            dal::create(
                tx.conn(),
                &NewTimeOff {
                    membership_id: membership,
                    kind: Kind::Sick,
                    window,
                    reason,
                },
            )
            .await
        })
        .await
}

fn timed() -> Window {
    Window::Timed {
        starts_at: DAY_START,
        ends_at: DAY_END,
    }
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn approving_makes_a_generic_leave_block_and_cancelling_removes_it() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let owner = member(&app, alpha, ALPHA_OWNER).await;
    let doctor = make_doctor(&app, alpha, owner).await;
    let db = app.api_db();

    let pending = create(&app, alpha, owner, timed(), Some("migraine"))
        .await
        .unwrap();
    assert_eq!(pending.status, "pending");
    assert_eq!(pending.leave_block_id, None);
    assert_eq!(blocks(&app, alpha).await.len(), 0);

    let approved = db
        .scoped(&scope(alpha), async |tx| {
            dal::approve(tx.conn(), pending.id, owner, Some("get well")).await
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(approved.status, "approved");
    assert_eq!(approved.decided_by, Some(owner));
    let block = approved.leave_block_id.unwrap();
    // The block carries the generic reason, never the request's own.
    assert_eq!(blocks(&app, alpha).await, [(block, "Time off".to_owned())]);
    let (starts, ends, practitioner): (OffsetDateTime, OffsetDateTime, Uuid) = sqlx::query_as(
        "select starts_at, ends_at, practitioner_id from aarogyam.leave_blocks where id = $1",
    )
    .bind(block)
    .fetch_one(&app.owner)
    .await
    .unwrap();
    assert_eq!((starts, ends, practitioner), (DAY_START, DAY_END, doctor));

    // A second decision on the same request does nothing, and makes no second block.
    db.scoped(&scope(alpha), async |tx| {
        assert!(
            dal::approve(tx.conn(), pending.id, owner, None)
                .await?
                .is_none()
        );
        assert!(
            dal::decline(tx.conn(), pending.id, owner, None)
                .await?
                .is_none()
        );
        Ok::<(), DbError>(())
    })
    .await
    .unwrap();
    assert_eq!(blocks(&app, alpha).await.len(), 1);

    let cancelled = db
        .scoped(&scope(alpha), async |tx| {
            dal::cancel(tx.conn(), pending.id).await
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(cancelled.status, "cancelled");
    assert_eq!(cancelled.leave_block_id, None);
    assert_eq!(blocks(&app, alpha).await.len(), 0);
    db.scoped(&scope(alpha), async |tx| {
        assert!(dal::cancel(tx.conn(), pending.id).await?.is_none());
        Ok::<(), DbError>(())
    })
    .await
    .unwrap();
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn an_assistant_without_a_practitioner_row_gets_no_block_but_is_listed() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let owner = member(&app, alpha, ALPHA_OWNER).await;
    let assistant = member(&app, alpha, ALPHA_ASSISTANT).await;
    let desk = member(&app, alpha, ALPHA_FRONT_DESK).await;
    let request = create(&app, alpha, assistant, timed(), Some("family"))
        .await
        .unwrap();
    let db = app.api_db();
    let approved = db
        .scoped(&scope(alpha), async |tx| {
            dal::approve(tx.conn(), request.id, owner, None).await
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(approved.status, "approved");
    assert_eq!(approved.leave_block_id, None);
    assert_eq!(blocks(&app, alpha).await.len(), 0);

    // Everyone sees that the assistant is away, and when.
    let listed = db
        .scoped(&scope(alpha), async |tx| {
            let viewer = Viewer {
                membership_id: desk,
                manages: false,
            };
            dal::list(tx.conn(), viewer, FROM, TO).await
        })
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].membership_id, listed[0].starts_at),
        (assistant, DAY_START)
    );
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn only_approved_time_off_blocks_online_booking() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let owner = member(&app, alpha, ALPHA_OWNER).await;
    let doctor_member = member(&app, alpha, ALPHA_FRONT_DESK).await;
    let doctor = make_doctor(&app, alpha, doctor_member).await;
    let db = app.api_db();
    let away = |app_db: &sakalya_db::Db| {
        let app_db = app_db.clone();
        async move {
            app_db
                .scoped(&scope(alpha), async |tx| {
                    let spans = appointments::leave_spans(tx.conn(), doctor, FROM, TO).await?;
                    let day = booking::doctor_day(tx.conn(), doctor, FROM, TO).await?;
                    assert_eq!(spans.len(), day.leave.len());
                    Ok::<_, DbError>(spans.len())
                })
                .await
                .unwrap()
        }
    };

    let pending = create(&app, alpha, doctor_member, timed(), None)
        .await
        .unwrap();
    assert_eq!(away(&db).await, 0, "pending");
    let declined = db
        .scoped(&scope(alpha), async |tx| {
            dal::decline(tx.conn(), pending.id, owner, Some("clinic is short")).await
        })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (declined.status.as_str(), declined.leave_block_id),
        ("declined", None)
    );
    assert_eq!(away(&db).await, 0, "declined");

    let second = create(&app, alpha, doctor_member, timed(), None)
        .await
        .unwrap();
    assert_eq!(away(&db).await, 0, "pending again");
    db.scoped(&scope(alpha), async |tx| {
        dal::approve(tx.conn(), second.id, owner, None).await
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(away(&db).await, 1, "approved");
    db.scoped(&scope(alpha), async |tx| {
        dal::cancel(tx.conn(), second.id).await
    })
    .await
    .unwrap()
    .unwrap();
    assert_eq!(away(&db).await, 0, "cancelled");
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn kind_reason_and_open_requests_are_private() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let owner = member(&app, alpha, ALPHA_OWNER).await;
    let assistant = member(&app, alpha, ALPHA_ASSISTANT).await;
    let desk = member(&app, alpha, ALPHA_FRONT_DESK).await;
    let db = app.api_db();
    let approved = create(&app, alpha, assistant, timed(), Some("surgery"))
        .await
        .unwrap();
    let pending = create(
        &app,
        alpha,
        assistant,
        Window::Timed {
            starts_at: datetime!(2030-03-20 04:00 UTC),
            ends_at: datetime!(2030-03-20 12:00 UTC),
        },
        Some("wedding"),
    )
    .await
    .unwrap();
    let declined = create(
        &app,
        alpha,
        owner,
        Window::Timed {
            starts_at: datetime!(2030-03-22 04:00 UTC),
            ends_at: datetime!(2030-03-22 12:00 UTC),
        },
        Some("rest"),
    )
    .await
    .unwrap();
    db.scoped(&scope(alpha), async |tx| {
        dal::approve(tx.conn(), approved.id, owner, Some("ok")).await?;
        dal::decline(tx.conn(), declined.id, owner, Some("busy week")).await?;
        Ok::<(), DbError>(())
    })
    .await
    .unwrap();

    let view = |membership: Uuid, manages: bool| {
        let db = db.clone();
        async move {
            db.scoped(&scope(alpha), async |tx| {
                dal::list(
                    tx.conn(),
                    Viewer {
                        membership_id: membership,
                        manages,
                    },
                    FROM,
                    TO,
                )
                .await
            })
            .await
            .unwrap()
        }
    };

    // Other staff: the approved window and the person only.
    let others = view(desk, false).await;
    assert_eq!(others.len(), 1);
    let seen = &others[0];
    assert_eq!(
        (seen.id, seen.membership_id, seen.status.as_str()),
        (approved.id, assistant, "approved")
    );
    assert!(seen.kind.is_none() && seen.reason.is_none() && seen.decision_note.is_none());
    assert!(seen.decided_by.is_none() && seen.decided_at.is_none());

    // The requester sees all of their own, in full, but not the owner's declined one.
    let own = view(assistant, false).await;
    assert_eq!(own.len(), 2);
    assert_eq!(own[0].reason.as_deref(), Some("surgery"));
    assert_eq!(own[0].kind.as_deref(), Some("sick"));
    assert_eq!(own[0].decision_note.as_deref(), Some("ok"));
    assert_eq!(
        (own[1].id, own[1].reason.as_deref()),
        (pending.id, Some("wedding"))
    );

    // A time_off.manage holder sees everything that is not cancelled.
    let all = view(owner, true).await;
    assert_eq!(all.len(), 3);
    assert!(
        all.iter()
            .all(|row| row.kind.is_some() && row.reason.is_some())
    );

    // Cancelled requests are for nobody, and the reason never reached the leave block.
    db.scoped(&scope(alpha), async |tx| {
        dal::cancel(tx.conn(), pending.id).await
    })
    .await
    .unwrap();
    assert_eq!(view(owner, true).await.len(), 2);
    assert_eq!(view(assistant, false).await.len(), 1);
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn windows_are_checked_and_whole_days_become_local_midnights() {
    let app = TestApp::start().await;
    let alpha = app.clinic_id("alpha").await;
    let owner = member(&app, alpha, ALPHA_OWNER).await;

    // starts_at < ends_at, at most 366 days.
    for (starts_at, ends_at) in [
        (DAY_START, DAY_START),
        (DAY_END, DAY_START),
        (
            DAY_START,
            DAY_START + time::Duration::days(366) + time::Duration::seconds(1),
        ),
    ] {
        let error = create(
            &app,
            alpha,
            owner,
            Window::Timed { starts_at, ends_at },
            None,
        )
        .await
        .unwrap_err();
        assert_eq!(error.kind(), DbErrorKind::Invalid, "{error}");
    }
    create(
        &app,
        alpha,
        owner,
        Window::Timed {
            starts_at: DAY_START,
            ends_at: DAY_START + time::Duration::days(366),
        },
        None,
    )
    .await
    .unwrap();

    // The clinic's zone decides where a day starts: India first (UTC+5:30, no daylight saving).
    sqlx::query("update aarogyam.organizations set timezone = 'Asia/Kolkata' where id = $1")
        .bind(alpha)
        .execute(&app.owner)
        .await
        .unwrap();
    let india = create(
        &app,
        alpha,
        owner,
        Window::AllDay {
            first_day: date!(2030 - 03 - 10),
            last_day: date!(2030 - 03 - 11),
        },
        None,
    )
    .await
    .unwrap();
    assert!(india.all_day);
    assert_eq!(india.starts_at, datetime!(2030-03-09 18:30 UTC));
    assert_eq!(india.ends_at, datetime!(2030-03-11 18:30 UTC));

    // A zone with daylight saving: 3 Nov 2030 is the 25-hour day the clocks go back.
    sqlx::query("update aarogyam.organizations set timezone = 'America/New_York' where id = $1")
        .bind(alpha)
        .execute(&app.owner)
        .await
        .unwrap();
    let new_york = create(
        &app,
        alpha,
        owner,
        Window::AllDay {
            first_day: date!(2030 - 11 - 03),
            last_day: date!(2030 - 11 - 03),
        },
        None,
    )
    .await
    .unwrap();
    assert_eq!(new_york.starts_at, datetime!(2030-11-03 04:00 UTC));
    assert_eq!(new_york.ends_at, datetime!(2030-11-04 05:00 UTC));

    // The longest whole-day request still fits the table's checks, daylight saving or not.
    let year = create(
        &app,
        alpha,
        owner,
        Window::AllDay {
            first_day: date!(2030 - 01 - 01),
            last_day: date!(2030 - 12 - 31),
        },
        None,
    )
    .await
    .unwrap();
    assert!(year.ends_at - year.starts_at <= time::Duration::days(366));
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn another_clinic_sees_and_changes_nothing() {
    let app = TestApp::start().await;
    let (alpha, beta) = (app.clinic_id("alpha").await, app.clinic_id("beta").await);
    let owner = member(&app, alpha, ALPHA_OWNER).await;
    let beta_owner = member(&app, beta, BETA_OWNER).await;
    make_doctor(&app, alpha, owner).await;
    let request = create(&app, alpha, owner, timed(), Some("private"))
        .await
        .unwrap();
    let db = app.api_db();
    db.scoped(&scope(beta), async |tx| {
        assert!(dal::get(tx.conn(), request.id).await?.is_none());
        let viewer = Viewer {
            membership_id: beta_owner,
            manages: true,
        };
        assert!(dal::list(tx.conn(), viewer, FROM, TO).await?.is_empty());
        assert!(
            dal::approve(tx.conn(), request.id, beta_owner, None)
                .await?
                .is_none()
        );
        assert!(
            dal::decline(tx.conn(), request.id, beta_owner, None)
                .await?
                .is_none()
        );
        assert!(dal::cancel(tx.conn(), request.id).await?.is_none());
        Ok::<(), DbError>(())
    })
    .await
    .unwrap();
    // Nor can Beta file a request for one of Alpha's members.
    let error = create(&app, beta, owner, timed(), None).await.unwrap_err();
    assert_eq!(error.kind(), DbErrorKind::Conflict, "{error}");
    let (status,): (String,) =
        sqlx::query_as("select status from aarogyam.time_off_requests where id = $1")
            .bind(request.id)
            .fetch_one(&app.owner)
            .await
            .unwrap();
    assert_eq!(status, "pending");
    app.finish().await;
}

async fn settings(
    app: &TestApp,
    host: &str,
    token: &str,
    method: Method,
    body: Option<Value>,
) -> (StatusCode, Value) {
    app.send(
        method,
        host,
        "/api/v1/settings/staff-ops",
        Some(token),
        body,
    )
    .await
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_ops_settings_default_change_and_validate() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    let (status, defaults) = settings(&app, ALPHA, &owner, Method::GET, None).await;
    assert_eq!(status, StatusCode::OK, "{defaults}");
    assert_eq!(
        defaults,
        json!({ "time_off": { "requires_approval": true }, "tasks": { "remind_every_minutes": 60 } })
    );

    let (status, changed) = settings(
        &app,
        ALPHA,
        &owner,
        Method::PATCH,
        Some(json!({ "time_off": { "requires_approval": false } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["time_off"]["requires_approval"], false);
    assert_eq!(changed["tasks"]["remind_every_minutes"], 60);
    let (_, changed) = settings(
        &app,
        ALPHA,
        &owner,
        Method::PATCH,
        Some(json!({ "tasks": { "remind_every_minutes": 15 } })),
    )
    .await;
    assert_eq!(
        changed,
        json!({ "time_off": { "requires_approval": false }, "tasks": { "remind_every_minutes": 15 } })
    );
    let (_, read) = settings(&app, ALPHA, &owner, Method::GET, None).await;
    assert_eq!(read, changed);
    // The other keys of the stored object are not disturbed, and the edge values are fine.
    let (status, _) = settings(
        &app,
        ALPHA,
        &owner,
        Method::PATCH,
        Some(json!({ "tasks": { "remind_every_minutes": 1440 } })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    for body in [
        json!({ "tasks": { "remind_every_minutes": 14 } }),
        json!({ "tasks": { "remind_every_minutes": 1441 } }),
        json!({ "tasks": { "remind_every_minutes": 0 } }),
        json!({ "tasks": { "remind_every_minutes": -60 } }),
    ] {
        let (status, error) =
            settings(&app, ALPHA, &owner, Method::PATCH, Some(body.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}: {error}");
    }
    for body in [
        json!({ "tasks": { "remind_every_minutes": "soon" } }),
        json!({ "time_off": { "requires_approval": "yes" } }),
        json!({ "colour": "red" }),
    ] {
        let (status, _) = settings(&app, ALPHA, &owner, Method::PATCH, Some(body.clone())).await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
    }
    let (_, kept) = settings(&app, ALPHA, &owner, Method::GET, None).await;
    assert_eq!(kept["tasks"]["remind_every_minutes"], 1440);

    // The table refuses a value the API would, even written directly.
    let alpha = app.clinic_id("alpha").await;
    let direct = sqlx::query(
        r#"update aarogyam.org_settings set staff_ops = '{"tasks": {"remind_every_minutes": 5}}'
           where org_id = $1"#,
    )
    .bind(alpha)
    .execute(&app.owner)
    .await;
    assert!(direct.is_err());
    app.finish().await;
}

#[tokio::test]
#[ignore = "needs DATABASE_URL"]
async fn staff_ops_settings_need_settings_manage_and_stay_in_their_clinic() {
    let app = TestApp::start().await;
    let owner = app.token(ALPHA_OWNER);
    for who in [ALPHA_FRONT_DESK, ALPHA_ASSISTANT, ALPHA_NOTHING] {
        let token = app.token(who);
        let (status, _) = settings(&app, ALPHA, &token, Method::GET, None).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        let (status, _) = settings(&app, ALPHA, &token, Method::PATCH, Some(json!({}))).await;
        assert_eq!(status, StatusCode::FORBIDDEN);
    }
    let (status, _) = app
        .send(Method::GET, ALPHA, "/api/v1/settings/staff-ops", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Beta's owner gets 404 on Alpha's host, can't change it, and changes only their own.
    let beta = app.token(BETA_OWNER);
    let (status, _) = settings(&app, ALPHA, &beta, Method::GET, None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let body = json!({ "time_off": { "requires_approval": false } });
    let (status, _) = settings(&app, ALPHA, &beta, Method::PATCH, Some(body.clone())).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, alpha) = settings(&app, ALPHA, &owner, Method::GET, None).await;
    assert_eq!(alpha["time_off"]["requires_approval"], true);
    let (status, _) = settings(&app, BETA, &beta, Method::PATCH, Some(body)).await;
    assert_eq!(status, StatusCode::OK);
    let (_, alpha) = settings(&app, ALPHA, &owner, Method::GET, None).await;
    assert_eq!(alpha["time_off"]["requires_approval"], true);
    app.finish().await;
}
