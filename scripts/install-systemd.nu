#!/usr/bin/env nu

use lib/env.nu has-value
use lib/remote.nu run-sudo
use lib/repo.nu repo-root

def main [
  --sudo-stdin
] {
  let sudo_password = if $sudo_stdin {
    let input = ($in | into string | str trim --right)
    if (has-value $input) { $input } else { null }
  } else {
    null
  }

  let root_dir = (repo-root)
  let systemd_dir = ($root_dir | path join "systemd")

  run-sudo $sudo_password ["install" "-d" "/etc/systemd/system"]
  run-sudo $sudo_password ["install" "-m" "0644" ($systemd_dir | path join "ipp-print-orchestrator.service") "/etc/systemd/system/ipp-print-orchestrator.service"]
  run-sudo $sudo_password ["install" "-m" "0644" ($systemd_dir | path join "ipp-print-orchestrator-heartbeat.service") "/etc/systemd/system/ipp-print-orchestrator-heartbeat.service"]
  run-sudo $sudo_password ["install" "-m" "0644" ($systemd_dir | path join "ipp-print-orchestrator-heartbeat.timer") "/etc/systemd/system/ipp-print-orchestrator-heartbeat.timer"]

  if not ("/etc/ipp-print-orchestrator.env" | path exists) {
    run-sudo $sudo_password ["install" "-m" "0644" ($root_dir | path join ".env.example") "/etc/ipp-print-orchestrator.env"]
  }

  run-sudo $sudo_password ["systemctl" "daemon-reload"]
  run-sudo $sudo_password ["systemctl" "enable" "ipp-print-orchestrator.service"]
  run-sudo $sudo_password ["systemctl" "enable" "ipp-print-orchestrator-heartbeat.timer"]

  print "systemd units installed"
}
