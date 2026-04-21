#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target run-remote-nu-source run-timed]
use lib/repo.nu repo-root

def main []: nothing -> any {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")

  let remote_script = $"
let app_dir = ($app_dir | to nuon)

if not \($app_dir | path exists\) {
  error make {msg: $\"app directory not found on Pi: \($app_dir\). Run nu scripts/bootstrap-live-to-pi.nu and nu scripts/deploy-live-to-pi.nu first.\"}
}

cd $app_dir

if not \(\"scripts/install-systemd-live-from-pi.nu\" | path exists\) {
  error make {msg: $\"systemd installer not found under \($app_dir\). Run nu scripts/deploy-live-to-pi.nu first.\"}
}

^nu --no-config-file scripts/install-systemd-live-from-pi.nu
"

  run-timed $"install systemd units on ($pi_host)" {
    run-remote-nu-source $pi_host $remote_script --key-path $ssh_key_path --batch
  }
}
