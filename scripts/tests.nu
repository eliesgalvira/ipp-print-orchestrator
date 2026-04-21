#!/usr/bin/env nu

use std/assert

use lib/env.nu [get-config has-value load-dotenv]
use lib/remote.nu [remote-target rsync-args ssh-args ssh-options ssh-rsh-command]
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

  assert equal (ssh-options) []
  assert equal (ssh-options --batch) ["-o" "BatchMode=yes"]
  assert equal (ssh-options --key-path $key_path --batch) [
    "-i"
    "/tmp/ipp-orch-test-key"
    "-o"
    "IdentitiesOnly=yes"
    "-o"
    "BatchMode=yes"
  ]

  assert equal (ssh-args "pi@example.local" --key-path $key_path --control-path $control_path --batch --tty) [
    "ssh"
    "-i"
    "/tmp/ipp-orch-test-key"
    "-o"
    "IdentitiesOnly=yes"
    "-o"
    "BatchMode=yes"
    "-t"
    "-S"
    "/tmp/ipp-orch-control"
    "pi@example.local"
  ]

  assert equal (ssh-rsh-command --key-path $key_path --batch) $quoted_ssh
  assert equal (rsync-args --key-path $key_path --batch) ["rsync" "-e" $quoted_ssh]
  assert equal (rsync-args) ["rsync"]
}

def "test repo helpers expose stable strings" []: nothing -> nothing {
  assert equal (repo-root | path expand) (pwd | path expand)
  assert ("node_modules" in (deploy-excludes)) "deploy excludes should include node_modules"
  assert (".git" in (deploy-excludes)) "deploy excludes should include .git"
}

def "test deploy live pi service env rendering executes" []: nothing -> nothing {
  let command = '
source scripts/deploy-live-pi.nu
local-service-env-content (pwd) {
  PI_HOST: "ignored@example.local",
  APP_DIR: "/ignored",
  IPP_ORCH_BIND_PORT: "9999"
}
'
  let result = (nu --no-config-file --commands $command | complete)

  assert equal $result.exit_code 0 $"deploy env rendering should execute: ($result.stderr)"
  assert ($result.stdout | str contains "IPP_ORCH_BIND_PORT=9999") "expected deploy env to include overridden bind port"
  assert not ($result.stdout | str contains "PI_HOST=") "deploy env should not include deploy-only PI_HOST"
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
