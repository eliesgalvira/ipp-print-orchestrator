#!/usr/bin/env nu

use lib/remote.nu [ensure-user-bun-on-path run-sudo run-timed]

const RELATED_APT_PACKAGES = [
  "curl"
  "unzip"
  "rsync"
  "nodejs"
  "npm"
  "cups-client"
  "ca-certificates"
  "gnupg"
  "nushell"
]

def command-exists [name: string]: nothing -> bool {
  not (which $name | is-empty)
}

def apt-package-installed [package: string]: nothing -> bool {
  let result = (^dpkg-query -W "-f=${Status}" $package | complete)
  ($result.exit_code == 0) and ($result.stdout | str contains "install ok installed")
}

def update-installed-apt-packages []: nothing -> nothing {
  if not (command-exists apt-get) {
    error make {msg: "Unsupported package manager on target machine. Update related packages manually."}
  }

  let installed_packages = ($RELATED_APT_PACKAGES | where {|package| apt-package-installed $package})
  let missing_packages = ($RELATED_APT_PACKAGES | where {|package| not (apt-package-installed $package)})

  if (($missing_packages | length) > 0) {
    let missing_package_list = ($missing_packages | str join ", ")
    print $"skipping missing apt packages \(run bootstrap to install\): ($missing_package_list)"
  }

  if (($installed_packages | length) == 0) {
    print "no related apt packages are installed; skipping apt upgrade"
  } else {
    let installed_package_list = ($installed_packages | str join ", ")
    print $"upgrading installed apt packages: ($installed_package_list)"
    run-sudo ["apt-get" "update"]
    run-sudo (["apt-get" "install" "-y" "--only-upgrade"] ++ $installed_packages)
  }
}

def update-bun []: nothing -> nothing {
  if (command-exists bun) {
    ^bun upgrade
  } else {
    print "bun is not installed; skipping bun upgrade"
  }
}

def main []: nothing -> nothing {
  ensure-user-bun-on-path

  run-timed "update apt packages" {
    update-installed-apt-packages
  }

  run-timed "update bun runtime" {
    update-bun
  }
}
