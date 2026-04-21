#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target run-ssh run-timed]
use lib/repo.nu repo-root

def main [duration_seconds: int = 45]: nothing -> any {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let remote_script = ($app_dir | path join "scripts/diagnose-usb-hotplug-live-from-pi.nu")

  run-timed $"diagnose USB hotplug on ($pi_host)" {
    run-ssh $pi_host ["nu" "--no-config-file" $remote_script ($duration_seconds | into string)] --key-path $ssh_key_path --batch
  }
}
