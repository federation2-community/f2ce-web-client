#!/usr/bin/env bash
#
# dev-stack.sh — bring up the full Federation 2 web stack locally:
#   1. fed2d           (C++ game engine, fed2-community)      -> tcp :30003
#   2. f2ce-proxy       (telnet<->websocket bridge, fed-node)  -> http/ws :3001
#   3. f2ce-web-client  (vite dev server, this repo)           -> http :5173 (or next free port)
#
# Purpose: catch mudlet-web browser-behavior bugs (Muxlet init, GMCP timing,
# login-overlay rendering, etc.) locally, before deploying to client-test.
# See fed2-community/CLAUDE.md and the memory note "local-full-stack-testing"
# for background/rationale.
#
# Usage:
#   scripts/dev-stack.sh
#
# Env knobs (all optional):
#   ENGINE_DIR          path to fed2-community checkout      (default: ../fed2-community)
#   PROXY_DIR           path to fed-node checkout             (default: ../fed-node)
#   ENGINE_PORT         fed2d telnet port                     (default: 30003)
#   PROXY_PORT          f2ce-proxy http/ws port                (default: 3001)
#   VITE_PORT           vite dev server port                  (default: 5173, vite bumps if busy)
#   PKG_URL             f2ce-tools .mpackage release URL to install, forwarded
#                        through the local proxy's CORS forwarder
#                        (default: the 3.2.4 f2ce-tools release)
#   PKG_VERSION         version string reported to mudlet-web  (default: 3.2.4)
#   SKIP_ENGINE_BUILD    set to 1 to skip the cmake build step entirely
#   ENGINE_WAIT_SECS     how long to poll for the engine port  (default: 90)
#
# Ctrl-C (or any exit) tears down all three processes and removes the
# engine's fed2d.pid run-lock so a future run isn't blocked by a stale lock.
#
# Note: run this in the foreground of your own terminal. If you instead
# background it yourself (`dev-stack.sh &`), POSIX shells set SIGINT/SIGQUIT
# to ignored for asynchronous commands, and a non-interactive bash script
# cannot override that via `trap` — so Ctrl-C-equivalent signals silently
# won't reach it. `kill -TERM <pid>` always works as a fallback.
set -euo pipefail

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENGINE_DIR_RAW="${ENGINE_DIR:-$CLIENT_DIR/../fed2-community}"
PROXY_DIR_RAW="${PROXY_DIR:-$CLIENT_DIR/../fed-node}"

if [ ! -d "$ENGINE_DIR_RAW" ]; then
  echo "dev-stack: ENGINE_DIR '$ENGINE_DIR_RAW' does not exist" >&2
  exit 1
fi
if [ ! -d "$PROXY_DIR_RAW" ]; then
  echo "dev-stack: PROXY_DIR '$PROXY_DIR_RAW' does not exist" >&2
  exit 1
fi

ENGINE_DIR="$(cd "$ENGINE_DIR_RAW" && pwd)"
PROXY_DIR="$(cd "$PROXY_DIR_RAW" && pwd)"

ENGINE_PORT="${ENGINE_PORT:-30003}"
PROXY_PORT="${PROXY_PORT:-3001}"
VITE_PORT="${VITE_PORT:-5173}"
ENGINE_WAIT_SECS="${ENGINE_WAIT_SECS:-90}"
PKG_VERSION="${PKG_VERSION:-3.2.4}"
PKG_RELEASE_URL="${PKG_URL:-https://github.com/federation2-community/f2ce-tools/releases/download/${PKG_VERSION}/f2ce-tools.mpackage}"

LOG_DIR="$CLIENT_DIR/.dev-stack-logs"
mkdir -p "$LOG_DIR"
ENGINE_LOG="$LOG_DIR/engine.log"
PROXY_LOG="$LOG_DIR/proxy.log"
CLIENT_LOG="$LOG_DIR/client.log"

log() { echo "[dev-stack] $*"; }

# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------
ENGINE_PID=""
PROXY_PID=""
CLIENT_PID=""
TORN_DOWN=0

cleanup() {
  if [ "$TORN_DOWN" -eq 1 ]; then return; fi
  TORN_DOWN=1
  log "shutting down..."

  for pid in "$CLIENT_PID" "$PROXY_PID" "$ENGINE_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  # Give them a moment to exit cleanly, then force.
  for pid in "$CLIENT_PID" "$PROXY_PID" "$ENGINE_PID"; do
    if [ -n "$pid" ]; then
      for _ in 1 2 3 4 5; do
        kill -0 "$pid" 2>/dev/null || break
        sleep 1
      done
      kill -9 "$pid" 2>/dev/null || true
    fi
  done

  rm -f "$ENGINE_DIR/fed2d.pid"
  log "torn down."
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# 1. Engine (fed2d)
# ---------------------------------------------------------------------------
log "engine dir: $ENGINE_DIR"

if [ -f "$ENGINE_DIR/is_prod" ] || [ -f "$ENGINE_DIR/is_test" ]; then
  echo "dev-stack: refusing to start — $ENGINE_DIR has an is_prod/is_test marker file." >&2
  echo "           This script only runs the engine in LOCAL mode. Remove the marker" >&2
  echo "           (or point ENGINE_DIR at a dedicated local checkout) and re-run." >&2
  exit 1
fi

if [ -f "$ENGINE_DIR/fed2d.pid" ]; then
  log "warning: stale $ENGINE_DIR/fed2d.pid found (removing — GetRunLock would otherwise refuse to start)"
  rm -f "$ENGINE_DIR/fed2d.pid"
fi

if [ "${SKIP_ENGINE_BUILD:-0}" = "1" ]; then
  log "SKIP_ENGINE_BUILD=1, not building"
elif [ ! -x "$ENGINE_DIR/fed2d" ] || [ -n "$(find "$ENGINE_DIR/src" "$ENGINE_DIR/include" -newer "$ENGINE_DIR/fed2d" -type f 2>/dev/null | head -1)" ]; then
  log "building fed2d (cmake . && cmake --build . -- -j6)..."
  (cd "$ENGINE_DIR" && cmake . >>"$ENGINE_LOG" 2>&1 && cmake --build . -- -j6 >>"$ENGINE_LOG" 2>&1)
else
  log "fed2d up to date, skipping build"
fi

log "starting fed2d on :$ENGINE_PORT (log: $ENGINE_LOG)"
(cd "$ENGINE_DIR" && exec ./fed2d) >>"$ENGINE_LOG" 2>&1 &
ENGINE_PID=$!

log "waiting up to ${ENGINE_WAIT_SECS}s for :$ENGINE_PORT to accept connections (engine loads a large DB on startup)..."
engine_up=0
for _ in $(seq 1 "$ENGINE_WAIT_SECS"); do
  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    echo "dev-stack: fed2d exited during startup — see $ENGINE_LOG" >&2
    tail -n 40 "$ENGINE_LOG" >&2 || true
    exit 1
  fi
  if (exec 3<>"/dev/tcp/localhost/$ENGINE_PORT") 2>/dev/null; then
    exec 3<&- 3>&-
    engine_up=1
    break
  fi
  sleep 1
done
if [ "$engine_up" -ne 1 ]; then
  echo "dev-stack: fed2d did not open :$ENGINE_PORT within ${ENGINE_WAIT_SECS}s — see $ENGINE_LOG" >&2
  exit 1
fi
log "engine up (pid $ENGINE_PID)"

# ---------------------------------------------------------------------------
# 2. Proxy (f2ce-proxy / server.mjs)
# ---------------------------------------------------------------------------
log "proxy dir: $PROXY_DIR"

if [ ! -d "$PROXY_DIR/node_modules" ]; then
  log "installing proxy deps (npm ci)..."
  (cd "$PROXY_DIR" && npm ci >>"$PROXY_LOG" 2>&1)
fi

log "starting f2ce-proxy on :$PROXY_PORT -> localhost:$ENGINE_PORT (log: $PROXY_LOG)"
# TARGET_HOST/PORT pin the upstream. WS_ALLOWED_ORIGINS unset -> any origin
# accepted for the websocket. CORS_ORIGIN=* -> the /?url= forwarder answers
# CORS for any page origin. server.mjs listens plain ws (no TLS): in prod,
# Caddy terminates wss in front of it, so locally plain ws is correct and no
# certs are needed.
(cd "$PROXY_DIR" && exec env TARGET_HOST=localhost TARGET_PORT="$ENGINE_PORT" PORT="$PROXY_PORT" \
  WS_ALLOWED_ORIGINS= CORS_ORIGIN='*' node server.mjs) >>"$PROXY_LOG" 2>&1 &
PROXY_PID=$!

log "waiting for http://localhost:$PROXY_PORT/healthz..."
proxy_up=0
for _ in $(seq 1 30); do
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "dev-stack: f2ce-proxy exited during startup — see $PROXY_LOG" >&2
    tail -n 40 "$PROXY_LOG" >&2 || true
    exit 1
  fi
  if curl -fsS "http://localhost:$PROXY_PORT/healthz" >/dev/null 2>&1; then
    proxy_up=1
    break
  fi
  sleep 1
done
if [ "$proxy_up" -ne 1 ]; then
  echo "dev-stack: proxy healthz never returned 200 — see $PROXY_LOG" >&2
  exit 1
fi
log "proxy up (pid $PROXY_PID)"

# ---------------------------------------------------------------------------
# 3. Client (vite dev server)
# ---------------------------------------------------------------------------
log "client dir: $CLIENT_DIR"

if [ ! -d "$CLIENT_DIR/node_modules" ]; then
  log "installing client deps (npm ci)..."
  (cd "$CLIENT_DIR" && npm ci >>"$CLIENT_LOG" 2>&1)
fi

# Package URL routed THROUGH the local proxy's /?url= CORS forwarder (same
# path prod uses), so the browser fetches same-origin and avoids a CORS
# failure fetching the .mpackage straight from GitHub.
ENCODED_PKG_URL="$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$PKG_RELEASE_URL")"
VITE_PKG_URL="http://localhost:${PROXY_PORT}/?url=${ENCODED_PKG_URL}"
VITE_WS_URL="ws://localhost:${PROXY_PORT}"

log "starting vite dev server (log: $CLIENT_LOG)"
(cd "$CLIENT_DIR" && exec env \
  NO_COLOR=1 \
  VITE_WS_URL="$VITE_WS_URL" \
  VITE_PKG_URL="$VITE_PKG_URL" \
  VITE_PKG_VERSION="$PKG_VERSION" \
  npm run dev -- --port "$VITE_PORT" --clearScreen=false) >"$CLIENT_LOG" 2>&1 &
CLIENT_PID=$!

log "waiting for vite to report its URL..."
client_url=""
for _ in $(seq 1 60); do
  if ! kill -0 "$CLIENT_PID" 2>/dev/null; then
    echo "dev-stack: vite exited during startup — see $CLIENT_LOG" >&2
    tail -n 40 "$CLIENT_LOG" >&2 || true
    exit 1
  fi
  # Vite's output is ANSI-colored (color codes embedded even inside the URL
  # itself, e.g. the port number), so strip escape sequences before matching.
  candidate="$(sed -E $'s/\x1b\\[[0-9;]*[a-zA-Z]//g' "$CLIENT_LOG" 2>/dev/null \
    | grep -Eo 'Local:[[:space:]]+http://[^[:space:]]+' | tail -1 | grep -Eo 'http://[^[:space:]]+' || true)"
  if [ -n "$candidate" ]; then
    client_url="$candidate"
    break
  fi
  sleep 1
done
if [ -z "$client_url" ]; then
  echo "dev-stack: vite never printed a Local: URL — see $CLIENT_LOG" >&2
  exit 1
fi

log "client up (pid $CLIENT_PID)"
echo
echo "=================================================================="
echo " stack up: open $client_url"
echo "   engine  : localhost:$ENGINE_PORT   (pid $ENGINE_PID, log $ENGINE_LOG)"
echo "   proxy   : $VITE_WS_URL   (pid $PROXY_PID, log $PROXY_LOG, healthz http://localhost:$PROXY_PORT/healthz)"
echo "   client  : $client_url   (pid $CLIENT_PID, log $CLIENT_LOG)"
echo "=================================================================="
echo " Ctrl-C to tear everything down."
echo

# Portable "wait for any child to exit" loop (avoids bash>=4.3's `wait -n`,
# not available in macOS's stock bash 3.2).
while true; do
  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    log "engine process exited unexpectedly — see $ENGINE_LOG"
    break
  fi
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    log "proxy process exited unexpectedly — see $PROXY_LOG"
    break
  fi
  if ! kill -0 "$CLIENT_PID" 2>/dev/null; then
    log "client process exited unexpectedly — see $CLIENT_LOG"
    break
  fi
  sleep 1
done
