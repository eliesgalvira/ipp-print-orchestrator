#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYSTEMD_DIR="${ROOT_DIR}/systemd"

sudo install -d /etc/systemd/system
sudo install -m 0644 "${SYSTEMD_DIR}/ipp-print-orchestrator.service" /etc/systemd/system/ipp-print-orchestrator.service
sudo install -m 0644 "${SYSTEMD_DIR}/ipp-print-orchestrator-heartbeat.service" /etc/systemd/system/ipp-print-orchestrator-heartbeat.service
sudo install -m 0644 "${SYSTEMD_DIR}/ipp-print-orchestrator-heartbeat.timer" /etc/systemd/system/ipp-print-orchestrator-heartbeat.timer

if [[ ! -f /etc/ipp-print-orchestrator.env ]]; then
  sudo install -m 0644 "${ROOT_DIR}/.env.example" /etc/ipp-print-orchestrator.env
fi

sudo systemctl daemon-reload
sudo systemctl enable ipp-print-orchestrator.service
sudo systemctl enable ipp-print-orchestrator-heartbeat.timer

echo "systemd units installed"
