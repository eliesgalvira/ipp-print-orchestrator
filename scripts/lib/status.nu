export def require-ready-status [status: record]: nothing -> nothing {
  let missing = [
    (if (($status | get -o appUp) != true) { "appUp" } else { null })
    (if (($status | get -o printerReady) != true) { "printerReady" } else { null })
  ] | compact

  if not ($missing | is-empty) {
    let details = [
      $"cupsReachable=(($status | get -o cupsReachable) | default false)"
      $"cupsQueueAvailable=(($status | get -o cupsQueueAvailable) | default false)"
      $"usbDeviceState=(($status | get -o usbDeviceState) | default unknown)"
    ] | str join ", "
    error make {msg: $"Pi is not ready: expected true for ($missing | str join ', '); ($details)"}
  }
}
