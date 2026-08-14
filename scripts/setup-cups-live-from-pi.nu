#!/usr/bin/env nu

use lib/avahi.nu [advertised-host ensure-avahi-ready]
use lib/env.nu [get-config has-value load-dotenv]
use lib/repo.nu repo-root

const HP_ULD_PPD_PATH = "/usr/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd"
const CUPS_PDF_PREFLIGHT_FILTER_PATH = "/usr/lib/cups/filter/ipp-pdf-preflight-to-spl"
const CUPS_USB_BACKEND_WRAPPER_PATH = "/usr/lib/cups/backend/ipp-orch-usb"
const CUPS_FILTER_CACHE_DIR = "/var/cache/ipp-print-orchestrator"
const CUPS_FONTCONFIG_CACHE_DIR = "/var/cache/fontconfig"
const CUPS_SSL_DIR = "/etc/cups/ssl"
const AVAHI_IPPS_SERVICE_PATH = "/etc/avahi/services/ipp-print-orchestrator-hp135a.service"
const CUPS_TLS_CERT_DAYS = "3650"
const PUBLIC_DIRECTORY_MODE = "0755" # owner=rwx, group/other=rx.
const PUBLIC_DATA_FILE_MODE = "0644" # owner=rw, group/other=r.
const PRIVATE_SECRET_FILE_MODE = "0600" # owner=rw, no group/other access.
const ROOT_REPLACED_EXECUTABLE_FILE_MODE = "0555" # owner/group/other=rx; root replaces the file instead of editing it in place.
const CUPS_FILTER_CACHE_DIRECTORY_MODE = "0750" # lp:lp can read/write/traverse; other users get no access.
const CUPS_FONTCONFIG_CACHE_DIRECTORY_MODE = "2775" # root:lp with setgid; Ghostscript writes fontconfig caches as lp.
const CUPS_ROOT_EXECUTED_BACKEND_MODE = "0744" # owner=rwx, group/other=read-only; CUPS runs backends with no group/other execute bit as root.
const TEMP_QUEUES = [HP135a_PWG_Test HP135a_SPLIX_Test]
const HP_ULD_GRAYSCALE_8BIT = '*ColorModel Gray/Grayscale: "<</cupsColorSpace 0 /cupsBitsPerColor 8>>setpagedevice"'
const HP_ULD_RASTER_FILTER = '*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"'
const HP_ULD_PDF_PREFLIGHT_FILTER = '*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"'
const HP_ULD_STANDARD_600DPI = '*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"'
const HP_ULD_STANDARD_SAFE_300DPI = '*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"'
const LEGACY_PAGE_DEFAULT_RESET_ARGS = ["-R" "media-default" "-R" "PageSize-default"]

def run-required [label: string, command: list<string>]: nothing -> string {
  let result = (run-external ...$command | complete)

  if $result.exit_code != 0 {
    let output = (
      [$result.stderr $result.stdout]
      | each {|value| $value | str trim}
      | where {|value| ($value | str length) > 0}
      | str join "\n"
    )
    error make {msg: $"($label) failed: ($output)"}
  }

  $result.stdout
}

def run-best-effort [command: list<string>]: nothing -> nothing {
  run-external ...$command | complete | ignore
}

def run-required-with-input [label: string, command: list<string>, input: string]: nothing -> string {
  let result = ($input | run-external ...$command | complete)

  if $result.exit_code != 0 {
    error make {msg: $"($label) failed: ($result.stderr | str trim)"}
  }

  $result.stdout
}

def shell-quote [value: string]: nothing -> string {
  "'" + (($value | into string) | str replace --all "'" "'\\''") + "'"
}

def xml-escape [value: string]: nothing -> string {
  let escaped = (
    $value
  | str replace --all "&" "&amp;"
  | str replace --all "<" "&lt;"
  | str replace --all ">" "&gt;"
  | str replace --all '"' "&quot;"
  | str replace --all "'" "&apos;"
  )

  $escaped
}

def error-message [err: any]: nothing -> string {
  let maybe_msg = (try { $err | get -o msg } catch { null })
  if $maybe_msg == null {
    try { $err | to nuon } catch { "unknown error" }
  } else if (($maybe_msg | describe) == "string") {
    $maybe_msg
  } else {
    try { $maybe_msg | to nuon } catch { "unknown error" }
  }
}

def apt-package-installed [package: string]: nothing -> bool {
  let result = (run-external "dpkg-query" "-W" "-f=${Status}" $package | complete)
  $result.exit_code == 0 and ($result.stdout | str contains "install ok installed")
}

def ensure-apt-packages [packages: list<string>]: nothing -> nothing {
  let missing = ($packages | where {|package| not (apt-package-installed $package)})

  if ($missing | is-empty) {
    return
  }

  print $"Installing missing CUPS packages: ($missing | str join ', ')"
  run-required "apt update" ["sudo" "apt-get" "update"] | ignore
  run-required "apt install CUPS packages" (["sudo" "apt-get" "install" "-y"] ++ $missing) | ignore
}

def clear-spool-and-stop-cups []: nothing -> nothing {
  run-best-effort ["sudo" "timeout" "5" "systemctl" "kill" "--kill-whom=all" "--signal=KILL" "cups.service" "cups-browsed.service"]
  run-best-effort ["sudo" "timeout" "5" "systemctl" "stop" "cups.service" "cups.socket" "cups.path" "cups-browsed.service" "ipp-usb.service"]
  run-best-effort ["sudo" "killall" "-9" "cupsd" "cups-browsed" "gstoraster" "pdftopdf" "texttopdf" "rastertogutenprint.5.3" "rastertoqpdl" "rastertospl"]
  clear-spool-files
}

def clear-spool-files []: nothing -> nothing {
  let spool_files = (
    run-required "list CUPS spool files" [
      "sudo"
      "find"
      "/var/spool/cups"
      "-maxdepth"
      "1"
      "-type"
      "f"
      "("
      "-name"
      "c*"
      "-o"
      "-name"
      "d*"
      ")"
      "-print"
    ]
    | lines
  )

  for path in $spool_files {
    run-best-effort ["sudo" "rm" "-f" $path]
  }
}

def hp-usb-device-paths []: nothing -> list<string> {
  glob "/sys/bus/usb/devices/*"
  | where {|device_path|
      let vendor_path = ($device_path | path join "idVendor")
      let product_path = ($device_path | path join "idProduct")
      let has_usb_ids = (($vendor_path | path exists) and ($product_path | path exists))

      if not $has_usb_ids {
        false
      } else {
        ((open $vendor_path | str trim) == "03f0") and ((open $product_path | str trim) == "f22a")
      }
    }
}

def set-hp-usb-authorized [value: int]: nothing -> nothing {
  for device_path in (hp-usb-device-paths) {
    let authorized_path = ($device_path | path join "authorized")
    if ($authorized_path | path exists) {
      run-required-with-input $"set USB authorization for ($device_path)" ["sudo" "tee" $authorized_path] ($value | into string) | ignore
    }
  }
}

def deauthorize-hp-usb []: nothing -> nothing {
  set-hp-usb-authorized 0
}

def authorize-hp-usb []: nothing -> nothing {
  set-hp-usb-authorized 1
}

def discover-hp-usb-device-uri []: nothing -> string {
  let result = (run-external "sudo" "/usr/lib/cups/backend/usb" | complete)
  let line = (
    $result.stdout
    | lines
    | where {|line| ($line | str starts-with "direct usb://") and ($line | str contains "HP Laser MFP 131 133 135-138")}
    | first
  )

  if ($line == null) {
    error make {msg: "could not find HP Laser MFP 135a USB device URI from CUPS usb backend"}
  }

  $line | split row " " | get 1
}

def printer-device-uri-from-config [printers_conf: string, printer_name: string]: nothing -> string {
  let block = (cups-printer-block $printers_conf $printer_name)
  let line = (
    $block
    | lines
    | where {|line| ($line | str trim | str starts-with "DeviceURI ")}
    | first
  )

  if ($line == null) {
    ""
  } else {
    $line | str trim | str replace --regex "^DeviceURI\\s+" ""
  }
}

def existing-printer-device-uri [printer_name: string]: nothing -> string {
  let printers_conf = "/etc/cups/printers.conf"

  if not ($printers_conf | path exists) {
    return ""
  }

  printer-device-uri-from-config (sudo cat $printers_conf) $printer_name
}

def explicit-device-uri [device_uri: any]: nothing -> string {
  if (has-value $device_uri) {
    $device_uri | into string
  } else {
    ""
  }
}

def resolve-hp-device-uri [printer_name: string, device_uri: any]: nothing -> string {
  let explicit_uri = (explicit-device-uri $device_uri)

  if (has-value $explicit_uri) {
    return $explicit_uri
  }

  try {
    discover-hp-usb-device-uri
  } catch {|err|
    let existing_device_uri = (existing-printer-device-uri $printer_name)

    if (has-value $existing_device_uri) {
      print $"CUPS USB discovery failed; reusing existing queue device URI for ($printer_name): ($existing_device_uri)"
      return $existing_device_uri
    }

    error make $err
  }
}

def driver-available [driver: string]: nothing -> bool {
  let models = (run-required "list CUPS printer models" ["/usr/sbin/lpinfo" "-m"])
  $models | lines | any {|line| $line == $driver or ($line | str starts-with $"($driver) ")}
}

def install-root-dir [path: string]: nothing -> nothing {
  run-required $"create root-owned directory ($path)" ["sudo" "install" "-d" "-m" $PUBLIC_DIRECTORY_MODE $path] | ignore
}

def install-root-file [mode: string, source: string, destination: string]: nothing -> nothing {
  run-required $"install ($destination)" ["sudo" "install" "-m" $mode $source $destination] | ignore
}

def install-owned-dir [mode: string, owner: string, group: string, path: string]: nothing -> nothing {
  run-required $"create owned directory ($path)" ["sudo" "install" "-d" "-m" $mode "-o" $owner "-g" $group $path] | ignore
}

def install-root-symlink [target: string, link_path: string]: nothing -> nothing {
  run-required $"link ($link_path)" ["sudo" "ln" "-sf" $target $link_path] | ignore
}

def require-store-path [label: string, store_path: string]: nothing -> nothing {
  if (($store_path | str trim | str length) == 0) {
    error make {msg: $"missing --($label)-path"}
  }

  if not ($store_path | str starts-with "/nix/store/") {
    error make {msg: $"--($label)-path must be a /nix/store path, got: ($store_path)"}
  }

  if not ($store_path | path exists) {
    error make {msg: $"--($label)-path does not exist on the Pi: ($store_path)"}
  }
}

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

def indexed-alt-name-lines [kind: string, values: list<string>]: nothing -> list<string> {
  $values
  | enumerate
  | each {|entry| $"($kind).($entry.index + 1) = ($entry.item)"}
}

def cups-tls-openssl-config [
  common_name: string
  dns_names: list<string>
  ip_addresses: list<string>
]: nothing -> string {
  [
    "[req]"
    "prompt = no"
    "distinguished_name = dn"
    "x509_extensions = v3_req"
    ""
    "[dn]"
    "C = GB"
    $"CN = ($common_name)"
    $"O = ($common_name)"
    "OU = ipp-print-orchestrator"
    ""
    "[v3_req]"
    "basicConstraints = critical,CA:false"
    "keyUsage = critical,digitalSignature,keyEncipherment"
    "extendedKeyUsage = serverAuth"
    "subjectAltName = @alt_names"
    ""
    "[alt_names]"
  ]
  | append (indexed-alt-name-lines "DNS" $dns_names)
  | append (indexed-alt-name-lines "IP" $ip_addresses)
  | str join "\n"
}

def install-cups-tls-certificate []: nothing -> record {
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
  let ip_addresses = (local-ip-addresses)
  let tmp_dir = (mktemp -d)
  let config_path = ($tmp_dir | path join "cups-tls.cnf")
  let cert_path = ($tmp_dir | path join "cups.crt")
  let key_path = ($tmp_dir | path join "cups.key")
  let target_cert_path = ($CUPS_SSL_DIR | path join $"($system_hostname).crt")
  let target_key_path = ($CUPS_SSL_DIR | path join $"($system_hostname).key")

  try {
    install-root-dir $CUPS_SSL_DIR
    cups-tls-openssl-config $system_hostname $dns_names $ip_addresses | save --force $config_path

    run-required "generate CUPS TLS certificate" [
      "openssl"
      "req"
      "-x509"
      "-newkey"
      "rsa:2048"
      "-sha256"
      "-days"
      $CUPS_TLS_CERT_DAYS
      "-nodes"
      "-keyout"
      $key_path
      "-out"
      $cert_path
      "-config"
      $config_path
      "-extensions"
      "v3_req"
    ] | ignore

    install-root-file $PUBLIC_DATA_FILE_MODE $cert_path $target_cert_path
    install-root-file $PRIVATE_SECRET_FILE_MODE $key_path $target_key_path
  } catch {|err|
    rm -rf $tmp_dir
    error make {msg: (error-message $err)}
  }

  rm -rf $tmp_dir

  print $"Installed CUPS TLS certificate ($target_cert_path) for DNS names: ($dns_names | str join ', ')"
  if not ($ip_addresses | is-empty) {
    print $"Installed CUPS TLS certificate IP SANs: ($ip_addresses | str join ', ')"
  }

  {
    system_hostname: $system_hostname
    avahi_hostname: $avahi_host.hostname
    avahi_fqdn: $avahi_host.fqdn
    dns_names: $dns_names
    ip_addresses: $ip_addresses
    cert_path: $target_cert_path
    key_path: $target_key_path
  }
}

def systemd-service-active [service: string]: nothing -> bool {
  let result = (run-external "systemctl" "is-active" "--quiet" $service | complete)
  $result.exit_code == 0
}

def openssl-verify-return-code-is [output: string, code: int]: nothing -> bool {
  $output | str contains $"Verify return code: ($code) "
}

def verify-openssl-output-has-matching-identity [label: string, output: string]: nothing -> nothing {
  let lowered_output = ($output | str downcase)

  if (
    ($lowered_output | str contains "hostname mismatch")
    or ($lowered_output | str contains "ip address mismatch")
    or (openssl-verify-return-code-is $output 62)
    or (openssl-verify-return-code-is $output 64)
  ) {
    error make {msg: $"CUPS TLS identity verification failed for ($label): ($output | str trim)"}
  }

  if not ((openssl-verify-return-code-is $output 0) or (openssl-verify-return-code-is $output 18)) {
    error make {msg: $"CUPS TLS verification returned an unexpected result for ($label): ($output | str trim)"}
  }
}

def verify-cups-tls-hostname [hostname: string]: nothing -> nothing {
  let command = $"timeout 5 openssl s_client -connect 127.0.0.1:631 -servername (shell-quote $hostname) -verify_hostname (shell-quote $hostname) </dev/null"
  let result = (run-external "bash" "-lc" $command | complete)
  let output = [$result.stdout $result.stderr] | str join "\n"

  if $result.exit_code != 0 {
    error make {msg: $"CUPS TLS hostname verification command failed for ($hostname): ($output | str trim)"}
  }

  verify-openssl-output-has-matching-identity $hostname $output
}

def verify-cups-tls-ip [ip_address: string]: nothing -> nothing {
  let command = $"timeout 5 openssl s_client -connect 127.0.0.1:631 -verify_ip (shell-quote $ip_address) </dev/null"
  let result = (run-external "bash" "-lc" $command | complete)
  let output = [$result.stdout $result.stderr] | str join "\n"

  if $result.exit_code != 0 {
    error make {msg: $"CUPS TLS IP verification command failed for ($ip_address): ($output | str trim)"}
  }

  verify-openssl-output-has-matching-identity $ip_address $output
}

def verify-cups-tls-identity [identity: record]: nothing -> nothing {
  for dns_name in $identity.dns_names {
    verify-cups-tls-hostname $dns_name
  }

  for ip_address in $identity.ip_addresses {
    verify-cups-tls-ip $ip_address
  }
}

def restart-cups-if-active []: nothing -> bool {
  if (systemd-service-active "cups.service") {
    run-required "restart CUPS to load TLS certificate" ["sudo" "systemctl" "restart" "cups.service"] | ignore
    true
  } else {
    false
  }
}

def install-pdf-preflight-filter [runtime_path: string]: nothing -> nothing {
  let store_filter = ($runtime_path | path join "lib/cups/filter/ipp-pdf-preflight-to-spl")

  run-required "verify Nix PDF preflight CUPS filter" ["test" "-x" $store_filter] | ignore
  install-root-dir "/usr/lib/cups/filter"
  install-owned-dir $CUPS_FILTER_CACHE_DIRECTORY_MODE "lp" "lp" $CUPS_FILTER_CACHE_DIR
  install-owned-dir $CUPS_FONTCONFIG_CACHE_DIRECTORY_MODE "root" "lp" $CUPS_FONTCONFIG_CACHE_DIR
  install-root-symlink $store_filter $CUPS_PDF_PREFLIGHT_FILTER_PATH
  run-required "verify installed PDF preflight CUPS filter" ["test" "-x" $CUPS_PDF_PREFLIGHT_FILTER_PATH] | ignore
}

def install-nix-filter-link [source: string, destination: string]: nothing -> nothing {
  run-required $"verify Nix CUPS filter ($source)" ["test" "-x" $source] | ignore
  install-root-symlink $source $destination
  run-required $"verify installed CUPS filter ($destination)" ["test" "-x" $destination] | ignore
}

def supervised-usb-device-uri [device_uri: string]: nothing -> string {
  if ($device_uri | str starts-with "usb://") {
    "ipp-orch-usb://" + ($device_uri | str substring 6..)
  } else {
    $device_uri
  }
}

def install-supervised-usb-backend [backend_path: string]: nothing -> nothing {
  let store_backend = ($backend_path | path join "lib/cups/backend/ipp-orch-usb")
  let tmp_backend = (mktemp)

  try {
    run-required "verify Nix supervised USB backend" ["test" "-x" $store_backend] | ignore
    [
      "#!/bin/sh"
      (["exec" (shell-quote $store_backend) '"$@"'] | str join " ")
      ""
    ] | str join "\n" | save --force $tmp_backend
    run-required "verify supervised USB backend launcher shell syntax" ["sh" "-n" $tmp_backend] | ignore
    install-root-file $CUPS_ROOT_EXECUTED_BACKEND_MODE $tmp_backend $CUPS_USB_BACKEND_WRAPPER_PATH
    run-required "verify supervised CUPS USB backend" ["sudo" "test" "-x" $CUPS_USB_BACKEND_WRAPPER_PATH] | ignore
  } catch {|err|
    rm --force $tmp_backend
    error make {msg: (error-message $err)}
  }

  rm --force $tmp_backend
}

def ensure-hp-uld-driver [driver_path: string]: nothing -> string {
  let store_ppd = ($driver_path | path join "share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd")
  let store_raster_filter = ($driver_path | path join "lib/cups/filter/rastertospl")
  let store_pstosecps_filter = ($driver_path | path join "lib/cups/filter/pstosecps")

  let source_ppd = (open $store_ppd)
  for expected in [$HP_ULD_GRAYSCALE_8BIT $HP_ULD_RASTER_FILTER $HP_ULD_PDF_PREFLIGHT_FILTER $HP_ULD_STANDARD_SAFE_300DPI] {
    if not ($source_ppd | str contains $expected) {
      error make {msg: $"Nix HP ULD PPD did not contain expected line: ($expected)"}
    }
  }

  install-root-dir "/usr/lib/cups/filter"
  install-root-dir "/usr/share/ppd/uld-hp"
  install-root-file $PUBLIC_DATA_FILE_MODE $store_ppd $HP_ULD_PPD_PATH
  install-nix-filter-link $store_raster_filter "/usr/lib/cups/filter/rastertospl"
  install-nix-filter-link $store_pstosecps_filter "/usr/lib/cups/filter/pstosecps"
  run-required "verify HP 13x PPD" ["test" "-r" $HP_ULD_PPD_PATH] | ignore
  $HP_ULD_PPD_PATH
}

def install-queue-ppd-if-present [printer_name: string, ppd_path: string]: nothing -> nothing {
  let queue_ppd_path = $"/etc/cups/ppd/($printer_name).ppd"
  let queue_exists = (run-external "lpstat" "-p" $printer_name | complete)

  if $queue_exists.exit_code != 0 {
    print $"CUPS queue ($printer_name) is not present; installed driver PPD only."
    return
  }

  install-root-dir "/etc/cups/ppd"
  install-root-file $PUBLIC_DATA_FILE_MODE $ppd_path $queue_ppd_path
  run-required $"verify queue PPD ($queue_ppd_path)" ["sudo" "test" "-r" $queue_ppd_path] | ignore
  print $"Refreshed queue PPD for ($printer_name) without changing queue state."
}

def install-cups-artifacts [
  printer_name: string
  runtime_path: string
  driver_path: string
  backend_path: string
]: nothing -> nothing {
  require-store-path "runtime" $runtime_path
  require-store-path "driver" $driver_path
  require-store-path "backend" $backend_path

  let ppd_path = (ensure-hp-uld-driver $driver_path)
  install-pdf-preflight-filter $runtime_path
  install-supervised-usb-backend $backend_path
  install-queue-ppd-if-present $printer_name $ppd_path
}

def configure-cups-network [--enable-printing]: nothing -> nothing {
  for attempt in 1..10 {
    let result = (run-external "sudo" "cupsctl" | complete)
    if $result.exit_code == 0 {
      break
    }

    if $attempt == 10 {
      error make {msg: $"CUPS did not become ready: ($result.stderr | str trim)"}
    }

    sleep 1sec
  }

  if $enable_printing {
    run-required "configure CUPS LAN sharing" [
      "sudo"
      "cupsctl"
      "--remote-any"
      "--share-printers"
      "WebInterface=Yes"
      "Browsing=No"
      "BrowseLocalProtocols=none"
      "AccessLogLevel=all"
      "LogLevel=info"
      "MaxLogSize=33554432"
      "ErrorPolicy=abort-job"
      "JobRetryLimit=0"
      "JobRetryInterval=0"
      "MaxJobs=20"
      "MaxJobsPerPrinter=1"
      "MaxJobTime=300"
      "PreserveJobFiles=86400"
      "PreserveJobHistory=86400"
      "AutoPurgeJobs=Yes"
      "JobKillDelay=5"
    ] | ignore
  } else {
    run-best-effort [
      "sudo"
      "cupsctl"
      "--no-share-printers"
      "WebInterface=Yes"
      "Browsing=No"
      "AccessLogLevel=all"
      "LogLevel=info"
      "MaxLogSize=33554432"
      "ErrorPolicy=abort-job"
      "JobRetryLimit=0"
      "JobRetryInterval=0"
      "MaxJobs=20"
      "MaxJobsPerPrinter=1"
      "MaxJobTime=300"
      "PreserveJobFiles=86400"
      "PreserveJobHistory=86400"
      "AutoPurgeJobs=Yes"
      "JobKillDelay=5"
    ]
  }
}

def configure-queue [
  printer_name: string
  device_uri: string
  model_or_ppd: string
  --ppd
  --enable-printing
]: nothing -> nothing {
  for queue in $TEMP_QUEUES {
    run-best-effort ["sudo" "lpadmin" "-x" $queue]
  }

  let driver_args = if $ppd {
    ["-P" $model_or_ppd]
  } else {
    ["-m" $model_or_ppd]
  }

  run-required $"configure CUPS queue ($printer_name)" ([
    "sudo"
    "lpadmin"
    "-p"
    $printer_name
    "-E"
    "-v"
    $device_uri
  ] ++ $driver_args ++ $LEGACY_PAGE_DEFAULT_RESET_ARGS ++ [
    "-D"
    "HP Laser MFP 135a"
    "-L"
    "Home"
    "-o"
    "Quality-default=600dpi"
    "-o"
    "ColorModel-default=Gray"
    "-o"
    "printer-error-policy=abort-job"
    "-o"
    $"printer-is-shared=($enable_printing)"
  ]) | ignore

  if $enable_printing {
    run-required "enable CUPS queue" ["sudo" "cupsenable" "-r" "Ready." $printer_name] | ignore
    run-required "accept CUPS queue jobs" ["sudo" "cupsaccept" $printer_name] | ignore
  } else {
    run-best-effort ["sudo" "cupsdisable" $printer_name]
    run-best-effort ["sudo" "cupsreject" $printer_name]
    run-best-effort ["sudo" "lpadmin" "-p" $printer_name "-o" "printer-is-shared=false"]
  }
}

def cups-printer-block [printers_conf: string, printer_name: string]: nothing -> string {
  let lines = ($printers_conf | lines)
  mut in_printer = false
  mut block = []

  for line in $lines {
    let trimmed = ($line | str trim)
    if $trimmed == $"<Printer ($printer_name)>" {
      $in_printer = true
    }

    if $in_printer {
      $block = ($block | append $line)
    }

    if $in_printer and $trimmed == "</Printer>" {
      return ($block | str join "\n")
    }
  }

  ""
}

def force-queue-error-policy-abort-job [printer_name: string]: nothing -> nothing {
  run-best-effort ["sudo" "systemctl" "stop" "cups.service" "cups.socket" "cups.path"]

  let perl_expression = (
    's/(<Printer ' + $printer_name + '>.*?\n)ErrorPolicy \S+(\n.*?<\/Printer>)/${1}ErrorPolicy abort-job${2}/s'
  )

  run-required "set queue ErrorPolicy to abort-job" [
    "sudo"
    "perl"
    "-0pi"
    "-e"
    $perl_expression
    "/etc/cups/printers.conf"
  ] | ignore

  let printers_conf = (run-required "verify queue ErrorPolicy" ["sudo" "cat" "/etc/cups/printers.conf"])
  let printer_block = (cups-printer-block $printers_conf $printer_name)
  if ($printer_block | str length) == 0 or not ($printer_block | str contains "ErrorPolicy abort-job") {
    error make {msg: $"failed to set ErrorPolicy abort-job for CUPS printer ($printer_name)"}
  }

  run-required "restart CUPS after queue ErrorPolicy update" ["sudo" "systemctl" "start" "cups.service"] | ignore
}

def read-printer-uuid [printer_name: string]: nothing -> string {
  let printers_conf = (run-required "read CUPS printers.conf" ["sudo" "cat" "/etc/cups/printers.conf"])
  let printer_block = (cups-printer-block $printers_conf $printer_name)

  for line in ($printer_block | lines) {
    let trimmed = ($line | str trim)
    if ($trimmed | str starts-with "UUID ") {
      return (
        $trimmed
        | str replace --regex "^UUID\\s+" ""
        | str replace --regex "^urn:uuid:" ""
        | str trim
      )
    }
  }

  error make {msg: $"could not find UUID for CUPS printer ($printer_name)"}
  ""
}

def avahi-ipps-service-content [printer_name: string, avahi_fqdn: string, printer_uuid: string]: nothing -> string {
  let avahi_short_name = ($avahi_fqdn | str replace --regex "\\.local$" "")
  let service_name = (xml-escape $"HP Laser MFP 135a @ ($avahi_short_name)")
  let rp = (xml-escape $"printers/($printer_name)")
  let adminurl = (xml-escape $"https://($avahi_fqdn):631/printers/($printer_name)")
  let uuid = (xml-escape $printer_uuid)

  [
    "<?xml version=\"1.0\" standalone=\"no\"?>"
    "<!DOCTYPE service-group SYSTEM \"avahi-service.dtd\">"
    "<service-group>"
    $"  <name replace-wildcards=\"no\">($service_name)</name>"
    "  <service>"
    "    <type>_ipps._tcp</type>"
    "    <subtype>_universal._sub._ipps._tcp</subtype>"
    "    <port>631</port>"
    "    <txt-record>txtvers=1</txt-record>"
    "    <txt-record>qtotal=1</txt-record>"
    $"    <txt-record>rp=($rp)</txt-record>"
    "    <txt-record>ty=HP Laser MFP 13x Series</txt-record>"
    "    <txt-record>note=Home</txt-record>"
    $"    <txt-record>adminurl=($adminurl)</txt-record>"
    "    <txt-record>pdl=application/pdf,application/postscript,image/jpeg,image/png,image/pwg-raster,image/urf</txt-record>"
    "    <txt-record>product=(LaserMFP)</txt-record>"
    $"    <txt-record>UUID=($uuid)</txt-record>"
    "    <txt-record>TLS=1.2</txt-record>"
    "    <txt-record>Color=F</txt-record>"
    "    <txt-record>Duplex=F</txt-record>"
    "    <txt-record>Copies=T</txt-record>"
    "    <txt-record>URF=V1.4,CP1,W8,PQ4,RS600,FN3</txt-record>"
    "    <txt-record>priority=0</txt-record>"
    "  </service>"
    "</service-group>"
    ""
  ] | str join "\n"
}

def install-avahi-ipps-service [printer_name: string, avahi_fqdn: string]: nothing -> nothing {
  let printer_uuid = (read-printer-uuid $printer_name)
  let service_content = (avahi-ipps-service-content $printer_name $avahi_fqdn $printer_uuid)
  let tmp_service = (mktemp)

  try {
    $service_content | save --force $tmp_service
    run-required "install Avahi IPPS-only printer service" ["sudo" "install" "-m" $PUBLIC_DATA_FILE_MODE $tmp_service $AVAHI_IPPS_SERVICE_PATH] | ignore
    run-required "restart Avahi after IPPS service install" ["sudo" "systemctl" "restart" "avahi-daemon.service"] | ignore
  } catch {|err|
    rm --force $tmp_service
    error make {msg: (error-message $err)}
  }

  rm --force $tmp_service
}

def remove-avahi-ipps-service []: nothing -> nothing {
  run-best-effort ["sudo" "rm" "-f" $AVAHI_IPPS_SERVICE_PATH]
  run-best-effort ["sudo" "systemctl" "restart" "avahi-daemon.service"]
}

def final-safe-stop [printer_name: string]: nothing -> nothing {
  run-best-effort ["sudo" "cupsdisable" $printer_name]
  run-best-effort ["sudo" "cupsreject" $printer_name]
  run-best-effort ["sudo" "lpadmin" "-p" $printer_name "-o" "printer-is-shared=false"]
  remove-avahi-ipps-service
  clear-spool-and-stop-cups
  run-best-effort ["sudo" "systemctl" "disable" "cups.service" "cups.socket" "cups.path" "cups-browsed.service"]
}

def main [
  --printer-name: string
  --driver: string
  --device-uri: string
  --runtime-path: string
  --driver-path: string
  --backend-path: string
  --enable-printing
  --stop-only
  --repair-tls-only
  --artifacts-only
]: nothing -> nothing {
  let root_dir = (repo-root)
  let repo_dotenv = (load-dotenv ($root_dir | path join ".env"))
  let etc_dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
  let dotenv = ($repo_dotenv | merge $etc_dotenv)
  let queue_name = if (has-value $printer_name) {
    $printer_name
  } else {
    get-config $dotenv IPP_ORCH_PRINTER_NAME "HP135a"
  }

  if $repair_tls_only and $stop_only {
    error make {msg: "--repair-tls-only cannot be combined with --stop-only"}
  }

  if $repair_tls_only and $enable_printing {
    error make {msg: "--repair-tls-only cannot be combined with --enable-printing"}
  }

  if $artifacts_only and ($repair_tls_only or $stop_only or $enable_printing) {
    error make {msg: "--artifacts-only cannot be combined with --repair-tls-only, --stop-only, or --enable-printing"}
  }

  if $artifacts_only {
    install-cups-artifacts $queue_name $runtime_path $driver_path $backend_path
    print $"Installed CUPS artifacts for ($queue_name) without enabling printing or changing USB authorization."
    return
  }

  if $repair_tls_only {
    ensure-apt-packages [
      avahi-daemon
      openssl
    ]
    let tls_identity = (install-cups-tls-certificate)
    let cups_was_active = (restart-cups-if-active)

    if $cups_was_active {
      verify-cups-tls-identity $tls_identity
      print $"Repaired CUPS TLS identity for advertised mDNS host ($tls_identity.avahi_fqdn)."
    } else {
      print $"Installed CUPS TLS identity for advertised mDNS host ($tls_identity.avahi_fqdn). CUPS was not active, so verification was skipped."
    }

    return
  }

  print "Stopping CUPS and clearing all pending CUPS spool files before configuration."
  clear-spool-and-stop-cups

  if $stop_only {
    deauthorize-hp-usb
    run-best-effort ["sudo" "systemctl" "disable" "cups.service" "cups.socket" "cups.path" "cups-browsed.service" "ipp-usb.service"]
    print "CUPS stopped, disabled, spool cleared, and HP USB device deauthorized. No queue was configured."
    return
  }

  ensure-apt-packages [
    cups
    cups-client
    cups-ipp-utils
    cups-filters
    cups-filters-core-drivers
    ghostscript
    poppler-utils
    nodejs
    ca-certificates
    openssl
    tar
    gzip
    coreutils
    avahi-daemon
  ]
  run-best-effort ["sudo" "systemctl" "mask" "--now" "ipp-usb.service"]
  authorize-hp-usb
  let tls_identity = (install-cups-tls-certificate)

  let resolved_device_uri = (resolve-hp-device-uri $queue_name $device_uri)

  run-required "start CUPS for queue configuration" ["sudo" "systemctl" "start" "cups.service"] | ignore

  let selected_driver = if (has-value $driver) {
    if not (driver-available $driver) {
      error make {msg: $"CUPS driver is not available: ($driver)"}
    }

    {kind: model, value: $driver}
  } else {
    {kind: ppd, value: (ensure-hp-uld-driver $driver_path)}
  }

  install-cups-artifacts $queue_name $runtime_path $driver_path $backend_path
  configure-cups-network --enable-printing=$enable_printing
  configure-queue $queue_name (supervised-usb-device-uri $resolved_device_uri) $selected_driver.value --ppd=($selected_driver.kind == "ppd") --enable-printing=$enable_printing
  force-queue-error-policy-abort-job $queue_name
  clear-spool-files

  if $enable_printing {
    install-avahi-ipps-service $queue_name $tls_identity.avahi_fqdn
    run-best-effort ["sudo" "systemctl" "disable" "--now" "cups-browsed.service"]
    run-required "enable CUPS and Avahi services" ["sudo" "systemctl" "enable" "--now" "cups.service" "cups.socket" "cups.path" "avahi-daemon.service"] | ignore
    verify-cups-tls-identity $tls_identity
    run-required "validate public IPPS attributes" [
      "ipptool"
      "-tv"
      $"ipps://($tls_identity.avahi_fqdn):631/printers/($queue_name)"
      "/usr/share/cups/ipptool/get-printer-attributes.test"
    ] | ignore
    print $"Configured and enabled shared CUPS queue ($queue_name) with ($selected_driver.value)."
    print "No test page was printed."
  } else {
    final-safe-stop $queue_name
    print $"Configured queue ($queue_name) with ($selected_driver.value), then left CUPS stopped, disabled, unshared, and rejecting jobs."
    print "No test page was printed. Re-run with --enable-printing only when you are ready to expose the queue."
  }
}
