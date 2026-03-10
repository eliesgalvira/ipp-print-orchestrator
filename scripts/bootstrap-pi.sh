#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-pi@print-server.local}"
APP_DIR="${APP_DIR:-/home/pi/apps/ipp-print-orchestrator}"

ssh "${PI_HOST}" "bash -s" <<EOF
set -euo pipefail

if command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y curl unzip rsync nodejs npm cups-client
else
  echo "Unsupported package manager on target machine. Install curl, unzip, rsync, node, npm, and cups-client manually." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
fi

mkdir -p "${APP_DIR}"

if [[ ! -f /etc/ipp-print-orchestrator.env ]]; then
  sudo tee /etc/ipp-print-orchestrator.env >/dev/null <<ENV
IPP_ORCH_DATA_DIR=${APP_DIR}/data
IPP_ORCH_PRINTER_NAME=printer
IPP_ORCH_BIND_HOST=127.0.0.1
IPP_ORCH_BIND_PORT=4310
IPP_ORCH_HEARTBEAT_INTERVAL_MS=60000
IPP_ORCH_RECONCILE_INTERVAL_MS=30000
IPP_ORCH_LOG_PRETTY=false
IPP_ORCH_ENABLE_OTLP=false
OTEL_EXPORTER_OTLP_ENDPOINT=
OTEL_RESOURCE_ATTRIBUTES=service.name=ipp-print-orchestrator
ENV
fi

echo "bootstrap complete on ${PI_HOST}"
EOF
