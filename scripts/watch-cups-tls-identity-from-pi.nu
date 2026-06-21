#!/usr/bin/env nu

use lib/avahi.nu [advertised-host ensure-avahi-ready run-required]
use lib/repo.nu repo-root

const STATE_DIR = "/run/ipp-print-orchestrator"
const STATE_FILE = "/run/ipp-print-orchestrator/cups-tls-avahi-fqdn"
const REPAIR_LOCK = "/run/ipp-print-orchestrator/cups-tls-repair.lock"
const RUNTIME_STATE_DIRECTORY_MODE = "0755" # owner can write; everyone can read/traverse runtime state paths.
const RUNTIME_STATE_FILE_MODE = "0644" # owner can write; everyone can read the last observed Avahi hostname.

def ensure-state-dir []: nothing -> nothing {
  run-required "create CUPS TLS watcher state directory" ["sudo" "install" "-d" "-m" $RUNTIME_STATE_DIRECTORY_MODE $STATE_DIR] | ignore
}

def read-last-fqdn []: nothing -> string {
  if not ($STATE_FILE | path exists) {
    return ""
  }

  open --raw $STATE_FILE | str trim
}

def write-last-fqdn [fqdn: string]: nothing -> nothing {
  ensure-state-dir

  let tmp_state = (mktemp)
  try {
    [$fqdn ""] | str join "\n" | save --force $tmp_state
    run-required "write CUPS TLS watcher state" ["sudo" "install" "-m" $RUNTIME_STATE_FILE_MODE $tmp_state $STATE_FILE] | ignore
  } catch {|err|
    rm --force $tmp_state
    error make $err
  }

  rm --force $tmp_state
}

def repair-cups-tls-identity []: nothing -> nothing {
  ensure-state-dir

  let root_dir = (repo-root)
  let setup_script = ($root_dir | path join "scripts/setup-cups-live-from-pi.nu")

  run-required "repair CUPS TLS identity" [
    "sudo"
    "flock"
    $REPAIR_LOCK
    "nu"
    "--no-config-file"
    $setup_script
    "--repair-tls-only"
  ] | ignore
}

def repair-if-avahi-hostname-changed [
  --force
]: nothing -> nothing {
  ensure-avahi-ready

  let current = (advertised-host)
  let previous_fqdn = (read-last-fqdn)

  if (not $force) and $current.fqdn == $previous_fqdn {
    return
  }

  if ($previous_fqdn | str length) == 0 {
    print $"Initial CUPS TLS identity sync for Avahi host ($current.fqdn)."
  } else if $current.fqdn == $previous_fqdn {
    print $"Forced CUPS TLS identity sync for Avahi host ($current.fqdn)."
  } else {
    print $"Avahi host changed from ($previous_fqdn) to ($current.fqdn); repairing CUPS TLS identity."
  }

  repair-cups-tls-identity
  write-last-fqdn $current.fqdn
}

def main [
  --once
  --interval: duration = 30sec
]: nothing -> nothing {
  repair-if-avahi-hostname-changed

  if $once {
    return
  }

  loop {
    sleep $interval
    repair-if-avahi-hostname-changed
  }
}
