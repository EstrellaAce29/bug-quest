#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$PWD"
STATE="$ROOT/.next/bug-quest-run"

if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Open Docker Desktop, wait for it to start, then rerun ./start.sh." >&2
  exit 1
fi
docker compose version >/dev/null
for command in node npm curl; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
[[ -f .env.local ]] || { echo "Create and fill .env.local first (see README.md)." >&2; exit 1; }
CURL_BIN=$(command -v curl)
if ! "$CURL_BIN" --version >/dev/null 2>&1; then
  # Some macOS PATHs put an incompatible Anaconda curl before the system binary.
  [[ -x /usr/bin/curl ]] || { echo "curl cannot run. Install a compatible curl and retry." >&2; exit 1; }
  CURL_BIN=/usr/bin/curl
fi
mkdir -p .next
if ! mkdir "$STATE" 2>/dev/null; then
  echo "Startup is already active, or a previous run left $STATE. Run ./stop.sh first." >&2
  exit 1
fi
echo "$$" > "$STATE/pid"
DEV_PID=""
cleanup() {
  if [[ -n "$DEV_PID" ]]; then
    kill -TERM -- "-$DEV_PID" 2>/dev/null || true
    wait "$DEV_PID" 2>/dev/null || true
  fi
  rm -f "$STATE/pid"
  rmdir "$STATE" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(cd real-pipeline && docker compose --env-file ../.env.local up -d)
echo "Waiting up to five minutes for Airflow at http://localhost:8081 ..."
deadline=$((SECONDS + 300))
while true; do
  if "$CURL_BIN" --fail --silent --max-time 5 http://localhost:8081/api/v2/monitor/health |
    node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { try { const h=JSON.parse(s); process.exit(h.metadatabase?.status === "healthy" && h.scheduler?.status === "healthy" ? 0 : 1); } catch { process.exit(1); } });'; then
    break
  fi
  if (( SECONDS >= deadline )); then
    echo "Airflow did not become healthy. Inspect: cd real-pipeline && docker compose --env-file ../.env.local logs --tail=100" >&2
    echo "The stack is still running; use ./stop.sh to stop it." >&2
    exit 1
  fi
  sleep 2
done
echo "Airflow is healthy. Starting Bug Quest; use ./stop.sh in another terminal to stop both."
# Job control gives npm and its children their own process group for cleanup.
set -m
npm run dev &
DEV_PID=$!
wait "$DEV_PID"
