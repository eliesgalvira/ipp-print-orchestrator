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
use __APP_DIR__/scripts/lib/cups-tls.nu [cups-serves-tls-identity current-cups-tls-identity]
use __APP_DIR__/scripts/lib/env.nu [get-config load-dotenv]
use __APP_DIR__/scripts/lib/status.nu require-ready-status

let dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
let host = (get-config $dotenv IPP_ORCH_BIND_HOST "127.0.0.1")
let port = (get-config $dotenv IPP_ORCH_BIND_PORT "__PORT__")
let queue_name = (get-config $dotenv IPP_ORCH_PRINTER_NAME "printer")

let health = (^curl -fsS $"http://($host):($port)/v1/health" | from json)
let status = (^curl -fsS $"http://($host):($port)/v1/status" | from json)
print ($health | to json --raw)
print ($status | to json --raw)
require-ready-status $status

if not (cups-serves-tls-identity (current-cups-tls-identity "/etc/cups/ssl")) {
  error make {msg: "CUPS does not serve one certificate covering its advertised identity on every address"}
}

^lpstat -p
^lpstat -t

let queue_result = (^lpstat -p $queue_name | complete)
if $queue_result.exit_code != 0 {
  print -e $"Configured queue ($queue_name) not found in CUPS"
  exit 1
}

print "pi smoke test passed"
'
  | str replace --all "__APP_DIR__" $app_dir
  | str replace "__PORT__" ($default_port | into string))

  run-remote-nu-source $pi_host $remote_script --key-path $ssh_key_path --batch
}
