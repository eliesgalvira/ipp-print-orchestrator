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

def main [
  --app-dir: string = "/home/pi/apps/ipp-print-orchestrator"
] : nothing -> nothing {
  ensure-user-bun-on-path

  cd $app_dir

  run-timed "production dependency check/install" {
    install-production-dependencies
  }

  run-timed "install systemd units" {
    ^nu scripts/install-systemd-live-on-pi.nu
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
    let healthy = (seq 1 20 | any {|_|
      let result = (^curl --fail --silent $"http://($host):($port)/v1/health" | complete)
      if $result.exit_code == 0 {
        true
      } else {
        sleep 1sec
        false
      }
    })

    if not $healthy {
      error make {msg: $"health check failed after 20 seconds: http://($host):($port)/v1/health"}
    }
  }
}
