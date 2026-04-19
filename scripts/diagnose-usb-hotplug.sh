#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

if [[ -f /etc/ipp-print-orchestrator.env ]]; then
  set -a
  # shellcheck disable=SC1091
  source /etc/ipp-print-orchestrator.env
  set +a
fi

PRINTER_NAME="${IPP_ORCH_PRINTER_NAME:-printer}"
USB_SYSFS_ROOT="${IPP_ORCH_USB_SYSFS_ROOT:-/sys/bus/usb/devices}"
BIND_HOST="${IPP_ORCH_BIND_HOST:-127.0.0.1}"
BIND_PORT="${IPP_ORCH_BIND_PORT:-4310}"
DURATION_SECONDS="${1:-45}"

status_url="http://${BIND_HOST}:${BIND_PORT}/v1/status"

show_heading() {
  printf '\n== %s ==\n' "$1"
}

show_status() {
  printf '[%s] status ' "$(date --iso-8601=seconds)"
  if ! curl -fsS "${status_url}"; then
    printf '{"error":"status-unreachable","url":"%s"}' "${status_url}"
  fi
  printf '\n'
}

show_usb_sysfs() {
  printf '[%s] usb-sysfs\n' "$(date --iso-8601=seconds)"
  find "${USB_SYSFS_ROOT}" -mindepth 1 -maxdepth 1 \( -type d -o -type l \) ! -name '*:*' -print |
    sort |
    while IFS= read -r device_root; do
      manufacturer=""
      product=""
      serial=""
      [[ -r "${device_root}/manufacturer" ]] && manufacturer="$(tr -d '\n' < "${device_root}/manufacturer")"
      [[ -r "${device_root}/product" ]] && product="$(tr -d '\n' < "${device_root}/product")"
      [[ -r "${device_root}/serial" ]] && serial="$(tr -d '\n' < "${device_root}/serial")"
      if [[ -n "${manufacturer}${product}${serial}" ]]; then
        printf '  %s manufacturer=%q product=%q serial=%q\n' \
          "$(basename "${device_root}")" \
          "${manufacturer}" \
          "${product}" \
          "${serial}"
      fi
    done
}

show_heading "CUPS queue"
if ! lpstat -v "${PRINTER_NAME}"; then
  printf 'lpstat failed for printer=%q\n' "${PRINTER_NAME}"
  printf 'Available CUPS queues:\n'
  queues="$(lpstat -v || true)"
  printf '%s\n' "${queues}"
  detected_queue="$(printf '%s\n' "${queues}" | sed -n 's/^device for \([^:]*\):.*/\1/p' | head -n 1)"
  if [[ -n "${detected_queue}" ]]; then
    printf 'Hint: set IPP_ORCH_PRINTER_NAME=%q if this is the queue the daemon should use.\n' "${detected_queue}"
  fi
fi

show_heading "Initial status"
show_status

show_heading "Initial USB sysfs"
show_usb_sysfs

show_heading "Monitoring"
printf 'Unplug and replug the USB printer now. Monitoring for %s seconds.\n' "${DURATION_SECONDS}"

(
  end=$((SECONDS + DURATION_SECONDS))
  while (( SECONDS < end )); do
    show_status
    sleep 2
  done
) &
status_pid=$!

set +e
timeout "${DURATION_SECONDS}" udevadm monitor --udev --subsystem-match=usb --property
udev_status=$?
set -e

wait "${status_pid}" || true

show_heading "Final USB sysfs"
show_usb_sysfs

show_heading "Result"
case "${udev_status}" in
  0 | 124)
    printf 'udevadm monitor completed. If status changed here but Axiom did not log a status event, check the daemon journal.\n'
    ;;
  *)
    printf 'udevadm monitor exited with status %s. The daemon may be missing USB hotplug events too.\n' "${udev_status}"
    ;;
esac
