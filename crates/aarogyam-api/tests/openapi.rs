//! The committed OpenAPI document matches the one the route annotations generate, no two Rust
//! types share a schema name in it, and every operation has its own explicit `operationId`.
#![expect(
    clippy::unwrap_used,
    reason = "test helpers fail loudly instead of returning errors"
)]

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

/// The schema name of every type in `source` that derives `ToSchema`: the type's name, or the
/// `#[schema(as = …)]` override.
fn schema_names(source: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut deriving = false;
    let mut renamed = None;
    let mut lines = source.lines().map(str::trim);
    while let Some(line) = lines.next() {
        let mut line = line.to_owned();
        // rustfmt wraps a long derive over several lines.
        while line.starts_with("#[derive(") && !line.contains(")]") {
            match lines.next() {
                Some(next) => line.push_str(next),
                None => break,
            }
        }
        let line = line.as_str();
        if line.starts_with("#[derive(") && line.contains("ToSchema") {
            deriving = true;
            renamed = None;
        } else if let Some((_, rest)) = line
            .strip_prefix("#[schema(")
            .filter(|_| deriving)
            .and_then(|args| args.split_once("as = "))
        {
            let end = rest.find([',', ')']).unwrap_or(rest.len());
            renamed = Some(rest[..end].trim().to_owned());
        } else if deriving && !line.starts_with('#') && !line.starts_with("//") {
            let item = line
                .split_whitespace()
                .skip_while(|word| !matches!(*word, "struct" | "enum"))
                .nth(1);
            if let Some(item) = item {
                let name: String = item
                    .chars()
                    .take_while(|c| c.is_alphanumeric() || *c == '_')
                    .collect();
                names.push(renamed.take().unwrap_or(name));
            }
            deriving = false;
        }
    }
    names
}

fn rust_files(dir: &Path, files: &mut Vec<std::path::PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_files(&path, files);
        } else if path.extension().is_some_and(|ext| ext == "rs") {
            files.push(path);
        }
    }
}

/// utoipa keys schemas by name, so two Rust types with one name silently share a schema, and
/// clients parse one type's responses with the other's shape.
#[test]
fn no_two_types_share_a_schema_name() {
    let mut files = Vec::new();
    rust_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let mut seen = std::collections::BTreeMap::<String, std::path::PathBuf>::new();
    let mut clashes = Vec::new();
    for file in files {
        let source = std::fs::read_to_string(&file).unwrap();
        for name in schema_names(&source) {
            if let Some(first) = seen.insert(name.clone(), file.clone()) {
                clashes.push(format!(
                    "{name}: {} and {}",
                    first.display(),
                    file.display()
                ));
            }
        }
    }
    assert!(seen.len() > 50, "found only {} schema types", seen.len());
    assert!(
        clashes.is_empty(),
        "types share an OpenAPI schema name; rename one or give it #[schema(as = …)]:\n{}",
        clashes.join("\n")
    );
}

#[test]
fn schema_names_reads_derives_and_overrides() {
    let source = "
        #[derive(Debug, Serialize, ToSchema)]
        pub struct Member {
        }
        #[derive(Debug, Serialize)]
        struct Plain;
        #[derive(Serialize,\n ToSchema)]
        #[serde(rename_all = \"snake_case\")]
        #[schema(as = StaffMember)]
        pub(crate) enum Other { A }
    ";
    assert_eq!(schema_names(source), ["Member", "StaffMember"]);
}

/// Generated clients name their methods after `operationId`, so two operations sharing one make
/// the client fail to compile (or silently shadow a method). Every id is also lowerCamelCase.
#[test]
fn operation_ids_are_unique_and_lower_camel_case() {
    let document = serde_json::to_value(aarogyam_api::openapi()).unwrap();
    let mut seen = std::collections::BTreeMap::<String, String>::new();
    let mut problems = Vec::new();
    for (path, operations) in document["paths"].as_object().unwrap() {
        for (method, operation) in operations.as_object().unwrap() {
            let at = format!("{} {path}", method.to_uppercase());
            let Some(id) = operation["operationId"].as_str() else {
                problems.push(format!("{at}: no operationId"));
                continue;
            };
            let mut chars = id.chars();
            let camel = chars.next().is_some_and(|c| c.is_ascii_lowercase())
                && chars.all(|c| c.is_ascii_alphanumeric());
            if !camel {
                problems.push(format!("{at}: `{id}` is not lowerCamelCase"));
            }
            if let Some(first) = seen.insert(id.to_owned(), at.clone()) {
                problems.push(format!("`{id}` names both {first} and {at}"));
            }
        }
    }
    assert!(seen.len() > 100, "found only {} operations", seen.len());
    assert!(
        problems.is_empty(),
        "operationIds must be unique, descriptive and lowerCamelCase (verbNoun, such as \
         `listPatients`):\n{}",
        problems.join("\n")
    );
}

/// Without `operation_id = "…"`, utoipa uses the handler's function name, so renaming a function
/// would silently rename the client's method, and `list` or `get` would collide again.
#[test]
fn every_route_annotation_names_its_operation() {
    let mut files = Vec::new();
    rust_files(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut files,
    );
    let mut unnamed = Vec::new();
    let mut annotations = 0;
    for file in files {
        let source = std::fs::read_to_string(&file).unwrap();
        for (start, _) in source.match_indices("#[utoipa::path(") {
            annotations += 1;
            let attribute = &source[start..];
            let end = attribute.find("\n)]").unwrap_or(attribute.len());
            if !attribute[..end].contains("operation_id = \"") {
                let line = source[..start].lines().count() + 1;
                unnamed.push(format!("{}:{line}", file.display()));
            }
        }
    }
    assert!(annotations > 100, "found only {annotations} annotations");
    assert!(
        unnamed.is_empty(),
        "these #[utoipa::path] annotations have no explicit operation_id:\n{}",
        unnamed.join("\n")
    );
}
