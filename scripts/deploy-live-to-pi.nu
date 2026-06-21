#!/usr/bin/env nu

use lib/env.nu *
use lib/observability.nu [local-service-env-content]
use lib/remote.nu *
use lib/repo.nu *

const SERVICE_ENV_FILE_MODE = "0644" # non-secret service config; readable by operators and systemd.

def require-command [name: string]: nothing -> nothing {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def sync-service-env [
  host: string
  key_path: path
  env_content: string
  --control-path: path
  --connect-timeout: int
  --connection-attempts: int
]: nothing -> any {
  let remote_script_template = '
let env_content = __ENV_CONTENT_NUON__
let service_env_file_mode = "__SERVICE_ENV_FILE_MODE__"
let tmp_env = (mktemp)

try {
  ($env_content + "\n") | save --force $tmp_env
  run-external "sudo" "install" "-m" $service_env_file_mode $tmp_env "/etc/ipp-print-orchestrator.env"
} catch {|err|
  rm --force $tmp_env
  error make $err
}

rm --force $tmp_env
'
  let remote_script = (
    $remote_script_template
    | str replace "__ENV_CONTENT_NUON__" ($env_content | to nuon)
    | str replace "__SERVICE_ENV_FILE_MODE__" $SERVICE_ENV_FILE_MODE
  )
  run-remote-nu-source $host $remote_script --key-path $key_path --control-path $control_path --connect-timeout $connect_timeout --connection-attempts $connection_attempts --batch
}

def local-deploy []: nothing -> nothing {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let env_content = (local-service-env-content $dotenv)
  let ssh_connect_timeout = 3
  let ssh_connection_attempts = 5

  [nu bun rsync ssh] | each {|command| require-command $command} | ignore

  run-timed "local typescript build" {
    cd $root_dir
    ^bun run build
  }

  let control_dir = (mktemp --directory)
  let control_path = ($control_dir | path join "ssh-control")

  try {
    run-timed "start ssh control connection" {
      start-ssh-master $pi_host $ssh_key_path $control_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts --batch
    }

    print $"[(date now | format date "%+")] reuse ssh control connection for deploy phases"

    run-timed "rsync repository to pi" {
      let exclude_args = (deploy-excludes | each {|exclude| ["--exclude" $exclude]} | flatten)
      let command = (
        (
          rsync-args
            --key-path $ssh_key_path
            --control-path $control_path
            --connect-timeout $ssh_connect_timeout
            --connection-attempts $ssh_connection_attempts
            --batch
        )
        ++ ["-az" "--delete"]
        ++ $exclude_args
        ++ [$"($root_dir)/" $"($pi_host):($app_dir)/"]
      )
      run-with-retries "rsync repository to pi" {
        run-external ...$command
      } --attempts 5 --delay 2sec
    }

    run-timed "sync service environment to pi" {
      run-with-retries "sync service environment to pi" {
        sync-service-env $pi_host $ssh_key_path $env_content --control-path $control_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts
      } --attempts 5 --delay 2sec
    }

    run-timed "remote install/build/restart" {
      let remote_script = ($app_dir | path join "scripts/deploy-live-from-pi.nu")
      run-with-retries "remote install/build/restart" {
        run-ssh $pi_host ["nu" "--no-config-file" $remote_script "--app-dir" $app_dir] --key-path $ssh_key_path --control-path $control_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts --batch --tty
      } --attempts 5 --delay 2sec
    }
  } finally {
    run-timed "stop ssh control connection" {
      stop-ssh-master $pi_host $control_path
    }
    rm --recursive --force $control_dir
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
  print "  nu scripts/watch-status-live-to-pi.nu"
  print $"  ssh ($pi_host) 'journalctl -u ipp-print-orchestrator -f --no-pager'"
}

def main []: nothing -> nothing {
  local-deploy
}
