#!/usr/bin/env nu

use lib/remote.nu [run-sudo run-timed]
use lib/repo.nu repo-root

def run-sudo-timed [phase: string, args: list<string>]: nothing -> any {
  run-timed $phase {
    run-sudo $args
  }
}

def install-rendered-unit [source: path, destination: string, app_dir: path]: nothing -> bool {
  let rendered = (
    open --raw $source
    | str replace --all "/home/pi/apps/ipp-print-orchestrator" ($app_dir | into string)
  )

  if ($destination | path exists) and ((open --raw $destination) == $rendered) {
    print $"systemd unit already current: ($destination)"
    return false
  }

  run-timed $"install changed systemd unit ($destination)" {
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

  true
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
    "IPP_ORCH_ENABLE_OTLP=false"
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS="
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="
    "OTEL_EXPORTER_OTLP_LOGS_HEADERS="
    "OTEL_RESOURCE_ATTRIBUTES=service.name=ipp-print-orchestrator"
    ""
  ] | str join "\n"
}

def install-default-service-env []: nothing -> nothing {
  run-timed "install default service environment" {
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
}

def ensure-systemd-enabled [unit: string]: nothing -> nothing {
  let result = (^systemctl is-enabled --quiet $unit | complete)
  if $result.exit_code == 0 {
    print $"systemd unit already enabled: ($unit)"
  } else {
    run-sudo-timed $"systemctl enable ($unit)" ["systemctl" "enable" $unit]
  }
}

def restart-systemd-unit [unit: string]: nothing -> nothing {
  run-sudo-timed $"systemctl restart ($unit)" ["systemctl" "restart" $unit]
}

def main []: nothing -> nothing {
  let root_dir = (repo-root)
  let systemd_dir = ($root_dir | path join "systemd")

  run-sudo-timed "ensure systemd unit directory" ["install" "-d" "/etc/systemd/system"]
  let app_service_changed = (install-rendered-unit ($systemd_dir | path join "ipp-print-orchestrator.service") "/etc/systemd/system/ipp-print-orchestrator.service" $root_dir)
  let heartbeat_service_changed = (install-rendered-unit ($systemd_dir | path join "ipp-print-orchestrator-heartbeat.service") "/etc/systemd/system/ipp-print-orchestrator-heartbeat.service" $root_dir)
  let heartbeat_timer_changed = (install-rendered-unit ($systemd_dir | path join "ipp-print-orchestrator-heartbeat.timer") "/etc/systemd/system/ipp-print-orchestrator-heartbeat.timer" $root_dir)
  let cups_tls_watch_service_changed = (install-rendered-unit ($systemd_dir | path join "ipp-print-orchestrator-cups-tls-watch.service") "/etc/systemd/system/ipp-print-orchestrator-cups-tls-watch.service" $root_dir)

  if not ("/etc/ipp-print-orchestrator.env" | path exists) {
    install-default-service-env
  }

  if $app_service_changed or $heartbeat_service_changed or $heartbeat_timer_changed or $cups_tls_watch_service_changed {
    run-sudo-timed "systemctl daemon-reload" ["systemctl" "daemon-reload"]
  } else {
    print "systemd units unchanged; skipping daemon-reload"
  }

  ensure-systemd-enabled "ipp-print-orchestrator.service"
  ensure-systemd-enabled "ipp-print-orchestrator-heartbeat.timer"
  ensure-systemd-enabled "ipp-print-orchestrator-cups-tls-watch.service"
  restart-systemd-unit "ipp-print-orchestrator-cups-tls-watch.service"

  print "systemd units installed"
}
