//! Sakalya platform staff: grant, revoke, list, and their separation from clinic accounts.
//!
//! Run with `DATABASE_URL=postgres://localhost:5432/postgres cargo test -p aarogyam-dal -- --include-ignored`.

use aarogyam_dal::console::{PlatformError, grant_platform, list_platform, revoke_platform};
use aarogyam_dal::invitations::{Acceptance, accept};
use sqlx::PgPool;
use uuid::Uuid;

async fn grant(pool: &PgPool, email: &str, role: &str) -> Result<Uuid, PlatformError> {
    grant_platform(pool, Uuid::now_v7(), email, "Staff", role).await
}

#[expect(clippy::unwrap_used, reason = "test setup")]
/// A clinic `alpha` with `owner@alpha.test` as an active member.
async fn clinic_with_member(pool: &PgPool, auth_uid: Uuid) {
    sqlx::query(
        "insert into aarogyam.users (id, auth_uid, email, display_name)
         values ('01900000-0000-7000-8000-0000000000a1', $1, 'owner@alpha.test', 'Asha')",
    )
    .bind(auth_uid)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "select app.create_clinic('alpha', 'Alpha', 'AD', 'dental', 'alpha.localtest.me',
                                  '01900000-0000-7000-8000-0000000000a1')",
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn grant_list_and_revoke(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    grant(&pool, "founder@sakalya.test", "owner").await.unwrap();
    grant(&pool, "help@sakalya.test", "support").await.unwrap();
    let staff = list_platform(&pool).await.unwrap();
    assert_eq!(staff.len(), 2);
    assert_eq!(staff[0].role, "owner");
    assert!(staff.iter().all(|s| s.active));

    revoke_platform(&pool, "Help@Sakalya.test").await.unwrap();
    let staff = list_platform(&pool).await.unwrap();
    assert!(!staff.iter().find(|s| s.role == "support").unwrap().active);
    assert!(matches!(
        revoke_platform(&pool, "help@sakalya.test").await,
        Err(PlatformError::NotStaff)
    ));

    // Granting again re-activates and changes the role; the change is audited.
    let auth_uid = Uuid::now_v7();
    grant_platform(&pool, auth_uid, "help@sakalya.test", "Help", "analyst")
        .await
        .unwrap();
    let audited: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_events where table_name = 'aarogyam.platform_users'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(audited >= 3, "{audited}");
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn the_last_owner_cannot_be_removed(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    let auth_uid = Uuid::now_v7();
    grant_platform(&pool, auth_uid, "a@sakalya.test", "A", "owner")
        .await
        .unwrap();
    assert!(matches!(
        revoke_platform(&pool, "a@sakalya.test").await,
        Err(PlatformError::LastOwner)
    ));
    assert!(matches!(
        grant_platform(&pool, auth_uid, "a@sakalya.test", "A", "support").await,
        Err(PlatformError::LastOwner)
    ));
    // With a second owner the first can go.
    grant(&pool, "b@sakalya.test", "owner").await.unwrap();
    revoke_platform(&pool, "a@sakalya.test").await.unwrap();
    assert!(matches!(
        revoke_platform(&pool, "b@sakalya.test").await,
        Err(PlatformError::LastOwner)
    ));
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn clinic_members_cannot_be_granted_platform_access(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    let auth_uid = Uuid::now_v7();
    clinic_with_member(&pool, auth_uid).await;
    let refused = grant_platform(&pool, auth_uid, "owner@alpha.test", "Asha", "support").await;
    assert!(
        matches!(refused, Err(PlatformError::ClinicMember)),
        "{refused:?}"
    );
    assert!(list_platform(&pool).await.unwrap().is_empty());

    // The reverse is refused by the database too: staff can't be given a membership.
    let staff = grant(&pool, "founder@sakalya.test", "owner").await.unwrap();
    let joined = sqlx::query(
        "insert into aarogyam.memberships (org_id, user_id, role_id, status)
         select o.id, $1, r.id, 'active' from aarogyam.organizations o
         join aarogyam.roles r on r.org_id = o.id and r.key = 'owner' where o.slug = 'alpha'",
    )
    .bind(staff)
    .execute(&pool)
    .await;
    assert!(joined.is_err());
}

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn platform_staff_cannot_accept_a_clinic_invitation(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
    clinic_with_member(&pool, Uuid::now_v7()).await;
    let auth_uid = Uuid::now_v7();
    grant_platform(&pool, auth_uid, "founder@sakalya.test", "Founder", "owner")
        .await
        .unwrap();
    sqlx::query(
        "insert into aarogyam.invitations (org_id, email, role_id, token_hash, expires_at)
         select o.id, 'founder@sakalya.test', r.id, repeat('a', 64), now() + interval '1 day'
         from aarogyam.organizations o
         join aarogyam.roles r on r.org_id = o.id and r.key = 'owner' where o.slug = 'alpha'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let outcome = accept(
        &pool,
        &"a".repeat(64),
        auth_uid,
        "founder@sakalya.test",
        None,
    )
    .await
    .unwrap();
    assert_eq!(outcome, Acceptance::PlatformStaff);
    let members: i64 = sqlx::query_scalar(
        "select count(*) from aarogyam.memberships m join aarogyam.users u on u.id = m.user_id
         where u.auth_uid = $1",
    )
    .bind(auth_uid)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(members, 0);
}
