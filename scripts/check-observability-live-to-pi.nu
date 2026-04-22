#!/usr/bin/env nu

use lib/env.nu [get-config load-dotenv]
use lib/remote.nu [remote-target run-ssh]
use lib/repo.nu [repo-root]

def main [
  --lookback: duration = 30min
  --allow-empty
]: nothing -> nothing {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let remote_script = ($app_dir | path join "scripts/check-observability-live-from-pi.nu")
  let allow_empty_args = if $allow_empty { ["--allow-empty"] } else { [] }

  run-ssh $target.host (["nu" "--no-config-file" $remote_script "--lookback" ($lookback | into string)] ++ $allow_empty_args) --key-path $target.key_path --connect-timeout 3 --connection-attempts 1 --batch
}
