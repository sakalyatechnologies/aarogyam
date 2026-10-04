//! Aarogyam's data access: SQL queries, row mapping and the database migrations.
//!
//! Migrations live in `db/migrations/` at the repository root, one `<version>_<name>.sql` file
//! each, and are embedded in the binary at compile time, so a deployed image always carries the
//! schema it expects. They are append-only: never edit a merged migration.
//!
//! Queries on clinic data run inside a scoped transaction (`ClinicTx`), never on the bare pool.

use sqlx::migrate::Migrator;

pub mod clinic;
pub mod console;
pub mod invitations;
pub mod lookups;
pub mod outbox;
pub mod patients;
pub mod sessions;
pub mod settings;
pub mod staff;
use sqlx::{Executor as _, PgPool};

/// The migrations in `db/migrations/`, embedded at compile time.
static MIGRATOR: Migrator = sqlx::migrate!("../../db/migrations");

/// Applies every pending migration in version order.
///
/// Run it as the schema owner: the API's login role must not be able to change the schema.
/// A Postgres advisory lock stops two instances from migrating at the same time, and
/// migrations that already ran are skipped, so running it again is safe.
///
/// # Errors
///
/// Returns [`MigrateError`] if the database is unreachable, a migration fails (its changes are
/// rolled back), or a migration that already ran has since been edited.
pub async fn migrate(pool: &PgPool) -> Result<(), MigrateError> {
    let mut conn = pool
        .acquire()
        .await
        .map_err(sqlx::migrate::MigrateError::from)?;
    // sqlx keeps its ledger (`_sqlx_migrations`) in the first schema on the search path. Keep
    // it in `private`, out of `public`, which Supabase exposes through its Data API.
    conn.execute("create schema if not exists private; set search_path to private")
        .await
        .map_err(sqlx::migrate::MigrateError::from)?;
    MIGRATOR.run(&mut *conn).await?;
    Ok(())
}

/// The database migrations could not be applied.
#[derive(Debug, thiserror::Error)]
#[error("database migration failed")]
pub struct MigrateError {
    #[from]
    source: sqlx::migrate::MigrateError,
}
