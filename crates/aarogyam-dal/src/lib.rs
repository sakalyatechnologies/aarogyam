//! Aarogyam's data access: SQL queries, row mapping and the database migrations.
//!
//! Migrations live in `db/migrations/` at the repository root, one `<version>_<name>.sql` file
//! each, and are embedded in the binary at compile time, so a deployed image always carries the
//! schema it expects. They are append-only: never edit a merged migration.
//!
//! Queries on clinic data run inside a scoped transaction (`ClinicTx`), never on the bare pool.

use sqlx::migrate::Migrator;

pub mod access;
pub mod analytics;
pub mod applications;
pub mod appointments;
pub mod attachments;
pub mod billing;
pub mod booking;
pub mod chart;
pub mod clinic;
pub mod consents;
pub mod console;
pub mod dental_terms;
pub mod edge;
pub mod erasure;
pub mod expenses;
pub mod facts;
pub mod handoff;
pub mod identifiers;
pub mod import_sessions;
pub mod imports;
pub mod inventory;
pub mod invitations;
pub mod json;
pub mod legal_hold;
pub mod lookups;
pub mod notifications;
pub mod outbox;
pub mod patient_app;
pub mod patient_notes;
pub mod patient_sessions;
pub mod patients;
pub mod prescriptions;
pub mod queue;
pub mod recalls;
pub mod retention;
pub mod roles;
pub mod schedule;
pub mod sessions;
pub mod settings;
pub mod setup;
pub mod staff;
pub mod support;
pub mod support_grants;
pub mod timeline;
pub mod today;
pub mod treatment;
pub mod visits;
pub mod vitals;
pub mod website;
use sqlx::{Executor as _, PgPool};

/// The migrations in `db/migrations/`, embedded at compile time.
static MIGRATOR: Migrator = sqlx::migrate!("../../db/migrations");

/// Applies every pending migration in version order.
///
/// Run it as the schema owner: the API's login role must not be able to change the schema.
/// A Postgres advisory lock stops two instances from migrating at the same time, and
/// migrations that already ran are skipped, so running it again is safe. Returns how many
/// migrations this call applied.
///
/// # Errors
///
/// Returns [`MigrateError`] if the database is unreachable, a migration fails (its changes are
/// rolled back), or a migration that already ran has since been edited.
pub async fn migrate(pool: &PgPool) -> Result<u64, MigrateError> {
    let mut conn = pool
        .acquire()
        .await
        .map_err(sqlx::migrate::MigrateError::from)?;
    // sqlx keeps its ledger (`_sqlx_migrations`) in the first schema on the search path. Keep
    // it in `private`, out of `public`, which Supabase exposes through its Data API.
    conn.execute("create schema if not exists private; set search_path to private")
        .await
        .map_err(sqlx::migrate::MigrateError::from)?;
    let before = ledger_count(&mut conn).await?;
    MIGRATOR.run(&mut *conn).await?;
    let after = ledger_count(&mut conn).await?;
    Ok(after.saturating_sub(before))
}

/// How many migrations the ledger records (0 before the ledger exists).
async fn ledger_count(conn: &mut sqlx::PgConnection) -> Result<u64, MigrateError> {
    let exists: bool =
        sqlx::query_scalar("select to_regclass('private._sqlx_migrations') is not null")
            .fetch_one(&mut *conn)
            .await
            .map_err(sqlx::migrate::MigrateError::from)?;
    if !exists {
        return Ok(0);
    }
    let count: i64 = sqlx::query_scalar("select count(*) from private._sqlx_migrations")
        .fetch_one(&mut *conn)
        .await
        .map_err(sqlx::migrate::MigrateError::from)?;
    Ok(u64::try_from(count).unwrap_or(0))
}

/// The database migrations could not be applied.
#[derive(Debug, thiserror::Error)]
#[error("database migration failed")]
pub struct MigrateError {
    #[from]
    source: sqlx::migrate::MigrateError,
}
