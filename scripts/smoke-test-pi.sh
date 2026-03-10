#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-pi@print-server.local}"
PORT="${IPP_ORCH_BIND_PORT:-4310}"
PRINTER_NAME="${IPP_ORCH_PRINTER_NAME:-printer}"

ssh "${PI_HOST}" "bash -s" <<EOF
set -euo pipefail

curl -fsS "http://127.0.0.1:${PORT}/v1/health"
echo
curl -fsS "http://127.0.0.1:${PORT}/v1/status"
echo
lpstat -p
lpstat -t

if ! lpstat -p "${PRINTER_NAME}" >/dev/null 2>&1; then
  echo "Configured printer ${PRINTER_NAME} not found in CUPS" >&2
  exit 1
fi

echo "pi smoke test passed"
EOF
