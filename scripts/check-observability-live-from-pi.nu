#!/usr/bin/env nu

use lib/env.nu [get-config has-value load-dotenv]
use lib/observability.nu [otel-signal-config validate-observability-env]

def require-command [name: string]: nothing -> nothing {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def query-url-for-otlp-endpoint [endpoint: string, query_domain: any]: nothing -> string {
  let base = if (has-value $query_domain) {
    $query_domain | into string
  } else if ($endpoint | str contains "/v1/") {
    $endpoint | split row "/v1/" | first
  } else if ($endpoint | str ends-with "/v1") {
    $endpoint | str substring 0..-4
  } else {
    $endpoint
  }

  $"($base)/v1/query/_apl?format=tabular"
}

def query-authorization [dotenv: record, signal_config: record]: nothing -> record {
  let query_token = ($dotenv | get -o AXIOM_QUERY_TOKEN)
  let api_token = ($dotenv | get -o AXIOM_API_TOKEN)

  if (has-value $query_token) {
    {value: $"Bearer ($query_token)", source: "AXIOM_QUERY_TOKEN"}
  } else if (has-value $api_token) {
    {value: $"Bearer ($api_token)", source: "AXIOM_API_TOKEN"}
  } else {
    {value: $signal_config.authorization, source: $"OTLP ($signal_config.signal) authorization header"}
  }
}

def count-from-tabular-response [response: record]: nothing -> int {
  let first_column = ($response | get -o tables.0.columns.0)

  if ($first_column == null) or (($first_column | length) == 0) {
    0
  } else {
    $first_column | first | into int
  }
}

def query-axiom-count [
  dotenv: record
  signal_config: record
  start_time: string
]: nothing -> int {
  let auth = (query-authorization $dotenv $signal_config)
  let query_url = (query-url-for-otlp-endpoint $signal_config.endpoint ($dotenv | get -o AXIOM_QUERY_DOMAIN))
  let apl = $"['($signal_config.dataset)'] | summarize rows = count()"
  let payload = ({apl: $apl, startTime: $start_time} | to json -r)
  let result = (
    ^curl
      --request POST
      --url $query_url
      --header $"Authorization: ($auth.value)"
      --header "Content-Type: application/json"
      --data $payload
      --silent
      --show-error
      --fail-with-body
    | complete
  )

  if $result.exit_code != 0 {
    let permission_hint = if (($result.stdout | str contains "\"code\":403") or ($result.stderr | str contains "403")) {
      $" Set AXIOM_QUERY_TOKEN to an Axiom token with query access if ($auth.source) is ingest-only."
    } else {
      ""
    }
    error make {msg: $"Axiom ($signal_config.signal) query failed for dataset ($signal_config.dataset) using ($auth.source): ($result.stderr | str trim) ($result.stdout | str trim)($permission_hint)"}
  }

  count-from-tabular-response ($result.stdout | from json)
}

def query-with-retries [
  dotenv: record
  signal_config: record
  start_time: string
  --attempts: int = 6
  --delay: duration = 5sec
]: nothing -> int {
  mut latest_count = 0

  for attempt in 1..$attempts {
    $latest_count = (query-axiom-count $dotenv $signal_config $start_time)

    if $latest_count > 0 {
      return $latest_count
    }

    if $attempt < $attempts {
      print $"Axiom ($signal_config.signal) dataset ($signal_config.dataset) has no rows yet; retrying attempt ($attempt + 1)/($attempts)"
      sleep $delay
    }
  }

  $latest_count
}

def trigger-http-observability [dotenv: record]: nothing -> nothing {
  let host = (get-config $dotenv IPP_ORCH_BIND_HOST "127.0.0.1")
  let port = (get-config $dotenv IPP_ORCH_BIND_PORT "4310")
  let url = $"http://($host):($port)/v1/status"
  let result = (^curl --fail --silent --show-error --connect-timeout 1 --max-time 3 $url | complete)

  if $result.exit_code != 0 {
    print $"warning: could not trigger status HTTP telemetry at ($url): ($result.stderr | str trim)"
  }
}

def main [
  --lookback: duration = 30min
  --allow-empty
]: nothing -> nothing {
  require-command curl

  let dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
  validate-observability-env $dotenv

  trigger-http-observability $dotenv

  let start_time = (((date now) - $lookback) | date to-timezone UTC | format date "%Y-%m-%dT%H:%M:%SZ")
  mut failures = []

  for signal in ["logs" "traces"] {
    let signal_config = (otel-signal-config $dotenv $signal)

    if not (($signal_config.endpoint | into string) | str contains "axiom.co") {
      print $"Skipping Axiom query for ($signal); endpoint is not an Axiom endpoint."
      continue
    }

    let rows = (query-with-retries $dotenv $signal_config $start_time)
    print $"Axiom ($signal) dataset ($signal_config.dataset): ($rows) rows since ($start_time)"

    if (not $allow_empty) and ($rows == 0) {
      $failures = ($failures | append $"($signal_config.dataset) had no rows since ($start_time)")
    }
  }

  if (($failures | length) > 0) {
    error make {msg: $"Axiom observability check failed: ($failures | str join '; ')"}
  }
}
