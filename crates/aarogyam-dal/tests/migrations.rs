//! The embedded migrations, against a real Postgres.
//!
//! Run with `DATABASE_URL=postgres://localhost:5432/postgres cargo test -p aarogyam-dal -- --include-ignored`.
//! Each test gets a fresh, empty database from `#[sqlx::test]`.

use sqlx::PgPool;

#[sqlx::test(migrations = false)]
#[ignore = "needs DATABASE_URL"]
async fn migrations_apply_to_an_empty_database(pool: PgPool) {
    aarogyam_dal::migrate(&pool).await.unwrap();
}
