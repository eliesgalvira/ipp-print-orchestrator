#!/usr/bin/env nu

def has-value [value] {
  if $value == null {
    false
  } else {
    (($value | into string | str trim | str length) > 0)
  }
}

def command-exists [name: string] {
  not (which $name | is-empty)
}

def run-sudo [sudo_password: any, args: list<string>] {
  if (has-value $sudo_password) {
    (($sudo_password | into string) + "\n") | run-external "sudo" "-S" "-p" "" ...$args
  } else {
    run-external "sudo" ...$args
  }
}

def install-apt-packages [sudo_password: any, packages: list<string>] {
  if not (command-exists apt-get) {
    error make {msg: "Unsupported package manager on target machine. Install unzip, rsync, node, npm, cups-client, curl, ca-certificates, and gnupg manually."}
  }

  run-sudo $sudo_password ["apt-get" "update"]
  run-sudo $sudo_password (["apt-get" "install" "-y"] ++ $packages)
}

def install-bun [] {
  if (command-exists bun) {
    return
  }

  let installer = (mktemp)
  ^curl -fsSL "https://bun.sh/install" -o $installer
  ^bash $installer
  rm --force $installer
}

def detect-printer-name [] {
  if not (command-exists lpstat) {
    "printer"
  } else {
    let result = (^lpstat -p | complete)
    if $result.exit_code != 0 {
      "printer"
    } else {
      let printers = (
        $result.stdout
        | lines
        | parse "printer {name} {rest}"
        | get name
      )

      if (($printers | length) == 1) {
        $printers | first
      } else {
        "printer"
      }
    }
  }
}

def default-env-content [app_dir: string, printer_name: string] {
  [
    $"IPP_ORCH_DATA_DIR=($app_dir)/data"
    $"IPP_ORCH_PRINTER_NAME=($printer_name)"
    "IPP_ORCH_BIND_HOST=127.0.0.1"
    "IPP_ORCH_BIND_PORT=4310"
    "IPP_ORCH_HEARTBEAT_INTERVAL_MS=60000"
    "IPP_ORCH_RECONCILE_INTERVAL_MS=30000"
    "IPP_ORCH_LOG_PRETTY=false"
    "IPP_ORCH_ENABLE_OTLP=false"
    "OTEL_EXPORTER_OTLP_ENDPOINT="
    "OTEL_RESOURCE_ATTRIBUTES=service.name=ipp-print-orchestrator"
    ""
  ] | str join "\n"
}

def install-default-env [sudo_password: any, app_dir: string, printer_name: string] {
  if ("/etc/ipp-print-orchestrator.env" | path exists) {
    return
  }

  let tmp_env = (mktemp)
  default-env-content $app_dir $printer_name | save --force $tmp_env
  run-sudo $sudo_password ["install" "-m" "0644" $tmp_env "/etc/ipp-print-orchestrator.env"]
  rm --force $tmp_env
}

def configured-printer-name [] {
  if not ("/etc/ipp-print-orchestrator.env" | path exists) {
    null
  } else {
    let matches = (
      open --raw /etc/ipp-print-orchestrator.env
      | lines
      | where {|line| $line | str starts-with "IPP_ORCH_PRINTER_NAME="}
    )

    if (($matches | length) == 0) {
      null
    } else {
      $matches | last | str replace "IPP_ORCH_PRINTER_NAME=" "" | str trim
    }
  }
}

def warn-if-printer-missing [] {
  let printer_name = (configured-printer-name)
  if (not (has-value $printer_name)) or (not (command-exists lpstat)) {
    return
  }

  let result = (^lpstat -p $printer_name | complete)
  if $result.exit_code == 0 {
    return
  }

  print --stderr $"warning: configured printer \"($printer_name)\" was not found in CUPS."
  print --stderr "available queues:"
  let queues = (^lpstat -p | complete)
  if (has-value $queues.stdout) {
    print --stderr --raw $queues.stdout
  }
}

def main [
  app_dir: string
  pi_host_label: string
] {
  let sudo_password = ($env | get -o SUDO_PASSWORD_FROM_STDIN)

  install-apt-packages $sudo_password [
    "curl"
    "unzip"
    "rsync"
    "nodejs"
    "npm"
    "cups-client"
    "ca-certificates"
    "gnupg"
  ]
  install-bun
  mkdir $app_dir

  let printer_name = (detect-printer-name)
  install-default-env $sudo_password $app_dir $printer_name
  warn-if-printer-missing

  print $"bootstrap complete on ($pi_host_label)"
}
