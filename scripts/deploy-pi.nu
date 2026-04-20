#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu *
use lib/repo.nu *

def require-command [name: string] {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def default-ssh-key-path [] {
  $nu.home-dir | path join ".ssh/ipp-print-orchestrator-pi"
}

def run-with-input [input: string, command: list<string>] {
  $input | run-external ...$command
}

def ssh-command [host: string, key_path: path, remote_command: string, use_tty: bool] {
  (ssh-args $host $key_path --batch --tty=$use_tty) ++ [$remote_command]
}

def service-env-keys [] {
  [
    "IPP_ORCH_DATA_DIR"
    "IPP_ORCH_PRINTER_NAME"
    "IPP_ORCH_BIND_HOST"
    "IPP_ORCH_BIND_PORT"
    "IPP_ORCH_USB_SYSFS_ROOT"
    "IPP_ORCH_STATUS_OBSERVATION_INTERVAL_MS"
    "IPP_ORCH_HEARTBEAT_INTERVAL_MS"
    "IPP_ORCH_RECONCILE_INTERVAL_MS"
    "IPP_ORCH_LOG_PRETTY"
    "IPP_ORCH_ENABLE_OTLP"
    "OTEL_EXPORTER_OTLP_ENDPOINT"
    "OTEL_EXPORTER_OTLP_HEADERS"
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS"
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"
    "OTEL_EXPORTER_OTLP_LOGS_HEADERS"
    "OTEL_RESOURCE_ATTRIBUTES"
  ]
}

def local-service-env-content [root_dir: path, dotenv: record] {
  let example_dotenv = (load-dotenv ($root_dir | path join ".env.example"))
  let service_dotenv = ($example_dotenv | merge $dotenv)

  service-env-keys
  | where {|key| ($service_dotenv | get -o $key) != null}
  | each {|key| $"($key)=($service_dotenv | get $key)"}
  | append [""]
  | str join "\n"
}

def sync-service-env [host: string, key_path: path, env_content: string] {
  let remote_script_template = '
let env_content = __ENV_CONTENT_NUON__
let tmp_env = (mktemp)

try {
  ($env_content + "\n") | save --force $tmp_env
  run-external "sudo" "install" "-m" "0644" $tmp_env "/etc/ipp-print-orchestrator.env"
} catch {|err|
  rm --force $tmp_env
  error make $err
}

rm --force $tmp_env
'
  let remote_script = (
    $remote_script_template
    | str replace "__ENV_CONTENT_NUON__" ($env_content | to nuon)
  )
  let command = ((ssh-args $host $key_path --batch) ++ ["nu --no-config-file -c 'source /dev/stdin'"])
  run-with-input $remote_script $command
}

def dependency-manifest-paths [] {
  [
    "package.json"
    "bun.lock"
    "apps/agent/package.json"
    "packages/ipp/package.json"
    "packages/shared/package.json"
    "packages/testkit/package.json"
  ]
}

def production-install-stamp-path [] {
  ".ipp-orch-production-install.sha256"
}

def production-install-fingerprint [] {
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

def production-install-current [] {
  let stamp_path = (production-install-stamp-path)
  if (not ("node_modules" | path exists)) or (not ($stamp_path | path exists)) {
    false
  } else {
    ((open --raw $stamp_path | str trim) == (production-install-fingerprint))
  }
}

def install-production-dependencies [] {
  let fingerprint = (production-install-fingerprint)

  if (production-install-current) {
    print "production dependencies already current; skipping bun install"
  } else {
    ^bun install --frozen-lockfile --ignore-scripts --production
    $fingerprint | save --force (production-install-stamp-path)
  }
}

def remote-deploy [app_dir: string] {
  let bun_bin = ($nu.home-dir | path join ".bun/bin")
  if (($env.PATH | describe) =~ "^list") {
    $env.PATH = ([$bun_bin] ++ $env.PATH)
  } else {
    $env.PATH = $"($bun_bin):($env.PATH)"
  }

  cd $app_dir

  run-timed "production dependency check/install" {
    install-production-dependencies
  }

  run-timed "install systemd units" {
    ^nu scripts/install-systemd.nu
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

def local-deploy [] {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let pi_host = (get-config $dotenv PI_HOST "pi@print-server.local")
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let ssh_key_path = ((get-config $dotenv PI_SSH_KEY_PATH (default-ssh-key-path)) | path expand)
  let env_content = (local-service-env-content $root_dir $dotenv)

  [nu bun rsync ssh] | each {|command| require-command $command} | ignore

  run-timed "local typescript build" {
    cd $root_dir
    ^bun run build
  }

  run-timed "rsync repository to pi" {
    let exclude_args = (deploy-excludes | each {|exclude| ["--exclude" $exclude]} | flatten)
    let command = (
      (rsync-args $ssh_key_path --batch)
      ++ ["-az" "--delete"]
      ++ $exclude_args
      ++ [$"($root_dir)/" $"($pi_host):($app_dir)/"]
    )
    run-external ...$command
  }

  run-timed "sync service environment to pi" {
    sync-service-env $pi_host $ssh_key_path $env_content
  }

  run-timed "remote install/build/restart" {
    let remote_script = ($app_dir | path join "scripts/deploy-pi.nu")
    let remote_command = (
      ["nu" "--no-config-file" $remote_script "--remote-run" "--app-dir" $app_dir]
    )

    let command = ((ssh-args $pi_host $ssh_key_path --batch --tty) ++ $remote_command)
    run-external ...$command
  }

  let port = (get-config $dotenv IPP_ORCH_BIND_PORT "4310")

  print ""
  print "Deployment complete."
  print ""
  print "Useful follow-up commands on the Pi:"
  print $"  ssh ($pi_host)"
  print "  sudo systemctl status ipp-print-orchestrator"
  print "  journalctl -u ipp-print-orchestrator -f"
  print $"  curl http://127.0.0.1:($port)/v1/health"
  print $"  curl http://127.0.0.1:($port)/v1/status"
  print "  lpstat -p"
  print "  lpstat -t"
  print ""
  print "Useful remote commands from your laptop:"
  print "  nu scripts/watch-pi-status.nu"
  print $"  ssh ($pi_host) 'journalctl -u ipp-print-orchestrator -f --no-pager'"
}

def main [
  --remote-run
  --app-dir: string = ""
] {
  if $remote_run {
    let resolved_app_dir = if (has-value $app_dir) { $app_dir } else { "/home/pi/apps/ipp-print-orchestrator" }
    remote-deploy $resolved_app_dir
  } else {
    local-deploy
  }
}
