#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu ssh-args
use lib/repo.nu repo-root

def default-ssh-key-path [] {
  $nu.home-path | path join ".ssh/ipp-print-orchestrator-pi"
}

def run-remote [host: string, key_path: path, remote_script: string] {
  let command = ((ssh-args $host $key_path --batch) ++ ["nu" "-c" $remote_script])
  run-external ...$command
}

def main [] {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let pi_host = (get-config $dotenv PI_HOST "pi@print-server.local")
  let ssh_key_path = ((get-config $dotenv PI_SSH_KEY_PATH (default-ssh-key-path)) | path expand)
  let default_port = (get-config $dotenv IPP_ORCH_BIND_PORT "4310")

  let remote_script = ('
def has-value [value] {
  if $value == null { false } else { (($value | into string | str trim | str length) > 0) }
}

def trim-quotes [value: string] {
  let trimmed = ($value | str trim)
  if (($trimmed | str length) >= 2) and (($trimmed | str starts-with "\"") and ($trimmed | str ends-with "\"")) {
    $trimmed | str substring 1..-2
  } else {
    $trimmed
  }
}

def load-dotenv [path: path] {
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

def get-value [dotenv: record, key: string, fallback: string] {
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

^curl -fsS $"http://($host):($port)/v1/health"
print ""
^curl -fsS $"http://($host):($port)/v1/status"
print ""
^lpstat -p
^lpstat -t

let printer_result = (^lpstat -p $printer_name | complete)
if $printer_result.exit_code != 0 {
  print -e $"Configured printer ($printer_name) not found in CUPS"
  exit 1
}

print "pi smoke test passed"
' | str replace "__PORT__" ($default_port | into string))

  run-remote $pi_host $ssh_key_path $remote_script
}
