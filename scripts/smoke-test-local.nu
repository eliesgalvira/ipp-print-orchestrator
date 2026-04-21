#!/usr/bin/env nu

use lib/env.nu has-value
use lib/repo.nu repo-root

def cleanup [job_id: int, tmp_file: path, log_file: path]: nothing -> nothing {
  if $job_id != null {
    try { job kill $job_id }
  }

  try { rm -f $tmp_file }
  try { rm -f $log_file }
}

def curl-complete [url: string]: nothing -> record<exit_code: int, stdout: string, stderr: string> {
  ^curl -fsS $url | complete
}

def main []: nothing -> nothing {
  let root_dir = (repo-root)
  let port = (if (has-value ($env | get -o IPP_ORCH_BIND_PORT)) { $env.IPP_ORCH_BIND_PORT } else { "4310" })
  let data_dir = (
    if (has-value ($env | get -o IPP_ORCH_DATA_DIR)) {
      $env.IPP_ORCH_DATA_DIR
    } else {
      mktemp -d -t ipp-orch-smoke.XXXXXX
    }
  )
  let tmp_file = (mktemp -t ipp-orch-smoke-file.XXXXXX.txt)
  let log_file = (mktemp -t ipp-orch-smoke-log.XXXXXX.txt)
  let printer_name = (if (has-value ($env | get -o IPP_ORCH_PRINTER_NAME)) { $env.IPP_ORCH_PRINTER_NAME } else { "printer" })

  "smoke test document\n" | save -f $tmp_file
  let payload_base64 = (open --raw $tmp_file | encode base64)

  cd $root_dir

  let app_env = {
    IPP_ORCH_DATA_DIR: $data_dir
    IPP_ORCH_BIND_HOST: "127.0.0.1"
    IPP_ORCH_BIND_PORT: $port
    IPP_ORCH_PRINTER_NAME: $printer_name
  }

  let app_job = (job spawn --description "ipp local smoke agent" {
    with-env $app_env {
      ^bun --filter @ipp/agent dev o+e> $log_file
    }
  })

  try {
    let ready = (seq 1 40 | any {|_|
      let result = (curl-complete $"http://127.0.0.1:($port)/v1/health")
      if $result.exit_code == 0 {
        true
      } else {
        sleep 250ms
        false
      }
    })

    if not $ready {
      print -e $"agent did not become healthy; log: ($log_file)"
      if ($log_file | path exists) {
        open --raw $log_file | print -e
      }
      error make {msg: "local smoke health check timed out"}
    }

    ^curl -fsS $"http://127.0.0.1:($port)/v1/health"
    print ""
    ^curl -fsS $"http://127.0.0.1:($port)/v1/status"
    print ""

    let submit_body = ({
      fileName: "smoke.txt"
      mimeType: "text/plain"
      contentBase64: $payload_base64
    } | to json -r)

    let submit_response = (^curl -fsS -H "content-type: application/json" -d $submit_body $"http://127.0.0.1:($port)/v1/jobs")
    print $submit_response

    let job_id = ($submit_response | from json | get -o jobId)
    if not (has-value $job_id) {
      error make {msg: "failed to extract job id from submit response"}
    }

    ^curl -fsS $"http://127.0.0.1:($port)/v1/jobs/($job_id)"
    print ""

    let state_file = ($data_dir | path join "jobs" $job_id "state.json")
    let outbox_file = ($data_dir | path join "outbox/events.jsonl")

    if not ($state_file | path exists) {
      error make {msg: $"missing job state file: ($state_file)"}
    }

    if not ($outbox_file | path exists) {
      error make {msg: $"missing outbox file: ($outbox_file)"}
    }

    cleanup $app_job $tmp_file $log_file
    print "local smoke test passed"
  } catch {|err|
    cleanup $app_job $tmp_file $log_file
    error make $err
  }
}
