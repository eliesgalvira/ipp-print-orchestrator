#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-pi@print-server.local}"
PORT="${IPP_ORCH_BIND_PORT:-4310}"

ssh "${PI_HOST}" "bash -s" <<EOF
set -euo pipefail

PRINTER_NAME="\${IPP_ORCH_PRINTER_NAME:-}"
HOST="127.0.0.1"
REMOTE_PORT="${PORT}"

if [[ -z "\${PRINTER_NAME}" ]] && [[ -f /etc/ipp-print-orchestrator.env ]]; then
  PRINTER_NAME="\$(awk -F= '/^IPP_ORCH_PRINTER_NAME=/ { print \$2 }' /etc/ipp-print-orchestrator.env | tail -n 1)"
fi

if [[ -f /etc/ipp-print-orchestrator.env ]]; then
  CONFIGURED_HOST="\$(awk -F= '/^IPP_ORCH_BIND_HOST=/ { print \$2 }' /etc/ipp-print-orchestrator.env | tail -n 1)"
  CONFIGURED_PORT="\$(awk -F= '/^IPP_ORCH_BIND_PORT=/ { print \$2 }' /etc/ipp-print-orchestrator.env | tail -n 1)"

  if [[ -n "\${CONFIGURED_HOST}" ]]; then
    HOST="\${CONFIGURED_HOST}"
  fi

  if [[ -n "\${CONFIGURED_PORT}" ]]; then
    REMOTE_PORT="\${CONFIGURED_PORT}"
  fi
fi

if [[ -z "\${PRINTER_NAME}" ]]; then
  PRINTER_NAME="printer"
fi

curl -fsS "http://\${HOST}:\${REMOTE_PORT}/v1/health"
echo
curl -fsS "http://\${HOST}:\${REMOTE_PORT}/v1/status"
echo
lpstat -p
lpstat -t

if ! lpstat -p "\${PRINTER_NAME}" >/dev/null 2>&1; then
  echo "Configured printer \${PRINTER_NAME} not found in CUPS" >&2
  exit 1
fi

echo "pi smoke test passed"
EOF
