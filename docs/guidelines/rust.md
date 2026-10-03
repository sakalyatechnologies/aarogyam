<!-- Copied from sakalya-backend. Edit it there, then run scripts/sync-guidelines.sh. -->

# Rust guidelines

These rules apply to every Sakalya Rust repository. Where they are silent, follow
`docs/vendor/microsoft-pragmatic-rust-guidelines.md`, then the
[Rust API Guidelines](https://rust-lang.github.io/api-guidelines/checklist.html).

## Types

- Every domain value gets a type. `Id<Patient>` and `Id<Clinic>` cannot be swapped by mistake; a `Uuid` can.
- Parse, don't validate: convert raw input into a type once, at the HTTP or database edge, then pass the type.
- Constructors that can fail return `Result<Self, SpecificError>`. Constructors that cannot fail are `const fn` where possible.
- Money is `Paise` (whole paise, `i64`). Never `f32`/`f64` for money.
- Times are `time::OffsetDateTime` in UTC. Convert to a clinic's zone only for display.
- Use enums for closed sets (`AppointmentStatus`), never strings or booleans pairs.
- Immutable owned text is `Box<str>`; immutable owned lists are `Box<[T]>`. (M-BOX-DST)

```rust
// Bad: three strings that can be passed in any order.
fn book(clinic: &str, patient: &str, doctor: &str) { /* ... */ }

// Good: the compiler rejects a swapped argument.
fn book(clinic: Id<Clinic>, patient: Id<Patient>, doctor: Id<Doctor>) { /* ... */ }
```

## Ownership and cloning

- Function parameters borrow: `&str`, `&[T]`, `&T`. Take ownership only when the function stores the value.
- Return owned values; let the caller decide what to borrow.
- Shared services are cheap to clone because they hold an `Arc` inside. Clone the service, not its data. (M-SERVICES-CLONE)
- Cloning a `Copy` ID or an `Arc` is fine. Cloning a `Vec`, `String` or large struct inside a loop needs a reason.
- Do not reach for `Rc`, `RefCell`, `Arc<Mutex<_>>` or lifetimes on structs until the simple owned version fails.

## Errors

- Library crates: one error struct per crate or module, built with `thiserror`, exposing a `kind()` enum. Implement `From` for wrapped errors and use `?`.
- Binaries may use `anyhow` in `main` and startup code only. (M-APP-ERROR)
- Error messages are lowercase, without trailing punctuation, and never contain secrets or personal data.
- HTTP handlers return `sakalya_http::ApiError`. Internal details are logged, never sent to the client.

## Async

- Async functions are `async fn`, not functions returning `impl Future`. (M-ASYNC-FN)
- Never block inside async code: no `std::thread::sleep`, no blocking file or network I/O. Use `tokio::task::spawn_blocking` for CPU-heavy work such as PDF rendering.
- Spawned tasks keep the request's span: `sakalya_telemetry::spawn_in_span(fut)`.
- Every outbound call has a timeout.

## Layering in product repositories

Product services split into crates by layer. Dependencies point inwards only.

| Layer | Contains | May depend on |
|---|---|---|
| `domain` | Business types and rules. Pure functions, no I/O, no async. | `sakalya-types` |
| `dal` | SQL queries and row mapping. One module per aggregate. | `domain`, `sakalya-db` |
| `app` | Use cases: load, decide with `domain`, save with `dal`, emit events. | `domain`, `dal` |
| `api` | HTTP routes, request and response types, OpenAPI. | `app`, `sakalya-http`, `sakalya-auth` |
| `bin` | `main`: config, telemetry, wiring. | everything |

The domain crate is where most unit tests live, because it has no I/O.

## Naming and modules

- Short names without weasel words: `Store`, not `DataManagerService`. (M-SHORT-NAMES, M-WEASEL-WORDS)
- Modules stay small and focused. Split a module past roughly 400 lines. (M-BALANCED-MODULES)
- Each item is reachable through one public path. No glob re-exports, no preludes. (M-SINGLE-ITEM-PATH, M-NO-GLOB-REEXPORTS, M-NO-PRELUDE)

## Lints

The workspace `Cargo.toml` enables `clippy::pedantic` as warnings and denies `unwrap_used`, `expect_used`, `panic`, `todo`, `dbg_macro`, `print_stdout`, `print_stderr`. Override a lint only with
`#[expect(lint, reason = "...")]`, never `#[allow]`. (M-LINT-OVERRIDE-EXPECT)
