#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu *
use lib/repo.nu *

def require-command [name: string]: nothing -> nothing {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def service-env-keys []: nothing -> list<string> {
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

def local-service-env-content [root_dir: path, dotenv: record]: nothing -> string {
  let example_dotenv = (load-dotenv ($root_dir | path join ".env.example"))
  let service_dotenv = ($example_dotenv | merge $dotenv)

  service-env-keys
  | where {|key| ($service_dotenv | get -o ($key | into cell-path)) != null}
  | each {|key|
      let key_path = ($key | into cell-path)
      $"($key)=($service_dotenv | get $key_path)"
    }
  | append [""]
  | str join "\n"
}

def sync-service-env [host: string, key_path: path, env_content: string]: nothing -> any {
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
  run-remote-nu-source $host $remote_script --key-path $key_path --batch
}

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

def remote-deploy [app_dir: string]: nothing -> nothing {
  ensure-user-bun-on-path

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

def local-deploy []: nothing -> nothing {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let env_content = (local-service-env-content $root_dir $dotenv)

  [nu bun rsync ssh] | each {|command| require-command $command} | ignore

  run-timed "local typescript build" {
    cd $root_dir
    ^bun run build
  }

  run-timed "rsync repository to pi" {
    let exclude_args = (deploy-excludes | each {|exclude| ["--exclude" $exclude]} | flatten)
    let command = (
      (rsync-args --key-path $ssh_key_path --batch)
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
    run-ssh $pi_host ["nu" "--no-config-file" $remote_script "--remote-run" "--app-dir" $app_dir] --key-path $ssh_key_path --batch --tty
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
] : nothing -> nothing {
  if $remote_run {
    let resolved_app_dir = if (has-value $app_dir) { $app_dir } else { "/home/pi/apps/ipp-print-orchestrator" }
    remote-deploy $resolved_app_dir
  } else {
    local-deploy
  }
}
