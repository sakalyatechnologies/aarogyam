//! The committed OpenAPI document matches the one the route annotations generate.

use std::path::Path;

const COMMITTED: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/api/openapi.json");

#[test]
fn openapi_document_matches_the_committed_copy() {
    let generated = aarogyam_api::openapi().to_pretty_json().unwrap() + "\n";
    if std::env::var("UPDATE_OPENAPI").is_ok_and(|value| value == "1") {
        std::fs::write(Path::new(COMMITTED), generated).unwrap();
        return;
    }
    let committed = std::fs::read_to_string(Path::new(COMMITTED)).unwrap_or_default();
    assert!(
        committed == generated,
        "docs/api/openapi.json does not match the route annotations. Regenerate it with \
         `UPDATE_OPENAPI=1 cargo test -p aarogyam-api openapi`, review the diff, and commit it."
    );
}
