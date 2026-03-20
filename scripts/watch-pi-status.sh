#!/usr/bin/env bash
set -euo pipefail

PI_HOST="${PI_HOST:-pi@print-server.local}"
PORT="${IPP_ORCH_BIND_PORT:-4310}"
INTERVAL_SEC="${WATCH_INTERVAL_SEC:-2}"

ssh "${PI_HOST}" "bash -lc '
set -euo pipefail

while true; do
  printf \"[%s] \" \"\$(date -Is)\"
  curl -fsS \"http://127.0.0.1:${PORT}/v1/status\"
  printf \"\n\"
  sleep \"${INTERVAL_SEC}\"
done
'"
