<!-- Copied from sakalya-backend. Edit it there, then run scripts/sync-guidelines.sh. -->

# Observability

## How request IDs flow

1. `sakalya-http` assigns every request an `x-request-id` (UUIDv7) unless a trusted proxy already set one, and returns it in the response.
2. It opens a root span `http.request` with fields `request_id`, `method`, `route`, `status`, `latency_ms`, `tenant_id`, `user_id`.
3. Auth middleware records `user_id` with `sakalya_telemetry::record_user`. Tenancy middleware runs the rest of the request inside `sakalya_telemetry::tenant_span(id)`, which also records `tenant_id`, so filters can target one tenant.
4. Every `info!`, `warn!` or `error!` inside the request inherits those fields automatically. No macro or manual passing is needed.
5. Background work started from a request uses `sakalya_telemetry::spawn_in_span` so it keeps the same fields.

## Log budget

Enough to reconstruct any request, little enough to read and cheap to store:

- **One `info` line per request**, written by `sakalya-http` when the response is sent: route, status, latency, tenant, user.
- **One `info` line per business event**, with an `event` field: `appointment.booked`, `invoice.paid`, `message.sent`.
- **`warn`** for handled surprises (a retry, a provider timeout, a skipped message). **`error`** only when a person should look.
- **`debug`** is off in staging and production. Turn it on for one module with the filter (`info,aarogyam_notify=debug`), not globally.
- Never log inside tight loops. Log a summary after the loop.

## Event names

Every business event has a stable name in the `event` field: `noun.past_tense_verb`, lowercase, dot-separated. Products define them as an enum with an `as_str()` method so names cannot be mistyped, and dashboards and queries rely on them.

```rust
info!(event = Event::AppointmentBooked.as_str(), appointment_id = %id, "appointment booked");
```

## Writing logs

```rust
// Good: a constant message with structured fields.
info!(slot_id = %slot, "appointment booked");

// Bad: data interpolated into the message, and personal data in the log.
info!("booked appointment for {} at {}", patient_name, phone);
```

- Messages are constant templates. Variable data goes in fields. (M-LOG-STRUCTURED)
- Levels: `error` needs a human, `warn` is unexpected but handled, `info` is a business event, `debug` is for local work.
- Never log names, phone numbers, emails, addresses, clinical content, tokens or secrets. Log IDs instead.
- Use `#[tracing::instrument(skip_all, fields(...))]` on functions that do I/O, listing only safe fields.

## Where it goes

| Environment | Format | Destination |
|---|---|---|
| Local | Pretty, coloured | Terminal |
| Staging, production | Compact JSON, one object per line, span fields flattened (`request_id`, `tenant_id`, `user_id` at the top level) | stdout, collected by Cloud Run into Cloud Logging |

Errors and panics also go to Sentry once the product wires it in.

## Queries, dashboards and agent tooling

Because every line has the same fields, the questions you ask most become saved queries and dashboards:

| Question | Cloud Logging query |
|---|---|
| Everything for one request | `jsonPayload.request_id="0192..."` |
| Server errors in the last hour | `severity>=ERROR` |
| One clinic's failures | `jsonPayload.tenant_id="..." AND jsonPayload.status>=500` |
| Slow requests | `jsonPayload.latency_ms>1000` |
| A business event | `jsonPayload.event="message.sent"` |

Log-based metrics built on these fields give error rate, latency by route and events per clinic, without a separate metrics system.

**Agent tooling: `sk`.** The `sk` binary in this repository wraps these queries and prints compact summaries instead of raw logs, so an agent spends a few hundred tokens instead of thousands. Install with `cargo install --path crates/sk` (or `--git` from another repository).

- `sk request <id>`: the request's timeline, one line per event.
- `sk errors`: errors grouped by code and route, with counts and sample request IDs.
- `sk slow --top 10`: the slowest routes, with p50, p95 and max latency.
- `sk tenant <id>`: one tenant's requests, failures, events and errors.
- `sk events`: counts of each business event.

Sources: `--file app.log` (or stdin, for local runs piped through), or `--project <gcp-project> --since 1h --service aarogyam-api` for Cloud Logging through the `gcloud` CLI.

## Turning detail up and down

Levels are configuration, never code changes:

| Situation | Filter |
|---|---|
| Local development | `debug,hyper=info,sqlx=warn,h2=info` |
| Staging | `info,aarogyam=debug` |
| Production | `info` |
| Investigating one clinic in production | `info,[tenant{tenant_id=<id>}]=debug` for 30 minutes |
| Investigating one module | `info,aarogyam_notify=debug` for 30 minutes |

`sakalya_telemetry::init` returns a `LogControl`. `set_filter_for(directives, duration)` applies a filter and restores the configured one when the time runs out. Products store the override (filter plus expiry) as a platform setting that every instance polls, so one change in the console reaches all Cloud Run instances, and nobody forgets to turn debug off.

Audit records (who viewed or changed a record) belong in the database, never in logs.
