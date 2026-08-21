use avahi.nu [advertised-host ensure-avahi-ready run-required]

def non-empty-unique-strings [values: list<string>]: nothing -> list<string> {
  $values
  | each {|value| $value | str trim | str replace --regex "\\.$" ""}
  | where {|value| ($value | str length) > 0}
  | uniq
}

def local-ip-addresses []: nothing -> list<string> {
  run-required "detect local IP addresses" ["hostname" "-I"]
  | split row " "
  | each {|value| $value | str trim}
  | where {|value| ($value | str length) > 0}
  | where {|value| $value != "::1" and not ($value | str starts-with "127.")}
  | uniq
}

export def current-cups-tls-identity [ssl_dir: string]: nothing -> record {
  ensure-avahi-ready

  let system_hostname = (run-required "detect system hostname" ["hostname"] | str trim)
  let avahi_host = (advertised-host)
  let dns_names = (non-empty-unique-strings [
    $system_hostname
    $"($system_hostname).local"
    $avahi_host.hostname
    $"($avahi_host.hostname).local"
    $avahi_host.fqdn
    "localhost"
  ])

  {
    system_hostname: $system_hostname
    avahi_hostname: $avahi_host.hostname
    avahi_fqdn: $avahi_host.fqdn
    dns_names: $dns_names
    ip_addresses: (local-ip-addresses)
    cert_path: ($ssl_dir | path join $"($system_hostname).crt")
  }
}

export def certificate-covers-identity [
  certificate: string
  identity: record
]: nothing -> bool {
  let san_result = ($certificate | run-external "openssl" "x509" "-noout" "-ext" "subjectAltName" | complete)
  if $san_result.exit_code != 0 {
    return false
  }

  for dns_name in $identity.dns_names {
    let result = ($certificate | run-external "openssl" "x509" "-noout" "-checkhost" $dns_name | complete)
    if $result.exit_code != 0 {
      return false
    }
  }

  for ip_address in $identity.ip_addresses {
    let result = ($certificate | run-external "openssl" "x509" "-noout" "-checkip" $ip_address | complete)
    if $result.exit_code != 0 {
      return false
    }
  }

  true
}

export def served-cups-tls-certificate [identity: record]: nothing -> string {
  let result = (
    ""
    | run-external
        "timeout"
        "5"
        "openssl"
        "s_client"
        "-connect"
        "127.0.0.1:631"
        "-servername"
        $identity.avahi_fqdn
        "-showcerts"
    | complete
  )

  if $result.exit_code != 0 {
    error make {msg: $"fetch served CUPS TLS certificate failed: ($result.stderr | str trim)"}
  }

  $result.stdout
}
