#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_HOST="${PI_HOST:-pi@print-server.local}"
APP_DIR="${APP_DIR:-/home/pi/apps/ipp-print-orchestrator}"

timestamp() {
  date '+%Y-%m-%dT%H:%M:%S%z'
}

log_phase() {
  printf '[%s] %s\n' "$(timestamp)" "$*"
}

run_timed() {
  local phase="$1"
  shift
  local started_at="${SECONDS}"
  log_phase "start ${phase}"
  "$@"
  local elapsed=$((SECONDS - started_at))
  log_phase "done ${phase} (${elapsed}s)"
}

run_timed "rsync repository to pi" \
  rsync -az --delete \
    --exclude node_modules \
    --exclude dist \
    --exclude .git \
    --exclude coverage \
    --exclude .reference \
    --exclude data \
    "${ROOT_DIR}/" "${PI_HOST}:${APP_DIR}/"

run_timed "remote install/build/restart" \
ssh "${PI_HOST}" "bash -lc '
set -euo pipefail
export PATH=\"\$HOME/.bun/bin:\$PATH\"
cd \"${APP_DIR}\"
timestamp() {
  date \"+%Y-%m-%dT%H:%M:%S%z\"
}
log_phase() {
  printf \"[%s] %s\\n\" \"\$(timestamp)\" \"\$*\"
}
run_timed() {
  local phase=\"\$1\"
  shift
  local started_at=\"\$SECONDS\"
  log_phase \"start \${phase}\"
  \"\$@\"
  local elapsed=\$((SECONDS - started_at))
  log_phase \"done \${phase} (\${elapsed}s)\"
}
# The Effect language-service prepare hook is editor-only and can OOM on low-memory Pis.
run_timed \"bun install\" bun install --frozen-lockfile --ignore-scripts
run_timed \"typescript build\" bun run build
run_timed \"install systemd units\" bash scripts/install-systemd.sh
run_timed \"restart app service\" sudo systemctl restart ipp-print-orchestrator
run_timed \"restart heartbeat timer\" sudo systemctl restart ipp-print-orchestrator-heartbeat.timer
'"

PORT="${IPP_ORCH_BIND_PORT:-4310}"
cat <<EOF
Deployment complete.

Useful follow-up commands on the Pi:
  ssh ${PI_HOST}
  sudo systemctl status ipp-print-orchestrator
  journalctl -u ipp-print-orchestrator -f
  curl http://127.0.0.1:${PORT}/v1/health
  curl http://127.0.0.1:${PORT}/v1/status
  lpstat -p
  lpstat -t

Useful remote commands from your laptop:
  bash scripts/watch-pi-status.sh
  ssh ${PI_HOST} 'journalctl -u ipp-print-orchestrator -f --no-pager'
EOF
