<!-- Copied from sakalya-backend. Edit it there, then run scripts/sync-guidelines.sh. -->

# Principles for every Sakalya codebase

These hold in every language we use. Each language guide (`rust.md` today; `typescript.md`, `kotlin.md` and `swift.md` when those libraries start) shows how.

1. **Types carry meaning.** A patient ID, an amount of money and a phone number are different types, never bare strings or numbers. Closed sets are enums.
2. **Failures are values.** Functions that can fail return a result type. Crashing is only for programming bugs.
3. **No escape hatches.** No forced unwraps, no "trust me" casts, no unchecked nulls, no unsafe code.
4. **Telemetry, never print.** Structured logs with stable event names and fields. Never personal or health data.
5. **Borrow and share deliberately.** Copy data only when ownership is needed.
6. **Small units.** Small modules, small packages, one job each. Easier for people and agents to read, faster to build.
7. **Tests prove behaviour** at the level a caller sees, and shared test helpers live in the platform's test kit.
8. **Reuse before writing.** Check the platform libraries first; adopt established community standards before inventing our own.

## The same rule in each language

| Principle | Rust | TypeScript | Kotlin | Swift |
|---|---|---|---|---|
| Typed IDs and values | `Id<T>`, newtypes | Branded types (`type PatientId = string & { __brand: "PatientId" }`) | `@JvmInline value class PatientId(val value: Uuid)` | `struct PatientId: Hashable { let value: UUID }` |
| Closed sets | `enum` | String-literal unions, exhaustive `switch` | `enum class`, `sealed interface` | `enum` |
| Failures as values | `Result<T, E>`, `thiserror` | Discriminated union `{ ok: true, value } \| { ok: false, error }` | `Result<T>` or sealed result | `Result<T, E>`, `throws` with typed errors |
| Banned escape hatches | `unwrap`, `expect`, `panic!`, `unsafe`, `todo!` | `any`, non-null `!`, `as` casts, `@ts-ignore` | `!!`, `lateinit` abuse, unchecked casts | Force unwrap `!`, `try!`, `fatalError` |
| Logging | `tracing` with fields | Structured logger, no `console.log` | Structured logger, no `println` | `os.Logger`, no `print` |
| Enforced by | clippy lints | `strict` tsconfig, ESLint | detekt, ktlint | SwiftLint |

## Platform libraries

| Library | Language | Holds | State |
|---|---|---|---|
| `sakalya-backend` | Rust | Types, config, telemetry, HTTP, auth, database, test kit | In use |
| `sakalya-web` | TypeScript | Design tokens, UI components, API client helpers, Playwright fixtures | When the first web UI starts |
| `sakalya-android` | Kotlin (KMP) | Typed values, networking, secure storage, Compose components, test helpers | When the Android app starts |
| `sakalya-ios` | Swift | Swift package with the same pieces for SwiftUI | When the iOS app starts. Needs its own repo, because Swift packages must sit at a repository root. |
| Design tokens | JSON | One source of colours, type and spacing, generated into CSS, Compose and SwiftUI themes | With `sakalya-web` |

Each library gets an `AGENTS.md`, its language guide, CI, and examples, following this repository's layout.
