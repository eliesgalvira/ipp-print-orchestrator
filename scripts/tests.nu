#!/usr/bin/env nu

use std/assert

use check-observability-live-from-pi.nu trace-query
use lib/cups-tls.nu certificate-covers-identity
use lib/env.nu [get-config has-value load-dotenv]
use lib/remote.nu [aarch64-builder-target parse-nix-paths remote-target rsync-args ssh-args ssh-options ssh-rsh-command run-with-retries]
use lib/repo.nu [deploy-excludes repo-root source-installable]
use lib/service-env.nu [local-service-env-content]

def main []: nothing -> nothing {
  print "Running Nushell tests..."

  let test_commands = (
    scope commands
    | where ($it.type == "custom")
        and ($it.name | str starts-with "test ")
        and not ($it.description | str starts-with "ignore")
    | get name
    | each {|test|
        let label = ($"Running test: ($test)" | to nuon)
        [$"print ($label)" $test]
      }
    | flatten
    | str join "; "
  )

  if (($test_commands | str trim | str length) == 0) {
    error make {msg: "no Nushell tests were discovered"}
  }

  let current_file = ($env.CURRENT_FILE | path expand | to nuon)
  nu --no-config-file --commands $"source ($current_file); ($test_commands)"

  print "Nushell tests completed successfully"
}

def "test has-value" []: nothing -> nothing {
  assert equal (has-value null) false
  assert equal (has-value "") false
  assert equal (has-value "   ") false
  assert equal (has-value "value") true
  assert equal (has-value 42) true
}

def "test load-dotenv parses shell-style key values" []: nothing -> nothing {
  let dotenv_path = (mktemp -t ipp-orch-dotenv.XXXXXX)

  try {
    [
      "# comment"
      ""
      "PLAIN=value"
      "SPACED = value with spaces "
      "DOUBLE=\"quoted value\""
      "SINGLE='quoted value'"
      "EQUALS=a=b=c"
      "=ignored"
    ] | str join "\n" | save --force $dotenv_path

    let dotenv = (load-dotenv $dotenv_path)

    assert equal $dotenv.PLAIN "value"
    assert equal $dotenv.SPACED "value with spaces"
    assert equal $dotenv.DOUBLE "quoted value"
    assert equal $dotenv.SINGLE "quoted value"
    assert equal $dotenv.EQUALS "a=b=c"
    assert equal ($dotenv | get -o "") null
  } catch {|err|
    rm --force $dotenv_path
    error make $err
  }

  rm --force $dotenv_path
}

def "test get-config prefers populated environment values" []: nothing -> nothing {
  let key: cell-path = $.IPP_ORCH_NU_TEST_CONFIG_VALUE
  let dotenv = {IPP_ORCH_NU_TEST_CONFIG_VALUE: "from-dotenv"}

  assert equal (get-config $dotenv $key "fallback") "from-dotenv"

  with-env {IPP_ORCH_NU_TEST_CONFIG_VALUE: "from-env"} {
    assert equal (get-config $dotenv $key "fallback") "from-env"
  }

  with-env {IPP_ORCH_NU_TEST_CONFIG_VALUE: "   "} {
    assert equal (get-config $dotenv $key "fallback") "from-dotenv"
  }

  assert equal (get-config {} $key "fallback") "fallback"
}

def "test remote-target resolves typed defaults" []: nothing -> nothing {
  let target = (remote-target {
    PI_HOST: "pi@example.local"
    PI_SSH_KEY_PATH: "~/.ssh/example-key"
  })

  assert equal $target.host "pi@example.local"
  assert equal $target.key_path ("~/.ssh/example-key" | path expand)
}

def "test aarch64-builder-target resolves explicit builder config" []: nothing -> nothing {
  let target = (aarch64-builder-target {
    AARCH64_BUILDER_HOST: "builder@example.local"
    AARCH64_BUILDER_SSH_KEY_PATH: "~/.ssh/example-builder-key"
  })

  assert equal $target.host "builder@example.local"
  assert equal $target.key_path ("~/.ssh/example-builder-key" | path expand)
}

def "test aarch64-builder-target keeps missing key path empty" []: nothing -> nothing {
  let target = (aarch64-builder-target {
    AARCH64_BUILDER_HOST: "builder@example.local"
  })

  assert equal $target.host "builder@example.local"
  assert equal $target.key_path ""
}

def "test ssh argument builders use typed optional flags" []: nothing -> nothing {
  let key_path = "/tmp/ipp-orch-test-key"
  let control_path = "/tmp/ipp-orch-control"
  let quoted_ssh = "'ssh' '-i' '/tmp/ipp-orch-test-key' '-o' 'IdentitiesOnly=yes' '-o' 'BatchMode=yes'"
  let quoted_ssh_with_control = "'ssh' '-i' '/tmp/ipp-orch-test-key' '-o' 'IdentitiesOnly=yes' '-o' 'BatchMode=yes' '-o' 'ConnectTimeout=3' '-o' 'ConnectionAttempts=5' '-S' '/tmp/ipp-orch-control'"

  assert equal (ssh-options) []
  assert equal (ssh-options --batch) ["-o" "BatchMode=yes"]
  assert equal (ssh-options --connect-timeout 3 --connection-attempts 5) [
    "-o"
    "ConnectTimeout=3"
    "-o"
    "ConnectionAttempts=5"
  ]
  assert equal (ssh-options --key-path $key_path --batch) [
    "-i"
    "/tmp/ipp-orch-test-key"
    "-o"
    "IdentitiesOnly=yes"
    "-o"
    "BatchMode=yes"
  ]

  assert equal (ssh-args "pi@example.local" --key-path $key_path --control-path $control_path --connect-timeout 3 --connection-attempts 5 --batch --tty) [
    "ssh"
    "-i"
    "/tmp/ipp-orch-test-key"
    "-o"
    "IdentitiesOnly=yes"
    "-o"
    "BatchMode=yes"
    "-o"
    "ConnectTimeout=3"
    "-o"
    "ConnectionAttempts=5"
    "-t"
    "-S"
    "/tmp/ipp-orch-control"
    "pi@example.local"
  ]

  assert equal (ssh-rsh-command --key-path $key_path --batch) $quoted_ssh
  assert not ((ssh-rsh-command --key-path $key_path --batch) | str contains "'-S'") "ssh remote shell should omit a control path unless one is provided"
  assert equal (rsync-args --key-path $key_path --batch) ["rsync" "-e" $quoted_ssh]
  assert equal (
    rsync-args
      --key-path $key_path
      --control-path $control_path
      --connect-timeout 3
      --connection-attempts 5
      --batch
  ) ["rsync" "-e" $quoted_ssh_with_control]
  assert equal (rsync-args) ["rsync"]
}

def "test run-with-retries retries transient failures" []: nothing -> nothing {
  let attempt_path = (mktemp -t ipp-orch-retry-attempt.XXXXXX)

  try {
    "0" | save --force $attempt_path

    run-with-retries "test retry success" {
      let attempt = ((open --raw $attempt_path | str trim | into int) + 1)
      ($attempt | into string) | save --force $attempt_path

      if $attempt < 2 {
        error make {msg: "transient test failure"}
      }
    } --attempts 2 --delay 1ms

    assert equal (open --raw $attempt_path | str trim | into int) 2
  } catch {|err|
    rm --force $attempt_path
    error make $err
  }

  rm --force $attempt_path
}

def "test CUPS TLS certificate covers every current SAN" []: nothing -> nothing {
  let temp_dir = (mktemp --directory)
  let cert_path = ($temp_dir | path join "cups.crt")
  let key_path = ($temp_dir | path join "cups.key")

  try {
    let generated = (
      run-external
        "openssl" "req" "-x509" "-newkey" "rsa:2048" "-nodes" "-days" "1"
        "-subj" "/CN=print-server"
        "-addext" "subjectAltName=DNS:print-server,DNS:print-server.local,IP:192.168.4.127,IP:192.168.4.128"
        "-keyout" $key_path "-out" $cert_path
      | complete
    )
    assert equal $generated.exit_code 0 $"test certificate generation should succeed: ($generated.stderr)"

    let identity = {
      dns_names: ["print-server" "print-server.local"]
      ip_addresses: ["192.168.4.128"]
    }
    let certificate = (open --raw $cert_path)
    assert (certificate-covers-identity $certificate $identity) "certificate should allow old IP SANs while covering its current identity"
    assert not (certificate-covers-identity $certificate {
      dns_names: ["print-server" "renamed.local"]
      ip_addresses: ["192.168.4.128"]
    }) "certificate should reject a changed DNS identity"
    assert not (certificate-covers-identity $certificate {
      dns_names: ["print-server" "print-server.local"]
      ip_addresses: ["192.168.4.129"]
    }) "certificate should reject a changed IP identity"
  } catch {|err|
    rm --recursive --force $temp_dir
    error make $err
  }

  rm --recursive --force $temp_dir
}

def "test Pi smoke status requires the physical printer" []: nothing -> nothing {
  let result = (
    nu --no-config-file --commands '
use scripts/lib/status.nu require-ready-status
require-ready-status {
  appUp: true
  cupsReachable: true
  printerAttached: false
  printerQueueAvailable: false
}
'
    | complete
  )

  assert not equal $result.exit_code 0 "smoke validation must reject a missing physical printer"
  assert ($result.stderr | str contains "printerAttached") "smoke failure should identify the missing readiness field"
}

def "test supervised CUPS USB URI rewriting" []: nothing -> nothing {
  let result = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
print (supervised-usb-device-uri "usb://HP/Laser%20MFP?serial=123")
print (supervised-usb-device-uri "file:///tmp/output")
'
    | complete
  )

  assert equal $result.exit_code 0 $"expected supervised USB URI rewriting to execute: ($result.stderr)"
  let lines = ($result.stdout | lines)
  assert equal ($lines | get 0) "ipp-orch-usb://HP/Laser%20MFP?serial=123"
  assert equal ($lines | get 1) "file:///tmp/output"
}

def "test CUPS queue configuration owns every persisted queue option" []: nothing -> nothing {
  let result = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
let printers_conf = "<Printer Other>\nOption media Letter\n</Printer>\n<Printer HP135a>\nUUID urn:uuid:target\nOption media A4\nOption PageSize A4\nOption Resolution 600dpi\nAttribute marker-colors none\n</Printer>\n"
print ((queue-option-reset-args $printers_conf "HP135a") | str join " ")
print ((queue-option-reset-args "" "HP135a") | length)
print ((queue-configuration-args "HP135a" "ipp-orch-usb://HP/x" "/nix/store/x.ppd") | str join " ")
'
    | complete
  )

  assert equal $result.exit_code 0 $"expected CUPS queue option helpers to execute: ($result.stderr)"
  let lines = ($result.stdout | lines)
  assert equal ($lines | get 0) "-R media-default -R PageSize-default -R Resolution-default"
  assert equal ($lines | get 1) "0"
  let configuration = ($lines | get 2)
  assert ($configuration | str contains "-P /nix/store/x.ppd") "queue must take its PPD from the Nix store"
  assert ($configuration | str contains "printer-is-shared=false") "queue must be configured unshared before the IPP contract gate"
  assert not ($configuration | str contains "-E") "queue must not be enabled before the IPP contract gate"
  assert not ($configuration | str contains "media") "queue must not set media-default; the PPD owns the page default"
  assert not ($configuration | str contains "PageSize") "queue must not set PageSize; the PPD owns the page default"
}

def "test CUPS printer block extraction is scoped to target queue" []: nothing -> nothing {
  let result = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
let printers_conf = "<Printer Other>\nUUID urn:uuid:other\nErrorPolicy abort-job\n</Printer>\n<Printer HP135a>\nUUID urn:uuid:target\nErrorPolicy stop-printer\n</Printer>\n"
print (cups-printer-block $printers_conf "HP135a")
'
    | complete
  )

  assert equal $result.exit_code 0 $"expected CUPS printer block extraction to execute: ($result.stderr)"
  assert ($result.stdout | str contains "<Printer HP135a>") "target printer block should be returned"
  assert ($result.stdout | str contains "ErrorPolicy stop-printer") "target printer policy should be returned"
  assert not ($result.stdout | str contains "<Printer Other>") "other printer block should not be returned"
  assert not ($result.stdout | str contains "ErrorPolicy abort-job") "other printer policy should not satisfy target verification"
}

def "test CUPS printer device URI extraction is scoped to target queue" []: nothing -> nothing {
  let result = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
let printers_conf = "<Printer Other>\nDeviceURI ipp-orch-usb://Other/Printer\n</Printer>\n<Printer HP135a>\nUUID urn:uuid:target\nDeviceURI ipp-orch-usb://HP/Laser%20MFP?serial=123&interface=1\nErrorPolicy abort-job\n</Printer>\n"
print (printer-device-uri-from-config $printers_conf "HP135a")
'
    | complete
  )

  assert equal $result.exit_code 0 $"expected CUPS printer URI extraction to execute: ($result.stderr)"
  assert equal ($result.stdout | str trim) "ipp-orch-usb://HP/Laser%20MFP?serial=123&interface=1"
}

def "test explicit HP device URI normalization accepts absent option" []: nothing -> nothing {
  let result = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
print $"empty=(explicit-device-uri null)"
print $"value=(explicit-device-uri "ipp-orch-usb://HP/Laser%20MFP?serial=123&interface=1")"
'
    | complete
  )

  assert equal $result.exit_code 0 $"expected explicit HP device URI normalization to execute: ($result.stderr)"
  let lines = ($result.stdout | lines)
  assert equal ($lines | get 0) "empty="
  assert equal ($lines | get 1) "value=ipp-orch-usb://HP/Laser%20MFP?serial=123&interface=1"
}

def "test supervised CUPS USB backend wrapper delegates through original URI" []: nothing -> nothing {
  let root = (repo-root)
  let backend = ($root | path join "scripts/cups/backend/ipp-orch-usb")
  let fake_backend = (mktemp -t ipp-orch-fake-usb-backend.XXXXXX)
  let capture = (mktemp -t ipp-orch-fake-usb-capture.XXXXXX)
  let usb_root = (mktemp --directory)

  try {
    [
      "#!/bin/sh"
      "set -eu"
      "if [ \"$#\" -eq 0 ]; then"
      "  if [ \"${IPP_ORCH_FAKE_DISCOVERY_FAIL:-}\" = \"true\" ]; then"
      "    echo 'fake discovery failed' >&2"
      "    exit 42"
      "  fi"
      "  echo 'direct usb://HP/Test?serial=123 \"HP Test\" \"HP Test\"'"
      "  exit 0"
      "fi"
      "if [ \"${IPP_ORCH_FAKE_TIMEOUT:-}\" = \"true\" ]; then"
      "  sleep 1"
      "  exit 0"
      "fi"
      "printf 'DEVICE_URI=%s\n' \"$DEVICE_URI\" > \"$IPP_ORCH_FAKE_CAPTURE\""
      "printf 'ARGC=%s\n' \"$#\" >> \"$IPP_ORCH_FAKE_CAPTURE\""
      "printf 'ARG1=%s\n' \"$1\" >> \"$IPP_ORCH_FAKE_CAPTURE\""
      "printf 'STDIN_BYTES=%s\n' \"$(wc -c | tr -d '[:space:]')\" >> \"$IPP_ORCH_FAKE_CAPTURE\""
      "exit 0"
      ""
    ] | str join "\n" | save --force $fake_backend
    chmod +x $fake_backend

    let syntax = (run-external "sh" "-n" $backend | complete)
    assert equal $syntax.exit_code 0 $"backend wrapper shell syntax should be valid: ($syntax.stderr)"

    let discovery = (
      with-env {IPP_ORCH_REAL_USB_BACKEND: $fake_backend} {
        run-external "sh" $backend | complete
      }
    )
    assert equal $discovery.exit_code 0 $"backend wrapper discovery should execute: ($discovery.stderr)"
    assert ($discovery.stdout | str contains "direct ipp-orch-usb://HP/Test?serial=123") "discovery should advertise supervised USB URIs"

    let failed_discovery = (
      with-env {
        IPP_ORCH_REAL_USB_BACKEND: $fake_backend
        IPP_ORCH_FAKE_DISCOVERY_FAIL: "true"
      } {
        run-external "sh" $backend | complete
      }
    )
    assert equal $failed_discovery.exit_code 42 "backend wrapper discovery should preserve the real backend exit code"
    assert ($failed_discovery.stderr | str contains "fake discovery failed") "backend wrapper discovery should preserve the real backend stderr"

    let empty_job = (
      with-env {
        IPP_ORCH_REAL_USB_BACKEND: $fake_backend
        IPP_ORCH_FAKE_CAPTURE: $capture
        IPP_ORCH_TEST_BACKEND: $backend
        DEVICE_URI: "ipp-orch-usb://HP/Test?serial=123"
      } {
        run-external "bash" "-c" "printf '' | sh \"$IPP_ORCH_TEST_BACKEND\" 79 Pixel title.pdf 1 print-scaling=none" | complete
      }
    )
    assert equal $empty_job.exit_code 1 "backend wrapper should reject empty filter output"
    assert ($empty_job.stderr | str contains "received no printer bytes") "backend wrapper should explain empty filter output"

    let job = (
      with-env {
        IPP_ORCH_REAL_USB_BACKEND: $fake_backend
        IPP_ORCH_FAKE_CAPTURE: $capture
        IPP_ORCH_TEST_BACKEND: $backend
        DEVICE_URI: "ipp-orch-usb://HP/Test?serial=123"
      } {
        run-external "bash" "-c" "printf 'printer-bytes' | sh \"$IPP_ORCH_TEST_BACKEND\" 79 Pixel title.pdf 1 print-scaling=none" | complete
      }
    )
    assert equal $job.exit_code 0 $"backend wrapper job mode should execute: ($job.stderr)"

    let captured = (open --raw $capture)
    assert ($captured | str contains "DEVICE_URI=usb://HP/Test?serial=123") "job mode should delegate to the original usb:// URI"
    assert ($captured | str contains "ARGC=5") "job mode should preserve backend arguments"
    assert ($captured | str contains "ARG1=79") "job mode should preserve the CUPS job id argument"
    assert ($captured | str contains "STDIN_BYTES=13") "job mode should feed staged printer bytes to the real backend"

    let target_device = ($usb_root | path join "1-1")
    let other_device = ($usb_root | path join "1-2")
    mkdir $target_device $other_device
    "03f0" | save ($target_device | path join "idVendor")
    "f22a" | save ($target_device | path join "idProduct")
    "1" | save ($target_device | path join "authorized")
    "03f0" | save ($other_device | path join "idVendor")
    "ffff" | save ($other_device | path join "idProduct")
    "1" | save ($other_device | path join "authorized")

    let timed_out_job = (
      with-env {
        IPP_ORCH_REAL_USB_BACKEND: $fake_backend
        IPP_ORCH_FAKE_TIMEOUT: "true"
        IPP_ORCH_USB_BACKEND_TIMEOUT_SECONDS: "0.05"
        IPP_ORCH_USB_SYSFS_ROOT: $usb_root
        IPP_ORCH_TEST_BACKEND: $backend
        DEVICE_URI: "ipp-orch-usb://HP/Test?serial=123"
      } {
        run-external "bash" "-c" "printf 'printer-bytes' | sh \"$IPP_ORCH_TEST_BACKEND\" 79 Pixel title.pdf 1 print-scaling=none" | complete
      }
    )
    assert equal $timed_out_job.exit_code 1 "backend timeout should fail the print job"
    assert equal (open --raw ($target_device | path join "authorized") | str trim) "0" "backend timeout should deauthorize the target VID/PID"
    assert equal (open --raw ($other_device | path join "authorized") | str trim) "1" "backend timeout should leave other HP devices authorized"
  } catch {|err|
    rm --force $fake_backend
    rm --force $capture
    rm --recursive --force $usb_root
    error make $err
  }

  rm --force $fake_backend
  rm --force $capture
  rm --recursive --force $usb_root
}

def "test repo helpers expose stable strings" []: nothing -> nothing {
  assert equal (repo-root | path expand) (pwd | path expand)
  assert ("node_modules" in (deploy-excludes)) "deploy excludes should include node_modules"
  assert ("result" in (deploy-excludes)) "deploy excludes should include Nix result symlink"
  assert ("result-*" in (deploy-excludes)) "deploy excludes should include numbered Nix result symlinks"
  assert (".git" in (deploy-excludes)) "deploy excludes should include .git"
  assert (".direnv" in (deploy-excludes)) "deploy excludes should include direnv state"
  assert (".env" in (deploy-excludes)) "deploy excludes should include secrets"
}

def "test source installables include untracked working tree files" []: nothing -> nothing {
  assert equal (
    source-installable "/work/ipp-print-orchestrator" ".#packages.aarch64-linux.ipp-print-orchestrator"
  ) "path:/work/ipp-print-orchestrator#packages.aarch64-linux.ipp-print-orchestrator"
  assert equal (
    source-installable "/work/ipp-print-orchestrator" "github:example/project#package"
  ) "github:example/project#package"
}

def "test deploy live pi service env rendering executes" []: nothing -> nothing {
  let command = '
use scripts/lib/service-env.nu [local-service-env-content]
local-service-env-content {
  PI_HOST: "ignored@example.local",
  APP_DIR: "/ignored",
  IPP_ORCH_BIND_PORT: "9999"
}
'
  let result = (nu --no-config-file --commands $command | complete)

  assert equal $result.exit_code 0 $"deploy env rendering should execute: ($result.stderr)"
  assert ($result.stdout | str contains "IPP_ORCH_BIND_PORT=9999") "expected deploy env to include overridden bind port"
  assert not ($result.stdout | str contains "PI_HOST=") "deploy env should not include deploy-only PI_HOST"
  assert not ($result.stdout | str contains "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=") ".env.example values should not be rendered by deploy"
}

def "test deploy parses nix closure path marker" []: nothing -> nothing {
  let paths = (parse-nix-paths "noise\nIPP_ORCH_NIX_PATHS\t/nix/store/runtime\t/nix/store/driver\t/nix/store/backend\n")

  assert equal $paths.runtime_path "/nix/store/runtime"
  assert equal $paths.driver_path "/nix/store/driver"
  assert equal $paths.backend_path "/nix/store/backend"
}

def "test systemd renderer points app service at nix runtime wrapper" []: nothing -> nothing {
  let command = '
source scripts/install-systemd-live-from-pi.nu
print (render-unit systemd/ipp-print-orchestrator.service /srv/ipp --runtime-path /nix/store/runtime)
'
  let result = (nu --no-config-file --commands $command | complete)

  assert equal $result.exit_code 0 $"systemd unit rendering should execute: ($result.stderr)"
  assert ($result.stdout | str contains "WorkingDirectory=/srv/ipp") "renderer should preserve configured app working directory"
  assert ($result.stdout | str contains "ExecStart=/nix/store/runtime/bin/ipp-print-orchestrator-agent") "renderer should point ExecStart at Nix runtime wrapper"
  assert not ($result.stdout | str contains "/usr/bin/node") "renderer should remove mutable node ExecStart"
}

def "test observability query targets the triggered trace" []: nothing -> nothing {
  assert equal (
    trace-query "ipp-print-logs" "a1b2c3"
  ) "['ipp-print-logs'] | where trace_id == 'a1b2c3' | summarize rows = count()"
}

def "test nushell files parse" []: nothing -> nothing {
  let files = (glob "scripts/**/*.nu" | sort)
  assert (($files | length) > 0) "expected Nushell files under scripts/"

  for file in $files {
    assert equal (nu-check --debug $file) true $"($file) should pass nu-check"

    let result = (nu --ide-check 0 $file | complete)
    assert equal $result.exit_code 0 $"($file) should parse: ($result.stderr)"
  }
}
