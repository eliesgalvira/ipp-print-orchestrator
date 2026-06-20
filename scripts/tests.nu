#!/usr/bin/env nu

use std/assert

use lib/env.nu [get-config has-value load-dotenv]
use lib/observability.nu [local-service-env-content otel-signal-config validate-observability-env]
use lib/remote.nu [remote-target rsync-args ssh-args ssh-options ssh-rsh-command run-with-retries]
use lib/repo.nu [deploy-excludes repo-root]

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

def "test CUPS TLS verification output classifier handles identity mismatches" []: nothing -> nothing {
  let accepted_self_signed = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
verify-openssl-output-has-matching-identity "print-server-2.local" "Verify return code: 18 (self-signed certificate)"
'
    | complete
  )

  assert equal $accepted_self_signed.exit_code 0 $"expected self-signed cert with matching identity to pass: ($accepted_self_signed.stderr)"

  let unrelated_verify_code = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
verify-openssl-output-has-matching-identity "print-server.local" "Verify return code: 20 (unable to get local issuer certificate)"
'
    | complete
  )

  assert equal $unrelated_verify_code.exit_code 1 "expected unrelated OpenSSL verification codes to fail"
  assert ($unrelated_verify_code.stderr | str contains "CUPS TLS verification returned an unexpected result") "expected unrelated verification code to use the generic verification diagnostic"

  let ip_mismatch = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
verify-openssl-output-has-matching-identity "192.168.4.128" "Verification error: IP address mismatch Verify return code: 64 (IP address mismatch)"
'
    | complete
  )

  assert equal $ip_mismatch.exit_code 1 "expected IP SAN mismatch to fail"
  assert ($ip_mismatch.stderr | str contains "CUPS TLS identity verification failed") "expected IP mismatch to use the identity failure diagnostic"

  let case_variant_hostname_mismatch = (
    nu --no-config-file --commands '
source scripts/setup-cups-live-from-pi.nu
verify-openssl-output-has-matching-identity "print-server.local" "Verification error: Hostname mismatch Verify return code: 62 (hostname mismatch)"
'
    | complete
  )

  assert equal $case_variant_hostname_mismatch.exit_code 1 "expected hostname mismatch to fail"
  assert ($case_variant_hostname_mismatch.stderr | str contains "CUPS TLS identity verification failed") "expected hostname mismatch to use the identity failure diagnostic"
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

def "test supervised CUPS USB backend wrapper delegates through original URI" []: nothing -> nothing {
  let root = (repo-root)
  let backend = ($root | path join "scripts/cups/backend/ipp-orch-usb")
  let fake_backend = (mktemp -t ipp-orch-fake-usb-backend.XXXXXX)
  let capture = (mktemp -t ipp-orch-fake-usb-capture.XXXXXX)

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
  } catch {|err|
    rm --force $fake_backend
    rm --force $capture
    error make $err
  }

  rm --force $fake_backend
  rm --force $capture
}

def "test repo helpers expose stable strings" []: nothing -> nothing {
  assert equal (repo-root | path expand) (pwd | path expand)
  assert ("node_modules" in (deploy-excludes)) "deploy excludes should include node_modules"
  assert (".git" in (deploy-excludes)) "deploy excludes should include .git"
}

def "test deploy live pi service env rendering executes" []: nothing -> nothing {
  let command = '
use scripts/lib/observability.nu [local-service-env-content]
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

def "test observability validation rejects enabled blank otlp config" []: nothing -> nothing {
  let result = (try {
      validate-observability-env {IPP_ORCH_ENABLE_OTLP: "true"}
      {exit_code: 0, stderr: ""}
    } catch {|err|
      {exit_code: 1, stderr: $err.msg}
    })

  assert equal $result.exit_code 1 "enabled OTLP without endpoints should fail validation"
  assert ($result.stderr | str contains "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") "failure should identify missing traces endpoint"
  assert ($result.stderr | str contains "OTEL_EXPORTER_OTLP_LOGS_ENDPOINT") "failure should identify missing logs endpoint"
}

def "test observability validation accepts axiom signal config" []: nothing -> nothing {
  let dotenv = {
    IPP_ORCH_ENABLE_OTLP: "true"
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://us-east-1.aws.edge.axiom.co/v1/traces"
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=Bearer test-token,x-axiom-dataset=ipp-print-traces"
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: "https://us-east-1.aws.edge.axiom.co/v1/logs"
    OTEL_EXPORTER_OTLP_LOGS_HEADERS: "authorization=Bearer test-token,x-axiom-dataset=ipp-print-logs"
  }

  validate-observability-env $dotenv

  let logs = (otel-signal-config $dotenv logs)
  assert equal $logs.dataset "ipp-print-logs"
  assert equal $logs.authorization "Bearer test-token"
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
