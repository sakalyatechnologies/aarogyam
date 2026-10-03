//! Aarogyam's data access: SQL queries, row mapping and the database migrations.
//!
//! Migrations live in `db/migrations/` at the repository root, one `<version>_<name>.sql` file
//! each, and are embedded in the binary at compile time, so a deployed image always carries the
//! schema it expects. They are append-only: never edit a merged migration.
//!
//! Queries on clinic data run inside a scoped transaction (`ClinicTx`), never on the bare pool.

use sqlx::PgPool;
use sqlx::migrate::Migrator;

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
    MIGRATOR.run(pool).await?;
    Ok(())
}

/// The database migrations could not be applied.
#[derive(Debug, thiserror::Error)]
#[error("database migration failed")]
pub struct MigrateError {
    #[from]
    source: sqlx::migrate::MigrateError,
}
