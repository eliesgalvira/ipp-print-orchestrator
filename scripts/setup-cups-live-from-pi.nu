#!/usr/bin/env nu

use lib/env.nu [get-config has-value load-dotenv]
use lib/repo.nu repo-root

const HP_ULD_URL = "https://ftp.hp.com/pub/softlib/software13/printers/CLP150/uld-hp_V1.00.39.12_00.15.tar.gz"
const HP_ULD_PPD_PATH = "/usr/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd"
const CUPS_PDF_PREFLIGHT_FILTER_PATH = "/usr/lib/cups/filter/ipp-pdf-preflight-to-spl"
const CUPS_PDF_PREFLIGHT_INSTALL_DIR = "/opt/ipp-print-orchestrator/cups-filter"
const CUPS_PDF_PREFLIGHT_JS_PATH = "/opt/ipp-print-orchestrator/cups-filter/cups-pdf-preflight-filter.js"
const CUPS_PDF_PREFLIGHT_PACKAGE_JSON_PATH = "/opt/ipp-print-orchestrator/cups-filter/package.json"
const CUPS_FILTER_CACHE_DIR = "/var/cache/ipp-print-orchestrator"
const CUPS_SSL_DIR = "/etc/cups/ssl"
const CUPS_TLS_CERT_DAYS = "3650"
const TEMP_QUEUES = [HP135a_PWG_Test HP135a_SPLIX_Test]
const HP_ULD_GRAYSCALE_8BIT = '*ColorModel Gray/Grayscale: "<</cupsColorSpace 0 /cupsBitsPerColor 8>>setpagedevice"'
const HP_ULD_RASTER_FILTER = '*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"'
const HP_ULD_PDF_PREFLIGHT_FILTER = '*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"'
const HP_ULD_STANDARD_600DPI = '*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"'
const HP_ULD_STANDARD_SAFE_300DPI = '*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"'

def run-required [label: string, command: list<string>]: nothing -> string {
  let result = (run-external ...$command | complete)

  if $result.exit_code != 0 {
    error make {msg: $"($label) failed: ($result.stderr | str trim)"}
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

def node-major-version [version: string]: nothing -> int {
  let major_text = (
    $version
    | str trim
    | str replace --regex "^v" ""
    | split row "."
    | first
  )

  try {
    $major_text | into int
  } catch {
    error make {msg: $"could not parse Node.js version from /usr/bin/node: ($version)"}
  }
}

def ensure-node-runtime []: nothing -> nothing {
  let version = (run-required "detect Node.js runtime" ["/usr/bin/node" "--version"] | str trim)
  let major = (node-major-version $version)

  if $major < 18 {
    error make {msg: $"CUPS PDF preflight filter requires /usr/bin/node >= 18, found ($version). Upgrade nodejs or use Raspberry Pi OS/Debian Bookworm or newer."}
  }
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

def driver-available [driver: string]: nothing -> bool {
  let models = (run-required "list CUPS printer models" ["/usr/sbin/lpinfo" "-m"])
  $models | lines | any {|line| $line == $driver or ($line | str starts-with $"($driver) ")}
}

def hp-uld-arch [debian_arch: string]: nothing -> string {
  match $debian_arch {
    "arm64" => "aarch64"
    "amd64" => "x86_64"
    "i386" => "i386"
    _ => {
      error make {msg: $"unsupported architecture for HP ULD printer driver: ($debian_arch)"}
    }
  }
}

def install-root-dir [path: string]: nothing -> nothing {
  run-required $"create root-owned directory ($path)" ["sudo" "install" "-d" "-m" "0755" $path] | ignore
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

def non-empty-unique-strings [values: list<string>]: nothing -> list<string> {
  $values
  | each {|value| $value | str trim | str replace --regex "\\.$" ""}
  | where {|value| ($value | str length) > 0}
  | uniq
}

def busctl-avahi-string [method: string]: nothing -> string {
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

def ensure-avahi-running []: nothing -> nothing {
  run-required "start Avahi daemon for mDNS hostname discovery" ["sudo" "systemctl" "start" "avahi-daemon.service"] | ignore

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
  ensure-avahi-running

  let system_hostname = (run-required "detect system hostname" ["hostname"] | str trim)
  let avahi_hostname = (busctl-avahi-string "GetHostName" | str trim)
  let avahi_fqdn = (busctl-avahi-string "GetHostNameFqdn" | str trim | str replace --regex "\\.$" "")
  let dns_names = (non-empty-unique-strings [
    $system_hostname
    $"($system_hostname).local"
    $avahi_hostname
    $"($avahi_hostname).local"
    $avahi_fqdn
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

    install-root-file "0644" $cert_path $target_cert_path
    install-root-file "0600" $key_path $target_key_path
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
    avahi_hostname: $avahi_hostname
    avahi_fqdn: $avahi_fqdn
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

def verify-openssl-output-has-matching-identity [label: string, output: string]: nothing -> nothing {
  let lowered_output = ($output | str downcase)

  if (
    ($lowered_output | str contains "hostname mismatch")
    or ($lowered_output | str contains "ip address mismatch")
    or ($output | str contains "Verify return code: 62")
    or ($output | str contains "Verify return code: 64")
  ) {
    error make {msg: $"CUPS TLS identity verification failed for ($label): ($output | str trim)"}
  }

  if not (($output | str contains "Verify return code: 0") or ($output | str contains "Verify return code: 18")) {
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
  verify-cups-tls-hostname $identity.avahi_fqdn

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

def install-pdf-preflight-filter [app_dir: string]: nothing -> nothing {
  let filter_js = ($app_dir | path join "apps/agent/dist-cups-filter/cups-pdf-preflight-filter.js")

  run-required "verify bundled PDF preflight filter" ["test" "-r" $filter_js] | ignore

  let tmp_filter = (mktemp)
  let tmp_package_json = (mktemp)

  try {
    install-root-dir $CUPS_PDF_PREFLIGHT_INSTALL_DIR
    ['{ "type": "module" }' ""] | str join "\n" | save --force $tmp_package_json
    install-root-file "0644" $tmp_package_json $CUPS_PDF_PREFLIGHT_PACKAGE_JSON_PATH
    install-root-file "0555" $filter_js $CUPS_PDF_PREFLIGHT_JS_PATH
    install-owned-dir "0750" "lp" "lp" $CUPS_FILTER_CACHE_DIR

    let exec_line = (["exec" "/usr/bin/node" (shell-quote $CUPS_PDF_PREFLIGHT_JS_PATH) '"$@"'] | str join " ")
    [
      "#!/bin/sh"
      $"export XDG_CACHE_HOME=(shell-quote $CUPS_FILTER_CACHE_DIR)"
      $exec_line
      ""
    ] | str join "\n" | save --force $tmp_filter
    install-root-file "0555" $tmp_filter $CUPS_PDF_PREFLIGHT_FILTER_PATH
    run-required "verify installed PDF preflight CUPS filter" ["test" "-x" $CUPS_PDF_PREFLIGHT_FILTER_PATH] | ignore
  } catch {|err|
    rm --force $tmp_filter
    rm --force $tmp_package_json
    error make {msg: (error-message $err)}
  }

  rm --force $tmp_filter
  rm --force $tmp_package_json
}

def ensure-hp-uld-driver []: nothing -> string {
  let temp_dir = (mktemp -d)
  let archive_path = ($temp_dir | path join "uld.tar.gz")
  let extracted_dir = ($temp_dir | path join "uld")
  let patched_ppd_path = ($temp_dir | path join "HP_Laser_MFP_13x_Series-safe-300dpi.ppd")

  try {
    print "Downloading HP Unified Linux Driver package."
    http get --max-time 60sec $HP_ULD_URL | save -f $archive_path
    run-required "extract HP Unified Linux Driver package" ["tar" "-xzf" $archive_path "-C" $temp_dir] | ignore

    let debian_arch = (run-required "detect Debian architecture" ["dpkg" "--print-architecture"] | str trim)
    let uld_arch = (hp-uld-arch $debian_arch)
    let arch_dir = ($extracted_dir | path join $uld_arch)
    let noarch_dir = ($extracted_dir | path join "noarch")
    let source_ppd_path = ($noarch_dir | path join "share/ppd/HP_Laser_MFP_13x_Series.ppd")

    let source_ppd = (open $source_ppd_path)
    for expected in [$HP_ULD_GRAYSCALE_8BIT $HP_ULD_RASTER_FILTER $HP_ULD_STANDARD_600DPI] {
      if not ($source_ppd | str contains $expected) {
        error make {msg: $"HP ULD PPD did not contain expected line: ($expected)"}
      }
    }

    $source_ppd
    | str replace $HP_ULD_RASTER_FILTER $"($HP_ULD_PDF_PREFLIGHT_FILTER)\n($HP_ULD_RASTER_FILTER)"
    | str replace $HP_ULD_STANDARD_600DPI $HP_ULD_STANDARD_SAFE_300DPI
    | save -f $patched_ppd_path

    [
      /opt/smfp-common/printer/bin
      /opt/smfp-common/printer/lib
      /usr/lib/cups/filter
      /usr/share/ppd/uld-hp
    ] | each {|path| install-root-dir $path } | ignore

    install-root-file "0755" ($arch_dir | path join "rastertospl") /opt/smfp-common/printer/bin/rastertospl
    install-root-file "0755" ($arch_dir | path join "pstosecps") /opt/smfp-common/printer/bin/pstosecps
    install-root-file "0644" ($arch_dir | path join "libscmssc.so") /opt/smfp-common/printer/lib/libscmssc.so
    install-root-file "0644" $patched_ppd_path $HP_ULD_PPD_PATH

    install-root-symlink /opt/smfp-common/printer/bin/rastertospl /usr/lib/cups/filter/rastertospl
    install-root-symlink /opt/smfp-common/printer/bin/pstosecps /usr/lib/cups/filter/pstosecps

    run-required "refresh dynamic linker cache" ["sudo" "ldconfig"] | ignore
    run-required "verify rastertospl filter" ["test" "-x" "/usr/lib/cups/filter/rastertospl"] | ignore
    run-required "verify HP 13x PPD" ["test" "-r" $HP_ULD_PPD_PATH] | ignore
  } catch {|err|
    rm -rf $temp_dir
    error make {msg: (error-message $err)}
  }

  rm -rf $temp_dir
  $HP_ULD_PPD_PATH
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
      "Browsing=Yes"
      "BrowseLocalProtocols=dnssd"
      "AccessLogLevel=all"
      "LogLevel=info"
      "MaxLogSize=33554432"
      "ErrorPolicy=stop-printer"
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
      "ErrorPolicy=stop-printer"
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
  ] ++ $driver_args ++ [
    "-D"
    "HP Laser MFP 135a"
    "-L"
    "Home"
    "-o"
    "PageSize=A4"
    "-o"
    "PageSize-default=A4"
    "-o"
    "media-default=A4"
    "-o"
    "Quality-default=600dpi"
    "-o"
    "ColorModel-default=Gray"
    "-o"
    "ErrorPolicy=stop-printer"
    "-o"
    $"printer-is-shared=($enable_printing)"
  ]) | ignore

  if $enable_printing {
    run-required "enable CUPS queue" ["sudo" "cupsenable" $printer_name] | ignore
    run-required "accept CUPS queue jobs" ["sudo" "cupsaccept" $printer_name] | ignore
  } else {
    run-best-effort ["sudo" "cupsdisable" $printer_name]
    run-best-effort ["sudo" "cupsreject" $printer_name]
    run-best-effort ["sudo" "lpadmin" "-p" $printer_name "-o" "printer-is-shared=false"]
  }
}

def final-safe-stop [printer_name: string]: nothing -> nothing {
  run-best-effort ["sudo" "cupsdisable" $printer_name]
  run-best-effort ["sudo" "cupsreject" $printer_name]
  run-best-effort ["sudo" "lpadmin" "-p" $printer_name "-o" "printer-is-shared=false"]
  clear-spool-and-stop-cups
  run-best-effort ["sudo" "systemctl" "disable" "cups.service" "cups.socket" "cups.path" "cups-browsed.service"]
}

def main [
  --printer-name: string
  --driver: string
  --device-uri: string
  --enable-printing
  --stop-only
  --repair-tls-only
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
    cups-filters
    cups-filters-core-drivers
    ghostscript
    poppler-utils
    nodejs
    ca-certificates
    openssl
    tar
    gzip
    avahi-daemon
  ]
  ensure-node-runtime

  run-best-effort ["sudo" "systemctl" "mask" "--now" "ipp-usb.service"]
  authorize-hp-usb
  let tls_identity = (install-cups-tls-certificate)

  let resolved_device_uri = if (has-value $device_uri) {
    $device_uri
  } else {
    discover-hp-usb-device-uri
  }

  run-required "start CUPS for queue configuration" ["sudo" "systemctl" "start" "cups.service"] | ignore

  let selected_driver = if (has-value $driver) {
    if not (driver-available $driver) {
      error make {msg: $"CUPS driver is not available: ($driver)"}
    }

    {kind: model, value: $driver}
  } else {
    {kind: ppd, value: (ensure-hp-uld-driver)}
  }

  install-pdf-preflight-filter $root_dir
  configure-cups-network --enable-printing=$enable_printing
  configure-queue $queue_name $resolved_device_uri $selected_driver.value --ppd=($selected_driver.kind == "ppd") --enable-printing=$enable_printing
  clear-spool-files

  if $enable_printing {
    run-required "enable CUPS and Avahi services" ["sudo" "systemctl" "enable" "--now" "cups.service" "cups.socket" "cups.path" "cups-browsed.service" "avahi-daemon.service"] | ignore
    verify-cups-tls-identity $tls_identity
    print $"Configured and enabled shared CUPS queue ($queue_name) with ($selected_driver.value)."
    print "No test page was printed."
  } else {
    final-safe-stop $queue_name
    print $"Configured queue ($queue_name) with ($selected_driver.value), then left CUPS stopped, disabled, unshared, and rejecting jobs."
    print "No test page was printed. Re-run with --enable-printing only when you are ready to expose the queue."
  }
}
