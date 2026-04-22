#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [ensure-user-bun-on-path run-sudo run-timed]

def dependency-manifest-paths []: nothing -> list<string> {
  [
    "package.json"
    "bun.lock"
    "apps/agent/package.json"
    "packages/ipp/package.json"
    "packages/shared/package.json"
    "packages/testkit/package.json"
  ]
}

def production-install-stamp-path []: nothing -> string {
  ".ipp-orch-production-install.sha256"
}

def production-install-fingerprint []: nothing -> string {
  dependency-manifest-paths
  | where {|path| $path | path exists}
  | each {|path|
      {
        path: $path
        sha256: (open --raw $path | hash sha256)
      }
    }
  | to json -r
  | hash sha256
}

def production-install-current []: nothing -> bool {
  let stamp_path = (production-install-stamp-path)
  if (not ("node_modules" | path exists)) or (not ($stamp_path | path exists)) {
    false
  } else {
    ((open --raw $stamp_path | str trim) == (production-install-fingerprint))
  }
}

def install-production-dependencies []: nothing -> nothing {
  let fingerprint = (production-install-fingerprint)

  if (production-install-current) {
    print "production dependencies already current; skipping bun install"
  } else {
    ^bun install --frozen-lockfile --ignore-scripts --production
    $fingerprint | save --force (production-install-stamp-path)
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
] : nothing -> nothing {
  ensure-user-bun-on-path

  cd $app_dir

  run-timed "production dependency check/install" {
    install-production-dependencies
  }

  run-timed "install systemd units" {
    ^nu scripts/install-systemd-live-from-pi.nu
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
