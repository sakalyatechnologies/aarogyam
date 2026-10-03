//! Rebuilds this crate when a migration is added or changed, because `sqlx::migrate!` embeds
//! the files at compile time and Cargo does not otherwise watch them.

fn main() {
    println!("cargo::rerun-if-changed=../../db/migrations");
}
