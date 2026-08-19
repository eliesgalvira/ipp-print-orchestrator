use env.nu [has-value]

export def service-env-keys []: nothing -> list<string> {
  [
    "IPP_ORCH_PRINTER_NAME"
    "IPP_ORCH_BIND_HOST"
    "IPP_ORCH_BIND_PORT"
    "IPP_ORCH_USB_SYSFS_ROOT"
    "IPP_ORCH_USB_VENDOR_ID"
    "IPP_ORCH_USB_PRODUCT_ID"
    "IPP_ORCH_USB_SERIAL"
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
    "AXIOM_QUERY_URL"
    "AXIOM_QUERY_TOKEN"
    "AXIOM_LOGS_DATASET"
    "AXIOM_TRACES_DATASET"
  ]
}

export def local-service-env-content [dotenv: record]: nothing -> string {
  service-env-keys
  | where {|key| has-value ($dotenv | get -o $key)}
  | each {|key| $"($key)=($dotenv | get $key)"}
  | append [""]
  | str join "\n"
}
