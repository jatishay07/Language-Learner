#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-}"
if [[ -z "$ROOT_DIR" ]]; then
  echo "Usage: chrome-daemon-bridge.sh <repo-root>" >&2
  exit 1
fi

PID_FILE="$ROOT_DIR/data/chrome-daemon.pid"
OUT_LOG="$ROOT_DIR/data/chrome-daemon.out.log"
ERR_LOG="$ROOT_DIR/data/chrome-daemon.err.log"

mkdir -p "$ROOT_DIR/data"

is_chrome_running() {
  pgrep -x "Google Chrome" >/dev/null 2>&1
}

is_daemon_running() {
  lsof -nP -iTCP:4317 -sTCP:LISTEN >/dev/null 2>&1
}

start_daemon() {
  if is_daemon_running; then
    return
  fi

  (
    cd "$ROOT_DIR"
    nohup pnpm run learner:daemon >>"$OUT_LOG" 2>>"$ERR_LOG" &
    echo $! > "$PID_FILE"
  )
}

stop_daemon_if_owned() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE" || true)"
    if [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
    rm -f "$PID_FILE"
  fi
}

while true; do
  if is_chrome_running; then
    start_daemon
  else
    stop_daemon_if_owned
  fi
  sleep 5
done
