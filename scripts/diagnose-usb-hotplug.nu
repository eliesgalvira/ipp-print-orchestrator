#!/usr/bin/env nu

use lib/env.nu *
use lib/repo.nu repo-root

def show-heading [title: string] {
  print ""
  print $"== ($title) =="
}

def show-status [status_url: string] {
  let now = (date now | format date "%+")
  let result = (^curl -fsS $status_url | complete)

  if $result.exit_code == 0 {
    print $"[($now)] status ($result.stdout | str trim)"
  } else {
    print $"[($now)] status ({error: "status-unreachable", url: $status_url} | to json -r)"
  }
}

def read-file-line [path: path] {
  if ($path | path exists) {
    open --raw $path | str replace --all "\n" ""
  } else {
    ""
  }
}

def show-usb-sysfs [usb_sysfs_root: string] {
  print $"[(date now | format date "%+")] usb-sysfs"

  if not ($usb_sysfs_root | path exists) {
    print $"  missing ($usb_sysfs_root)"
    return
  }

  ls -a $usb_sysfs_root
  | where {|entry| $entry.type in [dir symlink]}
  | where {|entry| not (($entry.name | path basename) | str contains ":")}
  | get name
  | sort
  | each {|device_root|
      let manufacturer = (read-file-line ($device_root | path join "manufacturer"))
      let product = (read-file-line ($device_root | path join "product"))
      let serial = (read-file-line ($device_root | path join "serial"))

      if (has-value $"($manufacturer)($product)($serial)") {
        print $"  ($device_root | path basename) manufacturer=($manufacturer) product=($product) serial=($serial)"
      }
    }
  | ignore
}

def main [duration_seconds: int = 45] {
  let root_dir = (repo-root)
  let repo_dotenv = (load-dotenv ($root_dir | path join ".env"))
  let etc_dotenv = (load-dotenv /etc/ipp-print-orchestrator.env)
  let dotenv = ($repo_dotenv | merge $etc_dotenv)

  let printer_name = (get-config $dotenv IPP_ORCH_PRINTER_NAME "printer")
  let usb_sysfs_root = (get-config $dotenv IPP_ORCH_USB_SYSFS_ROOT "/sys/bus/usb/devices")
  let bind_host = (get-config $dotenv IPP_ORCH_BIND_HOST "127.0.0.1")
  let bind_port = (get-config $dotenv IPP_ORCH_BIND_PORT "4310")
  let status_url = $"http://($bind_host):($bind_port)/v1/status"

  show-heading "CUPS queue"
  let lpstat_queue = (^lpstat -v $printer_name | complete)
  if $lpstat_queue.exit_code == 0 {
    print ($lpstat_queue.stdout | str trim)
  } else {
    print $"lpstat failed for printer=($printer_name)"
    print "Available CUPS queues:"
    let queues = (^lpstat -v | complete)
    print ($queues.stdout | str trim)

    let detected_queue = (
      $queues.stdout
      | lines
      | where {|line| $line =~ "^device for [^:]+:"}
      | first
      | default ""
      | parse "device for {queue}:*"
      | get -o queue.0
      | default ""
    )

    if (has-value $detected_queue) {
      print $"Hint: set IPP_ORCH_PRINTER_NAME=($detected_queue) if this is the queue the daemon should use."
    }
  }

  show-heading "Initial status"
  show-status $status_url

  show-heading "Initial USB sysfs"
  show-usb-sysfs $usb_sysfs_root

  show-heading "Monitoring"
  print $"Unplug and replug the USB printer now. Monitoring for ($duration_seconds) seconds."

  let status_job = (job spawn --description "ipp usb hotplug status polling" {
    let started = (date now)
    while (((date now) - $started) < ($duration_seconds * 1sec)) {
      show-status $status_url
      sleep 2sec
    }
  })

  let udev_result = (^timeout ($duration_seconds | into string) udevadm monitor --udev --subsystem-match=usb --property | complete)
  if (has-value ($udev_result.stdout | str trim)) {
    print ($udev_result.stdout | str trim)
  }
  if (has-value ($udev_result.stderr | str trim)) {
    print -e ($udev_result.stderr | str trim)
  }

  try { job kill $status_job }

  show-heading "Final USB sysfs"
  show-usb-sysfs $usb_sysfs_root

  show-heading "Result"
  if ($udev_result.exit_code == 0) or ($udev_result.exit_code == 124) {
    print "udevadm monitor completed. If status changed here but Axiom did not log a status event, check the daemon journal."
  } else {
    print $"udevadm monitor exited with status ($udev_result.exit_code). The daemon may be missing USB hotplug events too."
  }
}
