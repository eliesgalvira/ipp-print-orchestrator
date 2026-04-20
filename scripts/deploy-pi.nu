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
  $nu.home-path | path join ".ssh/ipp-print-orchestrator-pi"
}

def run-with-input [input: string, command: list<string>] {
  $input | run-external ...$command
}

def ssh-command [host: string, key_path: path, remote_command: string, use_tty: bool] {
  (ssh-args $host $key_path --batch --tty=$use_tty) ++ [$remote_command]
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

def remote-deploy [app_dir: string, sudo_password: any] {
  let bun_bin = ($env.HOME | path join ".bun/bin")
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
    if (has-value $sudo_password) {
      (($sudo_password | into string) + "\n") | ^nu --stdin scripts/install-systemd.nu --sudo-stdin
    } else {
      ^nu scripts/install-systemd.nu
    }
  }

  run-timed "restart app service" {
    run-sudo $sudo_password ["systemctl" "restart" "ipp-print-orchestrator"]
  }

  run-timed "restart heartbeat timer" {
    run-sudo $sudo_password ["systemctl" "restart" "ipp-print-orchestrator-heartbeat.timer"]
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
  let sudo_password = (required-secret $dotenv [PI_SUDO_PASSWORD PI_PASSWORD])

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

  run-timed "remote install/build/restart" {
    let sudo_flag = if (has-value $sudo_password) { " --sudo-stdin" } else { "" }
    let remote_command = $"cd ($app_dir) && nu scripts/deploy-pi.nu --remote-run --app-dir ($app_dir)($sudo_flag)"

    if (has-value $sudo_password) {
      let command = (ssh-command $pi_host $ssh_key_path $remote_command false)
      run-with-input (($sudo_password | into string) + "\n") $command
    } else {
      let command = (ssh-command $pi_host $ssh_key_path $remote_command true)
      run-external ...$command
    }
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
  --sudo-stdin
] {
  if $remote_run {
    let stdin_password = if $sudo_stdin {
      let input = ($in | into string | str trim --right)
      if (has-value $input) { $input } else { null }
    } else {
      null
    }

    let resolved_app_dir = if (has-value $app_dir) { $app_dir } else { "/home/pi/apps/ipp-print-orchestrator" }
    remote-deploy $resolved_app_dir $stdin_password
  } else {
    local-deploy
  }
}
