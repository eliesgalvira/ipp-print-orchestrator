#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu ssh-args
use lib/repo.nu repo-root

def format-heartbeat-age [value: any] {
  if $value == null {
    "never"
  } else {
    try {
      let elapsed = (((date now) - ($value | into datetime)) / 1sec)
      let seconds = ([$elapsed 0] | math max | math round | into int)
      $"($seconds)s"
    } catch {
      $value | into string
    }
  }
}

def format-flag [value: any, yes: string, no: string] {
  if $value == true { $yes } else { $no }
}

def format-status-line [line: string] {
  let timestamp = (date now | format date "%+")

  let status = (try { $line | from json } catch { null })
  if $status == null {
    $"[($timestamp)] invalid-json ($line)"
  } else if (($status | get -o watchError) == "status-unreachable") {
    $"[($timestamp)] status-unreachable host=($status.host) port=($status.port)"
  } else {
    let base_parts = [
      $"printer=(format-flag ($status | get -o printerAttached) attached missing)"
      $"state=(($status | get -o printerState) | default unknown)"
      $"cups=(format-flag ($status | get -o cupsReachable) up down)"
      $"net=(format-flag ($status | get -o networkOnline) online offline)"
      $"jobs=(($status | get -o nonterminalJobCount) | default 0)"
      $"queue=(($status | get -o queueDepth) | default 0)"
      $"heartbeat=(format-heartbeat-age ($status | get -o lastSuccessfulHeartbeatAt))"
    ]

    let reasons = (($status | get -o printerReasons) | default [])
    let local_ips = (($status | get -o localIps) | default [])
    let hostname = ($status | get -o hostname)

    let optional_parts = [
      (if (($reasons | length) > 0) { $"reasons=($reasons | str join ",")" } else { null })
      (if (($local_ips | length) > 0) { $"ip=($local_ips | first)" } else { null })
      (if (has-value $hostname) { $"host=($hostname)" } else { null })
    ] | where {|part| has-value $part}

    let joined_parts = ($base_parts | append $optional_parts | str join "  ")
    $"[($timestamp)] ($joined_parts)"
  }
}

def stream-remote-status [host: string, ssh_password: any, remote_script: string] {
  let command = ((ssh-args $host $ssh_password) ++ ["nu" "-c" $remote_script])

  if (has-value $ssh_password) {
    with-env {SSHPASS: $ssh_password} {
      run-external ...$command
    }
  } else {
    run-external ...$command
  }
}

def main [] {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let pi_host = (get-config $dotenv PI_HOST "pi@print-server.local")
  let ssh_password = (required-secret $dotenv [PI_SSH_PASSWORD PI_PASSWORD])
  let default_port = (get-config $dotenv IPP_ORCH_BIND_PORT "4310")
  let interval_sec = (get-config $dotenv WATCH_INTERVAL_SEC "2")

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
let interval = ("__INTERVAL__" | into int)

loop {
  let result = (^curl -fsS $"http://($host):($port)/v1/status" | complete)
  if $result.exit_code == 0 {
    print ($result.stdout | str trim)
  } else {
    print ({watchError: "status-unreachable", host: $host, port: $port} | to json -r)
  }
  sleep ($interval * 1sec)
}
' | str replace "__PORT__" ($default_port | into string) | str replace "__INTERVAL__" ($interval_sec | into string))

  stream-remote-status $pi_host $ssh_password $remote_script
  | lines
  | each {|line|
      if (($line | str trim | str length) > 0) {
        print (format-status-line $line)
      }
    }
  | ignore
}
