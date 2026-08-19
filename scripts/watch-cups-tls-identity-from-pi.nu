#!/usr/bin/env nu

use lib/avahi.nu run-required
use lib/cups-tls.nu [certificate-covers-identity current-cups-tls-identity]
use lib/repo.nu repo-root

const CUPS_SSL_DIR = "/etc/cups/ssl"
const LOCK_DIR = "/run/ipp-print-orchestrator"
const REPAIR_LOCK = "/run/ipp-print-orchestrator/cups-tls-repair.lock"
const LOCK_DIRECTORY_MODE = "0755"

def repair-cups-tls-identity []: nothing -> nothing {
  run-required "create CUPS TLS repair lock directory" ["sudo" "install" "-d" "-m" $LOCK_DIRECTORY_MODE $LOCK_DIR] | ignore

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

def repair-if-certificate-is-stale []: nothing -> nothing {
  let identity = (current-cups-tls-identity $CUPS_SSL_DIR)
  if (certificate-covers-identity $identity.cert_path $identity) {
    return
  }

  print $"CUPS TLS certificate does not match the current DNS names and IP addresses; repairing ($identity.cert_path)."
  repair-cups-tls-identity
}

def main [
  --once
  --interval: duration = 30sec
]: nothing -> nothing {
  repair-if-certificate-is-stale

  if $once {
    return
  }

  loop {
    sleep $interval
    repair-if-certificate-is-stale
  }
}
