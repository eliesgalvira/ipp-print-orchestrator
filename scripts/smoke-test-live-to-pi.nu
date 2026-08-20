#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target run-remote-nu-source]
use lib/repo.nu repo-root

def main []: nothing -> any {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let default_port = (get-config $dotenv IPP_ORCH_BIND_PORT "4310")

  let remote_script = ('
use __APP_DIR__/scripts/lib/cups-tls.nu [certificate-covers-identity current-cups-tls-identity served-cups-tls-certificate]
use __APP_DIR__/scripts/lib/status.nu require-ready-status

def has-value [value: any]: nothing -> bool {
  if $value == null { false } else { (($value | into string | str trim | str length) > 0) }
}

def trim-quotes [value: string]: nothing -> string {
  let trimmed = ($value | str trim)
  if (($trimmed | str length) >= 2) and (($trimmed | str starts-with "\"") and ($trimmed | str ends-with "\"")) {
    $trimmed | str substring 1..-2
  } else {
    $trimmed
  }
}

def load-dotenv [path: path]: nothing -> record {
  if not ($path | path exists) {
    {}
  } else {
    open --raw $path
    | lines
    | reduce -f {} {|line, acc|
        let trimmed = ($line | str trim)
        if (($trimmed | str length) == 0) or ($trimmed | str starts-with "#") or (not ($trimmed | str contains "=")) {
          $acc
        } else {
          let parts = ($trimmed | split row "=")
          let raw_value = ($parts | skip 1 | str join "=")
          $acc | upsert ($parts | first | str trim) (trim-quotes $raw_value)
        }
      }
  }
}

def get-value [dotenv: record, key: cell-path, fallback: string]: nothing -> string {
  let env_value = ($env | get -o $key)
  if (has-value $env_value) {
    $env_value
  } else {
    let file_value = ($dotenv | get -o $key)
    if (has-value $file_value) { $file_value } else { $fallback }
  }
}

let dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
let host = (get-value $dotenv IPP_ORCH_BIND_HOST "127.0.0.1")
let port = (get-value $dotenv IPP_ORCH_BIND_PORT "__PORT__")
let printer_name = (get-value $dotenv IPP_ORCH_PRINTER_NAME "printer")

let health = (^curl -fsS $"http://($host):($port)/v1/health" | from json)
let status = (^curl -fsS $"http://($host):($port)/v1/status" | from json)
print ($health | to json --raw)
print ($status | to json --raw)
require-ready-status $status

let tls_identity = (current-cups-tls-identity "/etc/cups/ssl")
let served_certificate = (served-cups-tls-certificate $tls_identity)
if not (certificate-covers-identity $served_certificate $tls_identity) {
  error make {msg: "CUPS is not serving a certificate for its advertised identity"}
}

^lpstat -p
^lpstat -t

let printer_result = (^lpstat -p $printer_name | complete)
if $printer_result.exit_code != 0 {
  print -e $"Configured printer ($printer_name) not found in CUPS"
  exit 1
}

print "pi smoke test passed"
'
  | str replace --all "__APP_DIR__" $app_dir
  | str replace "__PORT__" ($default_port | into string))

  run-remote-nu-source $pi_host $remote_script --key-path $ssh_key_path --batch
}
