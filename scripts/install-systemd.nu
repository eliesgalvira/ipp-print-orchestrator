#!/usr/bin/env nu

use lib/remote.nu run-sudo
use lib/repo.nu repo-root

def install-rendered-unit [source: path, destination: string, app_dir: path]: nothing -> nothing {
  let rendered = (
    open --raw $source
    | str replace --all "/home/pi/apps/ipp-print-orchestrator" ($app_dir | into string)
  )
  let tmp_unit = (mktemp)

  try {
    $rendered | save --force $tmp_unit
    run-sudo ["install" "-m" "0644" $tmp_unit $destination]
  } catch {|err|
    rm --force $tmp_unit
    error make $err
  }

  rm --force $tmp_unit
}

def default-service-env-content []: nothing -> string {
  [
    "IPP_ORCH_DATA_DIR=data"
    "IPP_ORCH_PRINTER_NAME=printer"
    "IPP_ORCH_BIND_HOST=127.0.0.1"
    "IPP_ORCH_BIND_PORT=4310"
    "IPP_ORCH_USB_SYSFS_ROOT=/sys/bus/usb/devices"
    "IPP_ORCH_STATUS_OBSERVATION_INTERVAL_MS=10000"
    "IPP_ORCH_HEARTBEAT_INTERVAL_MS=60000"
    "IPP_ORCH_RECONCILE_INTERVAL_MS=30000"
    "IPP_ORCH_LOG_PRETTY=false"
    "IPP_ORCH_ENABLE_OTLP=true"
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS="
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="
    "OTEL_EXPORTER_OTLP_LOGS_HEADERS="
    "OTEL_RESOURCE_ATTRIBUTES=service.name=ipp-print-orchestrator"
    ""
  ] | str join "\n"
}

def install-default-service-env []: nothing -> nothing {
  let tmp_env = (mktemp)

  try {
    default-service-env-content | save --force $tmp_env
    run-sudo ["install" "-m" "0644" $tmp_env "/etc/ipp-print-orchestrator.env"]
  } catch {|err|
    rm --force $tmp_env
    error make $err
  }

  rm --force $tmp_env
}

def main []: nothing -> nothing {
  let root_dir = (repo-root)
  let systemd_dir = ($root_dir | path join "systemd")

  run-sudo ["install" "-d" "/etc/systemd/system"]
  install-rendered-unit ($systemd_dir | path join "ipp-print-orchestrator.service") "/etc/systemd/system/ipp-print-orchestrator.service" $root_dir
  install-rendered-unit ($systemd_dir | path join "ipp-print-orchestrator-heartbeat.service") "/etc/systemd/system/ipp-print-orchestrator-heartbeat.service" $root_dir
  install-rendered-unit ($systemd_dir | path join "ipp-print-orchestrator-heartbeat.timer") "/etc/systemd/system/ipp-print-orchestrator-heartbeat.timer" $root_dir

  if not ("/etc/ipp-print-orchestrator.env" | path exists) {
    install-default-service-env
  }

  run-sudo ["systemctl" "daemon-reload"]
  run-sudo ["systemctl" "enable" "ipp-print-orchestrator.service"]
  run-sudo ["systemctl" "enable" "ipp-print-orchestrator-heartbeat.timer"]

  print "systemd units installed"
}
