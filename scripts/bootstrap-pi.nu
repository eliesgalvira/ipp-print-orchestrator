#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [remote-target run-remote-nu-source run-ssh-with-input ssh-args run-timed]
use lib/repo.nu repo-root

def require-command [name: string] {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def public-key-path [private_key_path: path] {
  $"($private_key_path).pub"
}

def ensure-local-ssh-key [private_key_path: path] {
  let expanded_key_path = ($private_key_path | path expand)
  let expanded_public_key_path = (public-key-path $expanded_key_path)
  mkdir ($expanded_key_path | path dirname)

  if not ($expanded_key_path | path exists) {
    print $"creating SSH key for Pi deploy: ($expanded_key_path)"
    ^ssh-keygen -t ed25519 -a 64 -N "" -C "ipp-print-orchestrator pi deploy" -f $expanded_key_path
  }

  if not ($expanded_public_key_path | path exists) {
    ^ssh-keygen -y -f $expanded_key_path | save --force $expanded_public_key_path
  }

  $expanded_key_path
}

def key-auth-works [host: string, key_path: path] {
  let command = (ssh-args $host $key_path null --batch)
  let result = (run-external ...$command "true" | complete)
  $result.exit_code == 0
}

def open-control-master [host: string, control_path: path] {
  let command = ["ssh" "-M" "-N" "-f" "-S" $control_path $host]
  let result = (run-external ...$command | complete)

  if $result.exit_code != 0 {
    error make {msg: $"failed to open first-time SSH control connection to ($host): ($result.stderr | str trim)"}
  }
}

def close-control-master [host: string, control_path: path] {
  let result = (run-external "ssh" "-S" $control_path "-O" "exit" $host | complete)

  if $result.exit_code != 0 {
    let stderr = ($result.stderr | str trim)
    if (($stderr | str length) > 0) {
      print $"warning: failed to close first-time SSH control connection: ($stderr)"
    }
  }
}

def remote-nu-installed [host: string, key_path?: any, control_path?: any, --batch] {
  let command = (ssh-args $host $key_path $control_path --batch=$batch)
  let result = (run-external ...$command "nu" "--version" | complete)
  $result.exit_code == 0
}

def nu-call-script [
  script: string
  call: string
] {
  $script + "\n" + $call + "\n"
}

def run-remote-prereqs [host: string, key_path: path, script: string] {
  run-ssh-with-input $host $key_path $script ["bash" "-s" "--" $host] null --batch
}

def run-remote-nu-bootstrap [host: string, key_path: path, app_dir: string, script: string] {
  let call = $"main ($app_dir | to nuon) ($host | to nuon)"
  let remote_script = (nu-call-script $script $call)
  run-remote-nu-source $host $key_path $remote_script null --batch
}

def first-time-nu-script [remote_nu_script: string, public_key: string, app_dir: string, host: string] {
  let call = $"main ($app_dir | to nuon) ($host | to nuon) --authorized-key-content ($public_key | to nuon)"
  nu-call-script $remote_nu_script $call
}

def first-time-wrapper-script [remote_prereq_script: string, remote_nu_command: string] {
  $'
set -euo pipefail

APP_DIR="$1"
PI_HOST_LABEL="$2"

bash -s -- "$PI_HOST_LABEL" <<'IPP_BOOTSTRAP_PREREQS'
($remote_prereq_script)
IPP_BOOTSTRAP_PREREQS

nu --no-config-file -c "source /dev/stdin" <<'IPP_REMOTE_NU_BOOTSTRAP'
($remote_nu_command)
IPP_REMOTE_NU_BOOTSTRAP
'
}

def run-first-time-bootstrap [
  host: string
  key_path: path
  app_dir: string
  remote_prereq_script: string
  remote_nu_script: string
  control_path?: any
] {
  let public_key = (open --raw (public-key-path $key_path) | str trim)
  let remote_call = $"main ($app_dir | to nuon) ($host | to nuon) --authorized-key-content ($public_key | to nuon)"
  let remote_nu_command = $remote_nu_script + "\n" + $remote_call + "\n"
  let script = (first-time-wrapper-script $remote_prereq_script $remote_nu_command)

  run-ssh-with-input $host null $script ["bash" "-s" "--" $app_dir $host] $control_path
}

def run-first-time-nu-bootstrap [
  host: string
  app_dir: string
  remote_nu_script: string
  key_path: path
  control_path?: any
] {
  let public_key = (open --raw (public-key-path $key_path) | str trim)
  let remote_script = (first-time-nu-script $remote_nu_script $public_key $app_dir $host)

  run-remote-nu-source $host null $remote_script $control_path
}

def main [] {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let target = (remote-target $dotenv)
  let pi_host = $target.host
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let ssh_key_path = (ensure-local-ssh-key $target.key_path)

  require-command ssh
  require-command ssh-keygen

  let remote_prereq_script = '
set -euo pipefail

PI_HOST_LABEL="$1"

run_sudo() {
  sudo "$@"
}

apt_package_installed() {
  dpkg-query -W -f="${Status}" "$1" 2>/dev/null | grep -q "install ok installed"
}

install_missing_apt_packages() {
  missing_packages=""
  for package in "$@"; do
    if ! apt_package_installed "$package"; then
      missing_packages="${missing_packages} ${package}"
    fi
  done

  if [ -n "$missing_packages" ]; then
    run_sudo apt-get update
    # shellcheck disable=SC2086
    run_sudo apt-get install -y $missing_packages
  fi
}

if ! command -v apt-get >/dev/null 2>&1; then
  echo "Unsupported package manager on target machine. Install curl, ca-certificates, gnupg, and nushell manually." >&2
  exit 1
fi

install_missing_apt_packages curl ca-certificates gnupg

if ! command -v nu >/dev/null 2>&1; then
  tmp_key="$(mktemp)"
  tmp_list="$(mktemp)"
  curl -fsSL https://apt.fury.io/nushell/gpg.key -o "$tmp_key"
  printf "%s\n" "deb [signed-by=/etc/apt/keyrings/fury-nushell.gpg] https://apt.fury.io/nushell/ /" > "$tmp_list"
  run_sudo install -d -m 0755 /etc/apt/keyrings
  run_sudo gpg --dearmor --yes -o /etc/apt/keyrings/fury-nushell.gpg "$tmp_key"
  run_sudo install -m 0644 "$tmp_list" /etc/apt/sources.list.d/fury-nushell.list
  rm -f "$tmp_key" "$tmp_list"
  run_sudo apt-get update
  if ! run_sudo apt-get install -y nushell; then
    echo "Failed to install Nushell from the official apt repository. Check that this Raspberry Pi OS/Debian architecture has a nushell package available." >&2
    exit 1
  fi
fi

echo "nushell ready on ${PI_HOST_LABEL}"
'
  let remote_nu_script_path = ($root_dir | path join "scripts/bootstrap-pi-remote.nu")
  let remote_nu_script = (open --raw $remote_nu_script_path)

  if (key-auth-works $pi_host $ssh_key_path) {
    if not (remote-nu-installed $pi_host $ssh_key_path null --batch) {
      run-timed "remote bootstrap prerequisites" {
        run-remote-prereqs $pi_host $ssh_key_path $remote_prereq_script
      }
    }
    run-timed "remote nushell bootstrap" {
      run-remote-nu-bootstrap $pi_host $ssh_key_path $app_dir $remote_nu_script
    }
  } else {
    let control_dir = (mktemp --directory)
    let control_path = ($control_dir | path join "ssh-control")

    try {
      print $"SSH key auth is not configured for ($pi_host). Enter the Pi SSH password when OpenSSH prompts."
      open-control-master $pi_host $control_path

      if (remote-nu-installed $pi_host null $control_path) {
        run-timed "first-time remote nushell bootstrap and SSH key setup" {
          run-first-time-nu-bootstrap $pi_host $app_dir $remote_nu_script $ssh_key_path $control_path
        }
      } else {
        run-timed "first-time remote bootstrap and SSH key setup" {
          run-first-time-bootstrap $pi_host $ssh_key_path $app_dir $remote_prereq_script $remote_nu_script $control_path
        }
      }

      if not (key-auth-works $pi_host $ssh_key_path) {
        error make {msg: $"SSH key setup completed, but key auth still failed for ($pi_host)"}
      }
    } finally {
      close-control-master $pi_host $control_path
      rm --recursive --force $control_dir
    }
  }
}
