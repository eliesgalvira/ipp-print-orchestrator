#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_HOST="${PI_HOST:-pi@print-server.local}"
APP_DIR="${APP_DIR:-/home/pi/apps/ipp-print-orchestrator}"

rsync -az --delete \
  --exclude node_modules \
  --exclude dist \
  --exclude .git \
  --exclude coverage \
  --exclude .reference \
  --exclude data \
  "${ROOT_DIR}/" "${PI_HOST}:${APP_DIR}/"

ssh "${PI_HOST}" "bash -lc '
set -euo pipefail
export PATH=\"\$HOME/.bun/bin:\$PATH\"
cd \"${APP_DIR}\"
# The Effect language-service prepare hook is editor-only and can OOM on low-memory Pis.
bun install --frozen-lockfile --ignore-scripts
bun run build
bash scripts/install-systemd.sh
sudo systemctl restart ipp-print-orchestrator
sudo systemctl restart ipp-print-orchestrator-heartbeat.timer
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
EOF
