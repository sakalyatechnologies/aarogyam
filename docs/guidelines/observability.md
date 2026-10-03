<!-- Copied from sakalya-platform. Edit it there, then run scripts/sync-guidelines.sh. -->

# Observability

## How request IDs flow

1. `sakalya-http` assigns every request an `x-request-id` (UUIDv7) unless a trusted proxy already set one, and returns it in the response.
2. It opens a root span `http.request` with fields `request_id`, `method`, `route`, `status`, `latency_ms`, `tenant_id`, `user_id`.
3. Auth and tenancy middleware fill `tenant_id` and `user_id` with `sakalya_telemetry::record_tenant` and `record_user`.
4. Every `info!`, `warn!` or `error!` inside the request inherits those fields automatically. No macro or manual passing is needed.
5. Background work started from a request uses `sakalya_telemetry::spawn_in_span` so it keeps the same fields.

## Log budget

Enough to reconstruct any request, little enough to read and cheap to store:

- **One `info` line per request**, written by `sakalya-http` when the response is sent: route, status, latency, tenant, user.
- **One `info` line per business event**, with an `event` field: `appointment.booked`, `invoice.paid`, `message.sent`.
- **`warn`** for handled surprises (a retry, a provider timeout, a skipped message). **`error`** only when a person should look.
- **`debug`** is off in staging and production. Turn it on for one module with the filter (`info,arogyam_notify=debug`), not globally.
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
| Staging, production | JSON in Google Cloud Logging's format | stdout, collected by Cloud Run into Cloud Logging |

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

**Agent tooling (next).** A small command-line tool, `sk`, will wrap these queries and print compact summaries instead of raw logs, so an agent spends a few hundred tokens instead of thousands:

- `sk logs request <id>`: the request's timeline, one line per event.
- `sk errors --since 1h`: errors grouped by code and route, with counts and three sample request IDs.
- `sk slow --since 1h`: the slowest routes, with p50 and p95 latency.
- `sk tenant <slug> --since 1d`: one clinic's errors and events.

Audit records (who viewed or changed a record) belong in the database, never in logs.
