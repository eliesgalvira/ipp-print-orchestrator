#!/usr/bin/env nu

use lib/env.nu [has-value load-dotenv]
use lib/remote.nu [
  aarch64-builder-target
  remote-target
  rsync-args
  run-ssh
  run-ssh-with-input
  run-timed
  ssh-options
]
use lib/repo.nu [deploy-excludes repo-root]

const DEFAULT_RUNTIME_INSTALLABLE = ".#packages.aarch64-linux.ipp-print-orchestrator"
const DEFAULT_DRIVER_INSTALLABLE = ".#packages.aarch64-linux.hp-uld-hp135a"
const DEFAULT_BACKEND_INSTALLABLE = ".#packages.aarch64-linux.cups-usb-backend"
const DEFAULT_BUILDER_SOURCE_DIR = "/tmp/ipp-print-orchestrator-aarch64-build"
const REMOTE_NIX = "/nix/var/nix/profiles/default/bin/nix"

def require-command [name: string]: nothing -> nothing {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def require-builder-target [target: record<host: string, key_path: string>]: nothing -> nothing {
  if not (has-value $target.host) {
    error make {msg: "missing AARCH64_BUILDER_HOST. Set it to an SSH builder or to 'local' for QEMU/binfmt local emulation; the live Pi is not an acceptable builder for the runtime package."}
  }
}

def is-local-builder [host: string]: nothing -> bool {
  $host in ["local" "localhost"]
}

def store-url [host: string]: nothing -> string {
  $"ssh-ng://($host)"
}

def sh-single-quote [value: string]: nothing -> string {
  "'" + (($value | into string) | str replace --all "'" "'\\''") + "'"
}

def nix-ssh-opts [
  --key-path: path
  --connect-timeout: int
  --connection-attempts: int
  --batch
]: nothing -> string {
  ssh-options
    --key-path=$key_path
    --connect-timeout=$connect_timeout
    --connection-attempts=$connection_attempts
    --batch=$batch
  | str join " "
}

def verify-remote-nix [
  label: string
  host: string
  key_path: path
  --connect-timeout: int
  --connection-attempts: int
]: nothing -> nothing {
  let result = (
    run-ssh $host [$REMOTE_NIX "--version"] --key-path $key_path --connect-timeout $connect_timeout --connection-attempts $connection_attempts --batch
    | complete
  )

  if $result.exit_code != 0 {
    error make {msg: $"($label) does not have nix available at ($REMOTE_NIX): ($result.stderr | str trim)"}
  }

  print $"($label) nix: ($result.stdout | str trim)"
}

def remote-build-script [
  source_dir: string
  runtime_installable: string
  driver_installable: string
  backend_installable: string
]: nothing -> string {
  [
    "set -eu"
    $"source_dir=(sh-single-quote $source_dir)"
    $"runtime_installable=(sh-single-quote $runtime_installable)"
    $"driver_installable=(sh-single-quote $driver_installable)"
    $"backend_installable=(sh-single-quote $backend_installable)"
    $"remote_nix=(sh-single-quote $REMOTE_NIX)"
    ""
    "\"$remote_nix\" --version >/dev/null"
    "test -r \"$source_dir/flake.nix\""
    "cd \"$source_dir\""
    ""
    "single_out_path() {"
    "  installable=\"$1\""
    "  out_path=$(\"$remote_nix\" build --max-jobs 1 --cores 1 --no-link --print-out-paths \"$installable\")"
    "  case \"$out_path\" in"
    "    /nix/store/*) printf '%s\\n' \"$out_path\" ;;"
    "    *) printf 'expected one /nix/store output path for %s, got: %s\\n' \"$installable\" \"$out_path\" >&2; exit 1 ;;"
    "  esac"
    "}"
    ""
    "runtime_path=$(single_out_path \"$runtime_installable\")"
    "driver_path=$(single_out_path \"$driver_installable\")"
    "backend_path=$(single_out_path \"$backend_installable\")"
    ""
    "printf 'IPP_ORCH_NIX_PATHS\\t%s\\t%s\\t%s\\n' \"$runtime_path\" \"$driver_path\" \"$backend_path\""
  ] | str join "\n"
}

def parse-build-paths [stdout: string]: nothing -> record<runtime_path: string, driver_path: string, backend_path: string> {
  let marker = "IPP_ORCH_NIX_PATHS\t"
  let lines = (
    $stdout
    | lines
    | where {|line| $line | str starts-with $marker}
  )

  if (($lines | length) != 1) {
    error make {msg: $"expected exactly one ($marker) line from aarch64 builder, got ($lines | length)"}
  }

  let fields = (($lines | first) | split row "\t")

  if (($fields | length) != 4) {
    error make {msg: $"expected builder path line to contain 3 store paths, got ($fields | length) fields"}
  }

  {
    runtime_path: ($fields | get 1)
    driver_path: ($fields | get 2)
    backend_path: ($fields | get 3)
  }
}

def single-local-out-path [installable: string]: nothing -> string {
  let result = (run-external "nix" "build" "--max-jobs" "1" "--cores" "1" "--no-link" "--print-out-paths" $installable | complete)

  if $result.exit_code != 0 {
    error make {msg: $"local nix build failed for ($installable): ($result.stderr | str trim)"}
  }

  let out_paths = (
    $result.stdout
    | lines
    | where {|line| ($line | str trim | str length) > 0}
  )

  if (($out_paths | length) != 1) {
    error make {msg: $"expected exactly one output path for ($installable), got ($out_paths | length)"}
  }

  $out_paths | first
}

def local-aarch64-emulation-ready []: nothing -> nothing {
  let binfmt_path = "/proc/sys/fs/binfmt_misc/qemu-aarch64"

  if not ($binfmt_path | path exists) {
    error make {msg: "local aarch64 emulation is not registered. Install qemu-user-static and qemu-user-static-binfmt, restart systemd-binfmt, and add aarch64-linux to Nix extra-platforms."}
  }

  let config = (run-external "nix" "config" "show" "extra-platforms" | complete)

  if $config.exit_code != 0 {
    error make {msg: $"failed to read Nix extra-platforms: ($config.stderr | str trim)"}
  }

  if not ($config.stdout | str contains "aarch64-linux") {
    error make {msg: "Nix extra-platforms does not include aarch64-linux. Add it to /etc/nix/nix.conf and restart nix-daemon."}
  }
}

def build-local-paths [
  runtime_installable: string
  driver_installable: string
  backend_installable: string
]: nothing -> record<runtime_path: string, driver_path: string, backend_path: string> {
  local-aarch64-emulation-ready

  {
    runtime_path: (single-local-out-path $runtime_installable)
    driver_path: (single-local-out-path $driver_installable)
    backend_path: (single-local-out-path $backend_installable)
  }
}

def copy-closure [
  phase: string
  direction: string
  host: string
  key_path: path
  paths: list<string>
  --connect-timeout: int
  --connection-attempts: int
]: nothing -> nothing {
  let nix_ssh_opts = (
    nix-ssh-opts
      --key-path=$key_path
      --connect-timeout=$connect_timeout
      --connection-attempts=$connection_attempts
      --batch
  )

  let direction_args = if $direction == "from" {
    ["--from" (store-url $host)]
  } else if $direction == "to" {
    ["--to" (store-url $host)]
  } else {
    error make {msg: $"invalid nix copy direction: ($direction)"}
  }

  with-env {NIX_SSHOPTS: $nix_ssh_opts} {
    let result = (run-external "nix" "copy" ...$direction_args ...$paths | complete)

    if $result.exit_code != 0 {
      error make {msg: $"($phase) failed: ($result.stderr | str trim)"}
    }
  }
}

def main [
  --runtime-installable: string = $DEFAULT_RUNTIME_INSTALLABLE
  --driver-installable: string = $DEFAULT_DRIVER_INSTALLABLE
  --backend-installable: string = $DEFAULT_BACKEND_INSTALLABLE
  --builder-source-dir: string = $DEFAULT_BUILDER_SOURCE_DIR
]: nothing -> nothing {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let pi = (remote-target $dotenv)
  let builder = (aarch64-builder-target $dotenv)
  let ssh_connect_timeout = 3
  let ssh_connection_attempts = 5

  require-command nix
  require-command rsync
  require-command ssh
  require-builder-target $builder

  let use_local_builder = (is-local-builder $builder.host)

  if (not $use_local_builder) and ($builder.host == $pi.host) {
    error make {msg: $"AARCH64_BUILDER_HOST points at the Pi target (($pi.host)). Use a separate aarch64 builder; the live Pi does not have enough memory for the JS runtime build."}
  }

  verify-remote-nix "Pi target" $pi.host $pi.key_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts

  let paths = if $use_local_builder {
    let build_started_at = (date now)
    print $"[($build_started_at | format date "%+")] start build Nix closures locally through aarch64 emulation"
    let built_paths = (build-local-paths $runtime_installable $driver_installable $backend_installable)
    let build_elapsed = ((date now) - $build_started_at)
    print $"[(date now | format date "%+")] done build Nix closures locally through aarch64 emulation \(($build_elapsed)\)"
    $built_paths
  } else {
    verify-remote-nix "aarch64 builder" $builder.host $builder.key_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts

    run-timed "stage source on aarch64 builder" {
      let exclude_args = (
        (deploy-excludes | append ["result" "result-*" ".direnv"])
        | each {|exclude| ["--exclude" $exclude]}
        | flatten
      )
      let command = (
        (rsync-args --key-path $builder.key_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts --batch)
        ++ ["-az" "--delete"]
        ++ $exclude_args
        ++ [$"($root_dir)/" $"($builder.host):($builder_source_dir)/"]
      )
      run-external ...$command
    }

    let build_started_at = (date now)
    print $"[($build_started_at | format date "%+")] start build Nix closures on aarch64 builder"
    let build_result = (
      run-ssh-with-input $builder.host (remote-build-script $builder_source_dir $runtime_installable $driver_installable $backend_installable) ["sh" "-s"] --key-path $builder.key_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts --server-alive-interval 15 --server-alive-count-max 160 --batch
      | complete
    )

    if $build_result.exit_code != 0 {
      error make {msg: $"aarch64 builder failed: ($build_result.stderr | str trim)"}
    }

    let build_elapsed = ((date now) - $build_started_at)
    print $"[(date now | format date "%+")] done build Nix closures on aarch64 builder \(($build_elapsed)\)"
    parse-build-paths $build_result.stdout
  }

  let store_paths = [
    $paths.runtime_path
    $paths.driver_path
    $paths.backend_path
  ]

  if not $use_local_builder {
    run-timed "copy closures from aarch64 builder to local store" {
      copy-closure "copy closures from aarch64 builder" "from" $builder.host $builder.key_path $store_paths --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts
    }
  }

  run-timed "copy closures from local store to Pi" {
    copy-closure "copy closures to Pi" "to" $pi.host $pi.key_path $store_paths --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts
  }

  run-timed "verify copied closures on Pi" {
    nu scripts/check-nix-closures-live-to-pi.nu --runtime-path $paths.runtime_path --driver-path $paths.driver_path --backend-path $paths.backend_path
  }

  print "aarch64 Nix closures built, copied, and verified on Pi:"
  print $"  runtime: ($paths.runtime_path)"
  print $"  driver:  ($paths.driver_path)"
  print $"  backend: ($paths.backend_path)"
}
