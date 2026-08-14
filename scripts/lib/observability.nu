use env.nu [has-value]

export def service-env-keys []: nothing -> list<string> {
  [
    "IPP_ORCH_PRINTER_NAME"
    "IPP_ORCH_BIND_HOST"
    "IPP_ORCH_BIND_PORT"
    "IPP_ORCH_USB_SYSFS_ROOT"
    "IPP_ORCH_HEARTBEAT_INTERVAL_MS"
    "IPP_ORCH_LOG_PRETTY"
    "IPP_ORCH_ENABLE_OTLP"
    "OTEL_EXPORTER_OTLP_ENDPOINT"
    "OTEL_EXPORTER_OTLP_HEADERS"
    "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"
    "OTEL_EXPORTER_OTLP_TRACES_HEADERS"
    "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT"
    "OTEL_EXPORTER_OTLP_LOGS_HEADERS"
    "OTEL_RESOURCE_ATTRIBUTES"
    "AXIOM_QUERY_TOKEN"
    "AXIOM_API_TOKEN"
    "AXIOM_QUERY_DOMAIN"
  ]
}

export def parse-otel-headers [value: string]: nothing -> record {
  $value
  | split row ","
  | reduce -f {} {|entry, acc|
      let trimmed = ($entry | str trim)

      if (($trimmed | str length) == 0) or (not ($trimmed | str contains "=")) {
        $acc
      } else {
        let parts = ($trimmed | split row "=")
        let key = ($parts | first | str trim | str downcase)
        let header_value = ($parts | skip 1 | str join "=" | str trim)

        if (($key | str length) == 0) or (($header_value | str length) == 0) {
          $acc
        } else {
          $acc | upsert $key $header_value
        }
      }
    }
}

def signal-key-prefix [signal: string]: nothing -> string {
  if $signal == "logs" {
    "OTEL_EXPORTER_OTLP_LOGS"
  } else if $signal == "traces" {
    "OTEL_EXPORTER_OTLP_TRACES"
  } else {
    error make {msg: $"unsupported OTLP signal: ($signal)"}
  }
}

def trim-trailing-slash []: string -> string {
  mut trimmed = $in

  while (($trimmed | str ends-with "/") and (($trimmed | str length) > 0)) {
    $trimmed = ($trimmed | str substring 0..-2)
  }

  $trimmed
}

export def derive-signal-endpoint [shared_endpoint: any, signal: string]: nothing -> any {
  if not (has-value $shared_endpoint) {
    null
  } else {
    let normalized = ($shared_endpoint | into string | str trim | trim-trailing-slash)
    if ($normalized | str ends-with "/v1") {
      $"($normalized)/($signal)"
    } else {
      $"($normalized)/v1/($signal)"
    }
  }
}

export def otel-signal-config [dotenv: record, signal: string]: nothing -> record {
  let prefix = (signal-key-prefix $signal)
  let endpoint_key = $"($prefix)_ENDPOINT"
  let headers_key = $"($prefix)_HEADERS"
  let specific_endpoint = ($dotenv | get -o $endpoint_key)
  let shared_endpoint = ($dotenv | get -o OTEL_EXPORTER_OTLP_ENDPOINT)
  let specific_headers = ($dotenv | get -o $headers_key)
  let shared_headers = ($dotenv | get -o OTEL_EXPORTER_OTLP_HEADERS)
  let endpoint = if (has-value $specific_endpoint) {
    $specific_endpoint | into string | str trim
  } else {
    derive-signal-endpoint $shared_endpoint $signal
  }
  let headers_raw = if (has-value $specific_headers) {
    $specific_headers | into string | str trim
  } else if (has-value $shared_headers) {
    $shared_headers | into string | str trim
  } else {
    ""
  }
  let headers = (parse-otel-headers $headers_raw)

  {
    signal: $signal
    endpoint: $endpoint
    headers_raw: $headers_raw
    authorization: ($headers | get -o authorization)
    dataset: ($headers | get -o x-axiom-dataset)
  }
}

export def validate-observability-env [dotenv: record]: nothing -> nothing {
  let enabled = (($dotenv | get -o IPP_ORCH_ENABLE_OTLP | default "" | into string | str downcase) == "true")

  if not $enabled {
    return
  }

  mut missing = []

  for signal in ["traces" "logs"] {
    let config = (otel-signal-config $dotenv $signal)

    if not (has-value $config.endpoint) {
      $missing = ($missing | append $"OTEL_EXPORTER_OTLP_($signal | str upcase)_ENDPOINT or OTEL_EXPORTER_OTLP_ENDPOINT")
    } else if (($config.endpoint | into string) | str contains "axiom.co") {
      if not (has-value $config.authorization) {
        $missing = ($missing | append $"OTEL_EXPORTER_OTLP_($signal | str upcase)_HEADERS authorization=Bearer ...")
      }

      if not (has-value $config.dataset) {
        $missing = ($missing | append $"OTEL_EXPORTER_OTLP_($signal | str upcase)_HEADERS x-axiom-dataset=...")
      }
    }
  }

  if (($missing | length) > 0) {
    error make {msg: $"IPP_ORCH_ENABLE_OTLP=true but required OTLP config is missing: ($missing | str join ', ')"}
  }
}

export def local-service-env-content [dotenv: record]: nothing -> string {
  validate-observability-env $dotenv

  service-env-keys
  | where {|key| has-value ($dotenv | get -o $key)}
  | each {|key|
      $"($key)=($dotenv | get $key)"
    }
  | append [""]
  | str join "\n"
}
