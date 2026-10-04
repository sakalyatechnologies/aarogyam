#!/usr/bin/env bash
# Starts a Cloudflare quick tunnel to the local API so the Workers (on Cloudflare) can reach it
# before the API has a real home on Cloud Run. Prints the https URL to pass to
# scripts/deploy-workers.sh as <api-origin>. Ctrl-C stops the tunnel.
set -euo pipefail

PORT="${1:-8080}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found; installing with Homebrew..."
  brew install cloudflared
fi

LOG_FILE="$(mktemp -t cloudflared-tunnel.XXXXXX.log)"
cleanup() {
  [ -n "${TUNNEL_PID:-}" ] && kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$LOG_FILE"
}
trap cleanup EXIT INT TERM

echo "Starting a quick tunnel to http://localhost:${PORT} ..."
cloudflared tunnel --no-autoupdate --url "http://localhost:${PORT}" >"$LOG_FILE" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -Eo 'https://[A-Za-z0-9.-]+\.trycloudflare\.com' "$LOG_FILE" | head -n1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$TUNNEL_PID" 2>/dev/null || { echo "cloudflared exited early:" >&2; cat "$LOG_FILE" >&2; exit 1; }
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Timed out waiting for the tunnel URL. cloudflared output:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

echo ""
echo "Tunnel is up: ${URL}"
echo "Next: scripts/deploy-workers.sh ${URL}"
echo "(Keep this running; Ctrl-C to stop the tunnel.)"
echo ""
wait "$TUNNEL_PID"
