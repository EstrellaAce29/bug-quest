#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
STATE="$PWD/.next/bug-quest-run"
if [[ -f "$STATE/pid" ]]; then
  read -r pid < "$STATE/pid"
  if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
    # Only signal the start script belonging to this checkout.
    process_args=$(ps -p "$pid" -o args=) || {
      echo "Could not inspect the recorded dev process; retry ./stop.sh with process inspection available." >&2
      exit 1
    }
    if [[ "$process_args" =~ (^|[\ /])start\.sh([[:space:]]|$) ]]; then
      kill -TERM "$pid"
      for ((attempt = 0; attempt < 50; attempt++)); do
        [[ -d "$STATE" ]] || break
        sleep 0.2
      done
      if [[ -d "$STATE" ]]; then
        echo "Dev process is still stopping. Retry ./stop.sh shortly." >&2
        exit 1
      fi
    else
      echo "Recorded PID no longer belongs to start.sh; leaving that process alone."
      rm -f "$STATE/pid"
      rmdir "$STATE"
    fi
  else
    rm -f "$STATE/pid"
    rmdir "$STATE"
  fi
else
  echo "No dev process started by ./start.sh is recorded."
fi
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Open Docker Desktop, then rerun ./stop.sh to stop the Airflow stack." >&2
  exit 1
fi
(cd real-pipeline && docker compose --env-file ../.env.local stop)
echo "Bug Quest and Airflow stopped (database volume preserved)."
