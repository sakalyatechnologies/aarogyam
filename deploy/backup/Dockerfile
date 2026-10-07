# Image for the nightly database backup job (see docs/ops.md "Backups"). pg_dump must be at least
# as new as the server, so the major version is pinned here and checked again at run time.
# Built by scripts/ops-setup.sh in Cloud Build from a temporary directory holding this file,
# backup.sh and config/supabase-ca.crt (the database URLs say sslrootcert=config/supabase-ca.crt,
# relative to /app).
FROM postgres:17-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY backup.sh /app/backup.sh
COPY config/supabase-ca.crt /app/config/supabase-ca.crt
RUN chmod 0555 /app/backup.sh && adduser -D -u 65532 backup
USER backup
ENTRYPOINT ["/app/backup.sh"]
