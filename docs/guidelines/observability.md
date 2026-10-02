<!-- Copied from sakalya-platform. Edit it there, then copy it here. -->

# Observability

## How request IDs flow

1. `sakalya-http` assigns every request an `x-request-id` (UUIDv7) unless a trusted proxy already set one, and returns it in the response.
2. It opens a root span `http.request` with fields `request_id`, `method`, `route`, `status`, `latency_ms`, `tenant_id`, `user_id`.
3. Auth and tenancy middleware fill `tenant_id` and `user_id` with `sakalya_telemetry::record_tenant` and `record_user`.
4. Every `info!`, `warn!` or `error!` inside the request inherits those fields automatically. No macro or manual passing is needed.
5. Background work started from a request uses `sakalya_telemetry::spawn_in_span` so it keeps the same fields.

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

Errors and panics also go to Sentry once the product wires it in. Audit records (who viewed or changed a record) belong in the database, never in logs.
