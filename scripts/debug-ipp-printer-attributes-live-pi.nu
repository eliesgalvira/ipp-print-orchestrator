#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target run-ssh run-timed]
use lib/repo.nu repo-root

def main []: nothing -> any {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let remote_script = ($app_dir | path join "scripts/debug-ipp-printer-attributes-live-on-pi.nu")

  run-timed $"debug IPP printer attributes on ($pi_host)" {
    run-ssh $pi_host ["nu" "--no-config-file" $remote_script] --key-path $ssh_key_path --batch
  }
}
