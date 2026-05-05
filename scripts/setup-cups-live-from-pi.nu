#!/usr/bin/env nu

use lib/env.nu [get-config has-value load-dotenv]
use lib/repo.nu repo-root

const HP_ULD_URL = "https://ftp.hp.com/pub/softlib/software13/printers/CLP150/uld-hp_V1.00.39.12_00.15.tar.gz"
const HP_ULD_PPD_PATH = "/usr/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd"
const TEMP_QUEUES = [HP135a_PWG_Test HP135a_SPLIX_Test]

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
  run-best-effort ["sudo" "sh" "-c" "rm -f /var/spool/cups/c* /var/spool/cups/d*"]
}

def deauthorize-hp-usb []: nothing -> nothing {
  let script = '
for dev in /sys/bus/usb/devices/*; do
  if [ -f "$dev/idVendor" ] && [ -f "$dev/idProduct" ] && [ "$(cat "$dev/idVendor")" = "03f0" ] && [ "$(cat "$dev/idProduct")" = "f22a" ]; then
    echo 0 > "$dev/authorized" || true
  fi
done
'
  run-best-effort ["sudo" "sh" "-c" $script]
}

def authorize-hp-usb []: nothing -> nothing {
  let script = '
for dev in /sys/bus/usb/devices/*; do
  if [ -f "$dev/idVendor" ] && [ -f "$dev/idProduct" ] && [ "$(cat "$dev/idVendor")" = "03f0" ] && [ "$(cat "$dev/idProduct")" = "f22a" ]; then
    echo 1 > "$dev/authorized" || true
  fi
done
'
  run-best-effort ["sudo" "sh" "-c" $script]
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

def ensure-hp-uld-driver []: nothing -> string {
  let install_script = ('
set -eu
tmpdir=$(mktemp -d)
trap "rm -rf \"\$tmpdir\"" EXIT

curl -fsSL "__HP_ULD_URL__" -o "$tmpdir/uld.tar.gz"
tar -xzf "$tmpdir/uld.tar.gz" -C "$tmpdir"

arch=$(dpkg --print-architecture)
case "$arch" in
  arm64) uld_arch=aarch64 ;;
  amd64) uld_arch=x86_64 ;;
  i386) uld_arch=i386 ;;
  *) echo "unsupported architecture for HP ULD printer driver: $arch" >&2; exit 1 ;;
esac

install -d -m 0755 /opt/smfp-common/printer/bin /opt/smfp-common/printer/lib /usr/lib/cups/filter /usr/share/ppd/uld-hp

install -m 0755 "$tmpdir/uld/$uld_arch/rastertospl" /opt/smfp-common/printer/bin/rastertospl
install -m 0755 "$tmpdir/uld/$uld_arch/pstosecps" /opt/smfp-common/printer/bin/pstosecps
install -m 0644 "$tmpdir/uld/$uld_arch/libscmssc.so" /opt/smfp-common/printer/lib/libscmssc.so
install -m 0644 "$tmpdir/uld/noarch/share/ppd/HP_Laser_MFP_13x_Series.ppd" "__HP_ULD_PPD_PATH__"

ln -sf /opt/smfp-common/printer/bin/rastertospl /usr/lib/cups/filter/rastertospl
ln -sf /opt/smfp-common/printer/bin/pstosecps /usr/lib/cups/filter/pstosecps

ldconfig
test -x /usr/lib/cups/filter/rastertospl
test -r "__HP_ULD_PPD_PATH__"
printf "%s\n" "__HP_ULD_PPD_PATH__"
'
  | str replace --all "__HP_ULD_URL__" $HP_ULD_URL
  | str replace --all "__HP_ULD_PPD_PATH__" $HP_ULD_PPD_PATH)

  run-required "install HP Unified Linux Driver rastertospl filter" ["sudo" "bash" "-c" $install_script] | str trim
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
    ] | ignore
  } else {
    run-best-effort ["sudo" "cupsctl" "--no-share-printers" "WebInterface=Yes" "Browsing=No"]
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
    ca-certificates
    curl
    tar
    gzip
    avahi-daemon
  ]

  run-best-effort ["sudo" "systemctl" "mask" "--now" "ipp-usb.service"]
  authorize-hp-usb

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

  configure-cups-network --enable-printing=$enable_printing
  configure-queue $queue_name $resolved_device_uri $selected_driver.value --ppd=($selected_driver.kind == "ppd") --enable-printing=$enable_printing
  run-best-effort ["sudo" "sh" "-c" "rm -f /var/spool/cups/c* /var/spool/cups/d*"]

  if $enable_printing {
    run-required "enable CUPS and Avahi services" ["sudo" "systemctl" "enable" "--now" "cups.service" "cups.socket" "cups.path" "cups-browsed.service" "avahi-daemon.service"] | ignore
    print $"Configured and enabled shared CUPS queue ($queue_name) with ($selected_driver.value)."
    print "No test page was printed."
  } else {
    final-safe-stop $queue_name
    print $"Configured queue ($queue_name) with ($selected_driver.value), then left CUPS stopped, disabled, unshared, and rejecting jobs."
    print "No test page was printed. Re-run with --enable-printing only when you are ready to expose the queue."
  }
}
