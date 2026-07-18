#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 24 or newer is required: https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 24 ]; then
  echo "Node.js 24 or newer is required. Detected: $(node --version)" >&2
  exit 1
fi

mkdir -p data
export PORT="${PORT:-4318}"
export LOGOS_DB_PATH="$ROOT/data/logos.db"
URL="http://127.0.0.1:$PORT"

node --env-file-if-exists=.env.local server/index.ts &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM

READY=0
for _ in $(seq 1 40); do
  if node -e "fetch('$URL/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    READY=1
    break
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "LOGOS Continuity stopped before becoming ready." >&2
    exit 1
  fi
  sleep 0.25
done

if [ "$READY" -ne 1 ]; then
  echo "LOGOS Continuity did not become ready in time." >&2
  exit 1
fi

echo "LOGOS Continuity is running at $URL"
if command -v open >/dev/null 2>&1; then
  open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL"
fi
wait "$SERVER_PID"
