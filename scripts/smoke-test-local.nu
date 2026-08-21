#!/usr/bin/env nu

use lib/env.nu has-value
use lib/repo.nu repo-root

def cleanup [job_id: int, log_file: path, headers_file: path]: nothing -> nothing {
  try { job kill $job_id }
  try { rm -f $log_file }
  try { rm -f $headers_file }
}

def main []: nothing -> nothing {
  let root_dir = (repo-root)
  let port = if (has-value ($env | get -o IPP_ORCH_BIND_PORT)) {
    $env.IPP_ORCH_BIND_PORT
  } else {
    "4310"
  }
  let log_file = (mktemp -t ipp-orch-smoke-log.XXXXXX.txt)
  let headers_file = (mktemp -t ipp-orch-smoke-headers.XXXXXX.txt)
  let queue_name = if (has-value ($env | get -o IPP_ORCH_PRINTER_NAME)) {
    $env.IPP_ORCH_PRINTER_NAME
  } else {
    "printer"
  }

  cd $root_dir
  let app_job = (job spawn --description "ipp local smoke agent" {
    with-env {
      IPP_ORCH_BIND_HOST: "127.0.0.1"
      IPP_ORCH_BIND_PORT: $port
      IPP_ORCH_PRINTER_NAME: $queue_name
    } {
      ^bun --filter @ipp/agent dev o+e> $log_file
    }
  })

  try {
    let ready = (seq 1 40 | any {|_|
      let result = (^curl -fsS $"http://127.0.0.1:($port)/v1/health" | complete)
      if $result.exit_code == 0 {
        true
      } else {
        sleep 250ms
        false
      }
    })

    if not $ready {
      if ($log_file | path exists) {
        open --raw $log_file | print -e
      }
      error make {msg: "local smoke health check timed out"}
    }

    ^curl -fsS $"http://127.0.0.1:($port)/v1/health"
    print ""
    ^curl -fsS --dump-header $headers_file $"http://127.0.0.1:($port)/v1/status"
    print ""
    let has_trace_id = (
      open --raw $headers_file
      | lines
      | any {|line| $line =~ "(?i)^x-ipp-orch-trace-id:"}
    )
    if not $has_trace_id {
      error make {msg: "status response did not include x-ipp-orch-trace-id"}
    }

    cleanup $app_job $log_file $headers_file
    print "local smoke test passed"
  } catch {|err|
    cleanup $app_job $log_file $headers_file
    error make $err
  }
}
