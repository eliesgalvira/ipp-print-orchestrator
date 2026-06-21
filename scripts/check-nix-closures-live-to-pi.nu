#!/usr/bin/env nu

use lib/env.nu [has-value load-dotenv]
use lib/remote.nu [remote-target run-remote-nu-source run-ssh run-timed]
use lib/repo.nu [repo-root]

const REMOTE_NIX = "/nix/var/nix/profiles/default/bin/nix"
const REMOTE_NIX_STORE = "/nix/var/nix/profiles/default/bin/nix-store"

def require-store-path [label: string, path: string]: nothing -> nothing {
  if not (has-value $path) {
    error make {msg: $"missing --($label)-path. Build and copy closures first with scripts/build-nix-closures-live-to-pi.nu; this script only verifies store paths already copied to the Pi."}
  }

  if not ($path | str starts-with "/nix/store/") {
    error make {msg: $"--($label)-path must be a /nix/store path, got: ($path)"}
  }
}

def verify-remote-nix [
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
    error make {msg: $"remote Pi target does not have nix available for closure checks: ($result.stderr | str trim)"}
  }

  let store_result = (
    run-ssh $host ["test" "-x" $REMOTE_NIX_STORE] --key-path $key_path --connect-timeout $connect_timeout --connection-attempts $connection_attempts --batch
    | complete
  )

  if $store_result.exit_code != 0 {
    error make {msg: $"remote Pi target does not have nix-store available at ($REMOTE_NIX_STORE): ($store_result.stderr | str trim)"}
  }

  print $"remote Pi nix: ($result.stdout | str trim)"
}

def remote-check-script [
  runtime_path: string
  driver_path: string
  backend_path: string
]: nothing -> string {
  let template = '
let runtime_path = __RUNTIME_PATH__
let driver_path = __DRIVER_PATH__
let backend_path = __BACKEND_PATH__

def run-required [phase: string, args: list<string>]: nothing -> string {
  let result = (run-external ...$args | complete)

  if $result.exit_code != 0 {
    error make {msg: $"($phase) failed: ($result.stderr | str trim)"}
  }

  $result.stdout
}

run-required "verify remote nix is available" ["__REMOTE_NIX__" "--version"] | ignore
run-required "verify runtime store path is valid" ["__REMOTE_NIX_STORE__" "--verify-path" $runtime_path] | ignore
run-required "verify driver store path is valid" ["__REMOTE_NIX_STORE__" "--verify-path" $driver_path] | ignore
run-required "verify backend store path is valid" ["__REMOTE_NIX_STORE__" "--verify-path" $backend_path] | ignore

let service_wrapper = ($runtime_path | path join "bin/ipp-print-orchestrator-agent")
let cups_filter = ($runtime_path | path join "lib/cups/filter/ipp-pdf-preflight-to-spl")
let filter_js = ($runtime_path | path join "libexec/ipp-print-orchestrator/cups-pdf-preflight-filter.js")
let ppd = ($driver_path | path join "share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd")
let raster_filter = ($driver_path | path join "lib/cups/filter/rastertospl")
let usb_backend = ($backend_path | path join "lib/cups/backend/ipp-orch-usb")

run-required "verify service wrapper exists" ["test" "-x" $service_wrapper] | ignore
run-required "verify CUPS PDF preflight wrapper exists" ["test" "-x" $cups_filter] | ignore
run-required "verify bundled CUPS filter JS exists" ["test" "-r" $filter_js] | ignore
run-required "verify HP ULD PPD exists" ["test" "-r" $ppd] | ignore
run-required "verify HP raster filter exists" ["test" "-x" $raster_filter] | ignore
run-required "verify supervised USB backend exists" ["test" "-x" $usb_backend] | ignore
run-required "verify PPD PDF preflight filter directive" ["grep" "-F" "*cupsFilter: \"application/pdf 0 ipp-pdf-preflight-to-spl\"" $ppd] | ignore
run-required "verify PPD raster filter directive" ["grep" "-F" "*cupsFilter:  \"application/vnd.cups-raster 0 rastertospl\"" $ppd] | ignore
run-required "verify supervised USB backend shell syntax" ["sh" "-n" $usb_backend] | ignore

let filter_probe = (run-external $cups_filter | complete)
if $filter_probe.exit_code == 0 {
  error make {msg: "CUPS PDF preflight wrapper unexpectedly succeeded without CUPS filter arguments"}
}

if not ($filter_probe.stderr | str contains "usage: ipp-pdf-preflight-to-spl") {
  error make {msg: $"CUPS PDF preflight wrapper did not produce the expected usage error: ($filter_probe.stderr | str trim)"}
}

if not (which ldd | is-empty) {
  run-required "verify HP raster filter dynamic linker dependencies" ["ldd" $raster_filter] | ignore
}

print $"Nix store checks passed for ($runtime_path)"
print $"Nix store checks passed for ($driver_path)"
print $"Nix store checks passed for ($backend_path)"
'

  $template
  | str replace "__RUNTIME_PATH__" ($runtime_path | to nuon)
  | str replace "__DRIVER_PATH__" ($driver_path | to nuon)
  | str replace "__BACKEND_PATH__" ($backend_path | to nuon)
  | str replace --all "__REMOTE_NIX_STORE__" $REMOTE_NIX_STORE
  | str replace --all "__REMOTE_NIX__" $REMOTE_NIX
}

def main [
  --runtime-path: string = ""
  --driver-path: string = ""
  --backend-path: string = ""
]: nothing -> nothing {
  require-store-path "runtime" $runtime_path
  require-store-path "driver" $driver_path
  require-store-path "backend" $backend_path

  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let ssh_connect_timeout = 3
  let ssh_connection_attempts = 5

  verify-remote-nix $pi_host $ssh_key_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts

  run-timed "verify copied Nix closures on Pi" {
    run-remote-nu-source $pi_host (remote-check-script $runtime_path $driver_path $backend_path) --key-path $ssh_key_path --connect-timeout $ssh_connect_timeout --connection-attempts $ssh_connection_attempts --server-alive-interval 15 --server-alive-count-max 80 --batch
  }
}
