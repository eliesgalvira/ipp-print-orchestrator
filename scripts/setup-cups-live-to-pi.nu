#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target run-ssh run-timed]
use lib/repo.nu repo-root

def main [
  --printer-name: string
  --driver: string
  --device-uri: string
  --enable-printing
  --stop-only
]: nothing -> any {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let remote_script = ($app_dir | path join "scripts/setup-cups-live-from-pi.nu")
  let forwarded_args = (
    []
    | append (if (has-value $printer_name) { ["--printer-name" $printer_name] } else { [] })
    | append (if (has-value $driver) { ["--driver" $driver] } else { [] })
    | append (if (has-value $device_uri) { ["--device-uri" $device_uri] } else { [] })
    | append (if $enable_printing { ["--enable-printing"] } else { [] })
    | append (if $stop_only { ["--stop-only"] } else { [] })
  )

  run-timed $"setup CUPS on ($pi_host)" {
    run-ssh $pi_host (["nu" "--no-config-file" $remote_script] ++ $forwarded_args) --key-path $ssh_key_path --batch
  }
}
