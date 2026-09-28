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
  [["-ext" "subjectAltName"]]
  | append ($identity.dns_names | each {|dns_name| [["-checkhost" $dns_name]]} | flatten)
  | append ($identity.ip_addresses | each {|ip_address| [["-checkip" $ip_address]]} | flatten)
  | all {|check| ($certificate | run-external "openssl" "x509" "-noout" ...$check | complete).exit_code == 0}
}

# The file stem CUPS uses when it looks up credentials for a name (http_gnutls_make_path in cups/tls-gnutls.c).
export def cups-credential-stem [name: string]: nothing -> string {
  $name | str replace --all --regex '[^A-Za-z0-9.-]' '_'
}

def served-cups-tls-certificate [address: string]: nothing -> string {
  let result = ("" | run-external "timeout" "5" "openssl" "s_client" "-connect" $"[($address)]:631" | complete)

  if $result.exit_code != 0 {
    error make {msg: $"fetch CUPS TLS certificate served on ($address) failed: ($result.stderr | str trim)"}
  }

  $result.stdout
}

def certificate-fingerprint [certificate: string]: nothing -> string {
  $certificate | run-external "openssl" "x509" "-noout" "-fingerprint" "-sha256" | str trim
}

# CUPS chooses credentials per connection from the local address the client reached, so the
# loopback certificate is only trustworthy if every advertised address serves the same one.
export def cups-serves-tls-identity [identity: record]: nothing -> bool {
  let certificate = (served-cups-tls-certificate "127.0.0.1")
  let fingerprint = (certificate-fingerprint $certificate)

  (certificate-covers-identity $certificate $identity) and ($identity.ip_addresses | all {|address|
    (certificate-fingerprint (served-cups-tls-certificate $address)) == $fingerprint
  })
}
