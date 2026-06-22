#!/usr/bin/env nu

use lib/env.nu [has-value load-dotenv]
use lib/remote.nu [aarch64-builder-target]
use lib/repo.nu [repo-root]


def command-name [name: string]: nothing -> bool {
  not (which $name | is-empty)
}


def print-package-manager-notes []: nothing -> nothing {
  if (command-name "pacman") {
    print "If you are on Arch/CachyOS, install with:"
    print "  sudo pacman -S qemu-user-static qemu-user-static-binfmt"
    print "  sudo systemctl restart systemd-binfmt.service"
  } else if (command-name "apt-get") {
    print "If you are on Debian/Ubuntu, install with:"
    print "  sudo apt-get update"
    print "  sudo apt-get install -y qemu-user-static"
  } else if (command-name "dnf") {
    print "If you are on Fedora/RHEL, install with:"
    print "  sudo dnf install -y qemu-user-binfmt"
    print "  sudo systemctl restart systemd-binfmt.service"
  } else if (command-name "zypper") {
    print "If you are on OpenSUSE, install with:"
    print "  sudo zypper install qemu-user qemu-qemu-tools"
    print "  sudo systemctl restart systemd-binfmt.service"
  } else {
    print "Install qemu-user-static/qemu-user-binfmt from your platform package manager and enable binfmt_misc for aarch64."
  }

  print "Then restart binfmt and ensure aarch64 is registered:"
  print "  cat /proc/sys/fs/binfmt_misc/qemu-aarch64"
}


def check-local-builder []: nothing -> nothing {
  let binfmt_path = "/proc/sys/fs/binfmt_misc/qemu-aarch64"

  if not ($binfmt_path | path exists) {
    error make {msg: "qemu aarch64 binary format is not registered in binfmt_misc"}
  }

  let config = (run-external "nix" "config" "show" "extra-platforms" | complete)

  if $config.exit_code != 0 {
    error make {msg: $"failed to read Nix extra-platforms: ($config.stderr | str trim)"}
  }

  let out = ($config.stdout | str trim)
  if not ($out | str contains "aarch64-linux") {
    error make {msg: "Nix extra-platforms does not include aarch64-linux"}
  }

  print "local aarch64 builder prerequisites are configured"
}


def main []: nothing -> nothing {
  let dotenv = (load-dotenv ((repo-root) | path join ".env"))
  let target = (aarch64-builder-target $dotenv)

  if not (command-name "nix") {
    error make {msg: "nix command not found"}
  }

  if not (has-value $target.host) {
    error make {msg: "AARCH64_BUILDER_HOST missing in environment"}
  }

  if (not (is-local-builder $target.host)) {
    print $"AARCH64_BUILDER_HOST is set to ($target.host); local aarch64 preparation is not required"
    print "Use the remote aarch64 builder as configured in .env or set AARCH64_BUILDER_HOST=local"
    return
  }

  try {
    check-local-builder
    return
  } catch {|err|
    print $err.msg
    print-package-manager-notes
    error make {msg: "local aarch64 builder check failed"}
  }
}


def is-local-builder [host: string]: nothing -> bool {
  $host in ["local" "localhost"]
}
