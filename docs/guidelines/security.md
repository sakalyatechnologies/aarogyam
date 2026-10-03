<!-- Copied from sakalya-platform. Edit it there, then run scripts/sync-guidelines.sh. -->

# Security

- **Secrets** are `secrecy::SecretString`. They are never logged, never `Debug`-printed, and exposed with `.expose_secret()` only at the point of use.
- **Configuration** comes from environment variables in deployed environments (Secret Manager mounts them on Cloud Run). `.env` files are for local use and never committed.
- **Tokens** are verified locally: signature from JWKS, `exp`, `nbf`, `iss` and `aud` always checked. Algorithms are allow-listed; `none` is never accepted.
- **Inputs** have size limits (request body, strings, lists) and use `#[serde(deny_unknown_fields)]` on request types.
- **Outbound calls** have timeouts and use rustls.
- **Personal data** is masked in `Debug` output (see `PhoneE164`). Tests assert the mask.
- **Errors** sent to clients never include SQL, stack traces or upstream provider messages.
- **Dependencies** pass `cargo deny check` (advisories, licences, duplicate versions) in CI.
