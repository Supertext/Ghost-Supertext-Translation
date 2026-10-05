#!/bin/bash
# Demo container: Ghost on 127.0.0.1:2368, the Supertext connector in front of it on
# $PORT (serves /supertext/* itself and proxies everything else to Ghost), and the
# bootstrap that sets up accounts, integration, languages and sample content.
set -euo pipefail

PORT="${PORT:-8080}"
if [ -z "${url:-}" ]; then
  if [ -n "${GHOST_URL:-}" ]; then url="$GHOST_URL"
  elif [ -n "${RAILWAY_PUBLIC_DOMAIN:-}" ]; then url="https://${RAILWAY_PUBLIC_DOMAIN}"
  else url="http://localhost:${PORT}"
  fi
fi
export url GHOST_URL="$url" PORT
export GHOST_UPSTREAM="http://127.0.0.1:2368"
DATA="$GHOST_CONTENT/data"
export GHOST_SETTINGS_FILE="${GHOST_SETTINGS_FILE:-$DATA/supertext.json}"
export JOBS_FILE="${JOBS_FILE:-$DATA/supertext-jobs.json}"
mkdir -p "$DATA"
chown node:node "$GHOST_CONTENT" "$DATA"

echo "[demo] Public URL: $url"

# The official image's entrypoint seeds the content folder, fixes ownership and drops to the node user.
docker-entrypoint.sh node current/index.js &
GHOST_PID=$!

gosu node node /opt/supertext/dist/src/index.js &
CONNECTOR_PID=$!

gosu node node /opt/supertext/demo/bootstrap.mjs || echo "[demo] Bootstrap reported a problem (see above); the site still runs."

stop() { kill -TERM "$GHOST_PID" "$CONNECTOR_PID" 2>/dev/null || true; }
trap stop TERM INT

# If either process exits, stop the container so the platform restarts it.
set +e
wait -n "$GHOST_PID" "$CONNECTOR_PID"
code=$?
stop
wait
exit "$code"
