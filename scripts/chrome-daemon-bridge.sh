#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-}"
RUNTIME_DIR="${2:-}"
NODE_BIN="${3:-}"
if [[ -z "$ROOT_DIR" || -z "$RUNTIME_DIR" || -z "$NODE_BIN" ]]; then
  echo "Usage: chrome-daemon-bridge.sh <repo-root> <runtime-root> <node-bin>" >&2
  exit 1
fi

PID_FILE="$RUNTIME_DIR/chrome-daemon.pid"
OUT_LOG="$RUNTIME_DIR/chrome-daemon.out.log"
ERR_LOG="$RUNTIME_DIR/chrome-daemon.err.log"

mkdir -p "$RUNTIME_DIR/data/seed/ko"

is_chrome_running() {
  pgrep -x "Google Chrome" >/dev/null 2>&1
}

is_daemon_running() {
  lsof -nP -iTCP:4317 -sTCP:LISTEN >/dev/null 2>&1
}

resolve_node_command() {
  if [[ -x "$NODE_BIN" ]]; then
    echo "$NODE_BIN"
    return
  fi

  echo ""
}

start_daemon() {
  if is_daemon_running; then
    return
  fi

  local node_cmd
  node_cmd="$(resolve_node_command)"
  if [[ -z "$node_cmd" ]]; then
    echo "Configured node binary not found; cannot start daemon." >>"$ERR_LOG"
    return
  fi

  (
    cd "$ROOT_DIR"
    nohup env LEARNER_ROOT="$RUNTIME_DIR" "$node_cmd" --import tsx apps/daemon/src/index.ts >>"$OUT_LOG" 2>>"$ERR_LOG" &
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
