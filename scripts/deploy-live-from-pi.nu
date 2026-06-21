#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [run-sudo run-timed]

def require-store-path [label: string, store_path: string]: nothing -> nothing {
  if (($store_path | str trim | str length) == 0) {
    error make {msg: $"missing --($label)-path"}
  }

  if not ($store_path | str starts-with "/nix/store/") {
    error make {msg: $"--($label)-path must be a /nix/store path, got: ($store_path)"}
  }

  if not ($store_path | path exists) {
    error make {msg: $"--($label)-path does not exist on the Pi: ($store_path)"}
  }
}

def verify-app-health [host: string, port: string]: nothing -> nothing {
  let max_attempts = 20
  let url = $"http://($host):($port)/v1/health"
  mut healthy = false

  for attempt in 1..$max_attempts {
    let started_at = (date now)
    print $"[($started_at | format date "%+")] start health check attempt ($attempt)/($max_attempts) ($url)"

    let result = (^curl --fail --silent --show-error --connect-timeout 1 --max-time 2 $url | complete)
    let elapsed = ((date now) - $started_at)

    if $result.exit_code == 0 {
      print $"[(date now | format date "%+")] done health check attempt ($attempt)/($max_attempts) \(($elapsed)\) healthy"
      $healthy = true
      break
    }

    let stderr = ($result.stderr | str trim)
    let reason = if (($stderr | str length) > 0) {
      $stderr
    } else {
      $"curl exited with code ($result.exit_code)"
    }

    print $"[(date now | format date "%+")] done health check attempt ($attempt)/($max_attempts) \(($elapsed)\) failed: ($reason)"
    sleep 1sec
  }

  if not $healthy {
    error make {msg: $"health check failed after ($max_attempts) attempts: ($url)"}
  }
}

def main [
  --app-dir: string = "/home/pi/apps/ipp-print-orchestrator"
  --runtime-path: string = ""
  --driver-path: string = ""
  --backend-path: string = ""
] : nothing -> nothing {
  require-store-path "runtime" $runtime_path
  require-store-path "driver" $driver_path
  require-store-path "backend" $backend_path

  cd $app_dir

  run-timed "install CUPS artifacts" {
    ^nu scripts/setup-cups-live-from-pi.nu --artifacts-only --runtime-path $runtime_path --driver-path $driver_path --backend-path $backend_path
  }

  run-timed "install systemd units" {
    ^nu scripts/install-systemd-live-from-pi.nu --runtime-path $runtime_path
  }

  run-timed "restart app service" {
    run-sudo ["systemctl" "restart" "ipp-print-orchestrator"]
  }

  run-timed "restart heartbeat timer" {
    run-sudo ["systemctl" "restart" "ipp-print-orchestrator-heartbeat.timer"]
  }

  let remote_dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
  let host = (get-config $remote_dotenv IPP_ORCH_BIND_HOST "127.0.0.1")
  let port = (get-config $remote_dotenv IPP_ORCH_BIND_PORT "4310")

  run-timed "verify app health" {
    verify-app-health $host $port
  }
}
