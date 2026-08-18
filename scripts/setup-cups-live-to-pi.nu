#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [build-and-copy-nix-closures remote-target rsync-args run-ssh run-timed ssh-args]
use lib/repo.nu repo-root

def run-required [label: string, command: list<string>]: nothing -> nothing {
  let result = (run-external ...$command | complete)

  if $result.exit_code != 0 {
    error make {msg: $"($label) failed: ($result.stderr | str trim)"}
  }
}

def main [
  --printer-name: string
  --device-uri: string
  --enable-printing
  --stop-only
  --repair-tls-only
]: nothing -> any {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let ssh_key_path = $target.key_path
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let remote_script = ($app_dir | path join "scripts/setup-cups-live-from-pi.nu")

  if $repair_tls_only and $stop_only {
    error make {msg: "--repair-tls-only cannot be combined with --stop-only"}
  }

  if $repair_tls_only and $enable_printing {
    error make {msg: "--repair-tls-only cannot be combined with --enable-printing"}
  }

  let nix_paths = if not $stop_only and not $repair_tls_only {
    print $"[(date now | format date "%+")] start build, copy, and verify Nix closures for CUPS setup"
    let started_at = (date now)
    let paths = (build-and-copy-nix-closures)
    print $"[(date now | format date "%+")] done build, copy, and verify Nix closures for CUPS setup \(((date now) - $started_at)\)"
    $paths
  } else {
    {runtime_path: "", driver_path: "", backend_path: ""}
  }

  let forwarded_args = (
    []
    | append (if (has-value $printer_name) { ["--printer-name" $printer_name] } else { [] })
    | append (if (has-value $device_uri) { ["--device-uri" $device_uri] } else { [] })
    | append (if (has-value $nix_paths.runtime_path) { ["--runtime-path" $nix_paths.runtime_path] } else { [] })
    | append (if (has-value $nix_paths.driver_path) { ["--driver-path" $nix_paths.driver_path] } else { [] })
    | append (if (has-value $nix_paths.backend_path) { ["--backend-path" $nix_paths.backend_path] } else { [] })
    | append (if $enable_printing { ["--enable-printing"] } else { [] })
    | append (if $stop_only { ["--stop-only"] } else { [] })
    | append (if $repair_tls_only { ["--repair-tls-only"] } else { [] })
  )

  run-timed $"setup CUPS on ($pi_host)" {
    run-required "create remote script directory" (
      (ssh-args $pi_host --key-path $ssh_key_path --batch) ++ [
        "mkdir"
        "-p"
        ($app_dir | path join "scripts/lib")
        ($app_dir | path join "scripts/cups/backend")
      ]
    )

    let rsync_script_command = (
      (rsync-args --key-path $ssh_key_path --batch)
      ++ [
        "-az"
        ($root_dir | path join "scripts/setup-cups-live-from-pi.nu")
        $"($pi_host):($app_dir)/scripts/"
      ]
    )
    run-required "sync target CUPS setup script" $rsync_script_command

    let rsync_lib_command = (
      (rsync-args --key-path $ssh_key_path --batch)
      ++ [
        "-az"
        ($root_dir | path join "scripts/lib/avahi.nu")
        ($root_dir | path join "scripts/lib/env.nu")
        ($root_dir | path join "scripts/lib/repo.nu")
        $"($pi_host):($app_dir)/scripts/lib/"
      ]
    )
    run-required "sync target CUPS setup libraries" $rsync_lib_command

    run-ssh $pi_host (["nu" "--no-config-file" $remote_script] ++ $forwarded_args) --key-path $ssh_key_path --batch
  }
}
