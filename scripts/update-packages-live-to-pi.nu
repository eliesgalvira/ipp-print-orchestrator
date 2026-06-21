#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target run-ssh run-timed]

const REPO_ROOT = (path self | path dirname | path dirname)

def require-command [name: string]: nothing -> nothing {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def run-remote-update [host: string, key_path: path, app_dir: string]: nothing -> any {
  let remote_script = ($app_dir | path join "scripts/update-packages-live-from-pi.nu")
  run-ssh $host ["nu" "--no-config-file" $remote_script] --key-path $key_path --batch
}

def local-main []: nothing -> nothing {
  let dotenv = (load-dotenv ($REPO_ROOT | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")

  require-command ssh

  run-timed "remote package update" {
    run-remote-update $pi_host $ssh_key_path $app_dir
  }
}

def main []: nothing -> nothing {
  local-main
}
