export def require-ready-status [status: record]: nothing -> nothing {
  let missing = [
    {field: "appUp", value: ($status | get -o appUp)}
    {field: "cupsReachable", value: ($status | get -o cupsReachable)}
    {field: "printerAttached", value: ($status | get -o printerAttached)}
    {field: "printerQueueAvailable", value: ($status | get -o printerQueueAvailable)}
  ]
  | where value != true
  | get field

  if not ($missing | is-empty) {
    error make {msg: $"Pi is not ready: expected true for ($missing | str join ', ')"}
  }
}
