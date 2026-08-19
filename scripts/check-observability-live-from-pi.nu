#!/usr/bin/env nu

use lib/env.nu [get-config has-value load-dotenv]

def require-command [name: string]: nothing -> nothing {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def required-config [dotenv: record, key: string]: nothing -> string {
  let value = ($dotenv | get -o $key)
  if not (has-value $value) {
    error make {msg: $"missing required observability check config: ($key)"}
  }
  $value | into string | str trim
}

def apl-string [value: string]: nothing -> string {
  "'" + ($value | str replace --all "\\" "\\\\" | str replace --all "'" "\\'") + "'"
}

export def trace-query [dataset: string, trace_id: string]: nothing -> string {
  $"[(apl-string $dataset)] | where trace_id == (apl-string $trace_id)" + " | summarize rows = count()"
}

def count-from-tabular-response [response: record]: nothing -> int {
  let first_column = ($response | get -o tables.0.columns.0)
  if ($first_column == null) or (($first_column | length) == 0) {
    0
  } else {
    $first_column | first | into int
  }
}

def query-axiom-trace [
  query_url: string
  query_token: string
  dataset: string
  trace_id: string
  start_time: string
]: nothing -> int {
  let payload = ({
    apl: (trace-query $dataset $trace_id)
    startTime: $start_time
  } | to json -r)
  let result = (
    ^curl
      --request POST
      --url $query_url
      --header $"Authorization: Bearer ($query_token)"
      --header "Content-Type: application/json"
      --data $payload
      --silent
      --show-error
      --fail-with-body
    | complete
  )

  if $result.exit_code != 0 {
    error make {msg: $"Axiom query failed for dataset ($dataset): ($result.stderr | str trim) ($result.stdout | str trim)"}
  }

  count-from-tabular-response ($result.stdout | from json)
}

def query-with-retries [
  query_url: string
  query_token: string
  dataset: string
  trace_id: string
  start_time: string
  --attempts: int = 6
  --delay: duration = 5sec
]: nothing -> int {
  for attempt in 1..$attempts {
    let rows = (query-axiom-trace $query_url $query_token $dataset $trace_id $start_time)
    if $rows > 0 {
      return $rows
    }
    if $attempt < $attempts {
      print $"Axiom dataset ($dataset) has no rows for trace ($trace_id); retrying attempt ($attempt + 1)/($attempts)"
      sleep $delay
    }
  }
  0
}

def trigger-http-observability [dotenv: record]: nothing -> record {
  let host = (get-config $dotenv IPP_ORCH_BIND_HOST "127.0.0.1")
  let port = (get-config $dotenv IPP_ORCH_BIND_PORT "4310")
  let url = $"http://($host):($port)/v1/status"
  let headers_path = (mktemp)
  let start_time = (date now | date to-timezone UTC | format date "%Y-%m-%dT%H:%M:%SZ")

  try {
    let result = (
      ^curl
        --fail
        --silent
        --show-error
        --connect-timeout 1
        --max-time 3
        --dump-header $headers_path
        --output /dev/null
        $url
      | complete
    )
    if $result.exit_code != 0 {
      error make {msg: $"could not trigger status HTTP telemetry at ($url): ($result.stderr | str trim)"}
    }

    let trace_id = (
      open --raw $headers_path
      | lines
      | where {|line| $line =~ "(?i)^x-ipp-orch-trace-id:"}
      | first
      | split row ":"
      | skip 1
      | str join ":"
      | str trim
    )
    if ($trace_id | str length) == 0 {
      error make {msg: "status response did not include x-ipp-orch-trace-id"}
    }

    rm --force $headers_path
    {trace_id: $trace_id, start_time: $start_time}
  } catch {|err|
    rm --force $headers_path
    error make $err
  }
}

def main []: nothing -> nothing {
  require-command curl

  let dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
  let query_url = (required-config $dotenv AXIOM_QUERY_URL)
  let query_token = (required-config $dotenv AXIOM_QUERY_TOKEN)
  let datasets = [
    {signal: "logs", name: (required-config $dotenv AXIOM_LOGS_DATASET)}
    {signal: "traces", name: (required-config $dotenv AXIOM_TRACES_DATASET)}
  ]
  let check = (trigger-http-observability $dotenv)
  mut failures = []

  for dataset in $datasets {
    let rows = (query-with-retries $query_url $query_token $dataset.name $check.trace_id $check.start_time)
    print $"Axiom ($dataset.signal) dataset ($dataset.name): ($rows) rows for trace ($check.trace_id)"
    if $rows == 0 {
      $failures = ($failures | append $"($dataset.name) did not receive trace ($check.trace_id)")
    }
  }

  if (($failures | length) > 0) {
    error make {msg: $"Axiom observability check failed: ($failures | str join '; ')"}
  }
}
