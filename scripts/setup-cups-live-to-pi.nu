#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target rsync-args run-ssh run-timed ssh-args]
use lib/repo.nu repo-root

def run-required [label: string, command: list<string>]: nothing -> nothing {
  let result = (run-external ...$command | complete)

  if $result.exit_code != 0 {
    error make {msg: $"($label) failed: ($result.stderr | str trim)"}
  }
}

def main [
  --printer-name: string
  --driver: string
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
  let local_filter_bundle = ($root_dir | path join "apps/agent/dist-cups-filter/cups-pdf-preflight-filter.js")
  let remote_filter_bundle_dir = ($app_dir | path join "apps/agent/dist-cups-filter")

  if $repair_tls_only and $stop_only {
    error make {msg: "--repair-tls-only cannot be combined with --stop-only"}
  }

  if $repair_tls_only and $enable_printing {
    error make {msg: "--repair-tls-only cannot be combined with --enable-printing"}
  }

  let forwarded_args = (
    []
    | append (if (has-value $printer_name) { ["--printer-name" $printer_name] } else { [] })
    | append (if (has-value $driver) { ["--driver" $driver] } else { [] })
    | append (if (has-value $device_uri) { ["--device-uri" $device_uri] } else { [] })
    | append (if $enable_printing { ["--enable-printing"] } else { [] })
    | append (if $stop_only { ["--stop-only"] } else { [] })
    | append (if $repair_tls_only { ["--repair-tls-only"] } else { [] })
  )

  run-timed $"setup CUPS on ($pi_host)" {
    if not $stop_only and not $repair_tls_only {
      cd $root_dir
      run-required "build CUPS PDF preflight filter bundle" ["bun" "run" "build:cups-filter"]
    }

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

    let rsync_backend_command = (
      (rsync-args --key-path $ssh_key_path --batch)
      ++ [
        "-az"
        ($root_dir | path join "scripts/cups/backend/ipp-orch-usb")
        $"($pi_host):($app_dir)/scripts/cups/backend/"
      ]
    )
    run-required "sync supervised CUPS USB backend" $rsync_backend_command

    if not $stop_only and not $repair_tls_only {
      run-required "create remote CUPS filter bundle directory" (
        (ssh-args $pi_host --key-path $ssh_key_path --batch) ++ ["mkdir" "-p" $remote_filter_bundle_dir]
      )

      let rsync_filter_bundle_command = (
        (rsync-args --key-path $ssh_key_path --batch)
        ++ [
          "-az"
          $local_filter_bundle
          $"($pi_host):($remote_filter_bundle_dir)/"
        ]
      )
      run-required "sync CUPS PDF preflight filter bundle" $rsync_filter_bundle_command
    }

    run-ssh $pi_host (["nu" "--no-config-file" $remote_script] ++ $forwarded_args) --key-path $ssh_key_path --batch
  }
}
