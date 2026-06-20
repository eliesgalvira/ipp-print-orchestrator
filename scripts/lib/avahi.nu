export def error-message [err: any]: nothing -> string {
  let maybe_msg = (try { $err | get -o msg } catch { null })
  if $maybe_msg == null {
    try { $err | to nuon } catch { "unknown error" }
  } else if (($maybe_msg | describe) == "string") {
    $maybe_msg
  } else {
    try { $maybe_msg | to nuon } catch { "unknown error" }
  }
}

export def run-required [label: string, command: list<string>]: nothing -> string {
  let result = (run-external ...$command | complete)

  if $result.exit_code != 0 {
    error make {msg: $"($label) failed: ($result.stderr | str trim)"}
  }

  $result.stdout
}

export def avahi-string [method: string]: nothing -> string {
  let result = (
    run-external
      "busctl"
      "--json=short"
      "call"
      "org.freedesktop.Avahi"
      "/"
      "org.freedesktop.Avahi.Server"
      $method
    | complete
  )

  if $result.exit_code != 0 {
    error make {msg: $"Avahi D-Bus method ($method) failed: ($result.stderr | str trim)"}
  }

  let parsed = (try {
      $result.stdout | from json
    } catch {|err|
      error make {msg: $"Avahi D-Bus method ($method) returned invalid JSON: (error-message $err)"}
    })
  let value = (try {
      $parsed | get data | get 0
    } catch {|err|
      error make {msg: $"Avahi D-Bus method ($method) did not return a string payload: (error-message $err)"}
    })

  if (($value | describe) != "string") {
    error make {msg: $"Avahi D-Bus method ($method) returned non-string payload: ($value | to nuon)"}
  }

  $value
}

export def ensure-avahi-ready [
  --refresh
]: nothing -> nothing {
  let should_start = if $refresh {
    true
  } else {
    let active = (run-external "systemctl" "is-active" "--quiet" "avahi-daemon.service" | complete)
    $active.exit_code != 0
  }

  if $should_start {
    let action = if $refresh { "restart" } else { "start" }
    run-required $"($action) Avahi daemon for mDNS hostname discovery" ["sudo" "systemctl" $action "avahi-daemon.service"] | ignore
  }

  for attempt in 1..10 {
    let result = (
      run-external
        "busctl"
        "--json=short"
        "call"
        "org.freedesktop.Avahi"
        "/"
        "org.freedesktop.Avahi.Server"
        "GetHostNameFqdn"
      | complete
    )

    if $result.exit_code == 0 {
      return
    }

    if $attempt == 10 {
      error make {msg: $"Avahi did not become ready on D-Bus: ($result.stderr | str trim)"}
    }

    sleep 1sec
  }
}

export def advertised-host []: nothing -> record<hostname: string, fqdn: string> {
  {
    hostname: (avahi-string "GetHostName" | str trim)
    fqdn: (avahi-string "GetHostNameFqdn" | str trim | str replace --regex "\\.$" "")
  }
}
