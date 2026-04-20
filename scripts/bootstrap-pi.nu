#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu [ssh-args run-timed]
use lib/repo.nu repo-root

def require-command [name: string] {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def default-ssh-key-path [] {
  $nu.home-dir | path join ".ssh/ipp-print-orchestrator-pi"
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
  let command = ((ssh-args $host $key_path --batch) ++ ["true"])
  let result = (run-external ...$command | complete)
  $result.exit_code == 0
}

def run-ssh-with-input [
  host: string
  key_path: path
  input: string
  remote_args: list<string>
  --batch
  --tty
] {
  let command = ((ssh-args $host $key_path --batch=$batch --tty=$tty) ++ $remote_args)
  $input | run-external ...$command
}

def run-remote-prereqs [host: string, key_path: path, sudo_password: any, script: string] {
  let has_sudo_password = if (has-value $sudo_password) { "1" } else { "0" }
  let remote_args = if (has-value $sudo_password) {
    [
      "bash"
      "-c"
      "IFS= read -r SUDO_PASSWORD_FROM_STDIN; export SUDO_PASSWORD_FROM_STDIN; bash -s -- \"$@\""
      "bootstrap-prereqs"
      $has_sudo_password
      $host
    ]
  } else {
    ["bash" "-s" "--" $has_sudo_password $host]
  }
  let payload = if (has-value $sudo_password) {
    (($sudo_password | into string) + "\n" + $script)
  } else {
    $script
  }

  run-ssh-with-input $host $key_path $payload $remote_args --batch
}

def run-remote-nu-bootstrap [host: string, key_path: path, sudo_password: any, app_dir: string, script: string] {
  let remote_args = if (has-value $sudo_password) {
    [
      "bash"
      "-c"
      "IFS= read -r SUDO_PASSWORD_FROM_STDIN; export SUDO_PASSWORD_FROM_STDIN; tmp_script=$(mktemp); cat > \"$tmp_script\"; nu --no-config-file \"$tmp_script\" \"$@\"; status=$?; rm -f \"$tmp_script\"; exit \"$status\""
      "bootstrap-nu"
      $app_dir
      $host
    ]
  } else {
    [
      "bash"
      "-c"
      "tmp_script=$(mktemp); cat > \"$tmp_script\"; nu --no-config-file \"$tmp_script\" \"$@\"; status=$?; rm -f \"$tmp_script\"; exit \"$status\""
      "bootstrap-nu"
      $app_dir
      $host
    ]
  }
  let payload = if (has-value $sudo_password) {
    (($sudo_password | into string) + "\n" + $script)
  } else {
    $script
  }

  run-ssh-with-input $host $key_path $payload $remote_args --batch
}

def first-time-wrapper-script [remote_prereq_script: string, remote_nu_script: string, public_key: string] {
  $'
set -euo pipefail

APP_DIR="$1"
PI_HOST_LABEL="$2"
HAS_SUDO_PASSWORD="$3"
SUDO_PASSWORD=""

if [ "$HAS_SUDO_PASSWORD" = "1" ]; then
  SUDO_PASSWORD="${SUDO_PASSWORD_FROM_STDIN:-}"
fi

export SUDO_PASSWORD_FROM_STDIN="$SUDO_PASSWORD"

bash -s -- "$HAS_SUDO_PASSWORD" "$PI_HOST_LABEL" <<'\''IPP_BOOTSTRAP_PREREQS'\''
($remote_prereq_script)
IPP_BOOTSTRAP_PREREQS

tmp_script="$(mktemp)"
tmp_key="$(mktemp)"
cleanup() {
  rm -f "$tmp_script" "$tmp_key"
}
trap cleanup EXIT

cat > "$tmp_script" <<'\''IPP_REMOTE_NU_BOOTSTRAP'\''
($remote_nu_script)
IPP_REMOTE_NU_BOOTSTRAP

cat > "$tmp_key" <<'\''IPP_AUTHORIZED_KEY'\''
($public_key)
IPP_AUTHORIZED_KEY

nu --no-config-file "$tmp_script" "$APP_DIR" "$PI_HOST_LABEL" --authorized-key-file "$tmp_key"
'
}

def run-first-time-bootstrap [
  host: string
  key_path: path
  sudo_password: any
  app_dir: string
  remote_prereq_script: string
  remote_nu_script: string
] {
  let public_key = (open --raw (public-key-path $key_path) | str trim)
  let script = (first-time-wrapper-script $remote_prereq_script $remote_nu_script $public_key)
  let has_sudo_password = if (has-value $sudo_password) { "1" } else { "0" }
  let remote_args = if (has-value $sudo_password) {
    [
      "bash"
      "-c"
      "IFS= read -r SUDO_PASSWORD_FROM_STDIN; export SUDO_PASSWORD_FROM_STDIN; bash -s -- \"$@\""
      "bootstrap-first-time"
      $app_dir
      $host
      $has_sudo_password
    ]
  } else {
    ["bash" "-s" "--" $app_dir $host $has_sudo_password]
  }
  let payload = if (has-value $sudo_password) {
    (($sudo_password | into string) + "\n" + $script)
  } else {
    $script
  }

  print $"SSH key auth is not configured for ($host). Enter the Pi SSH password when OpenSSH prompts."
  run-ssh-with-input $host $key_path $payload $remote_args
}

def main [] {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let pi_host = (get-config $dotenv PI_HOST "pi@print-server.local")
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let ssh_key_path = (ensure-local-ssh-key (get-config $dotenv PI_SSH_KEY_PATH (default-ssh-key-path)))
  let sudo_password = (required-secret $dotenv [PI_SUDO_PASSWORD PI_PASSWORD])

  require-command ssh
  require-command ssh-keygen

  let remote_prereq_script = '
set -euo pipefail

HAS_SUDO_PASSWORD="$1"
PI_HOST_LABEL="$2"
SUDO_PASSWORD=""

if [ "$HAS_SUDO_PASSWORD" = "1" ]; then
  SUDO_PASSWORD="${SUDO_PASSWORD_FROM_STDIN:-}"
fi

run_sudo() {
  if [ -n "$SUDO_PASSWORD" ]; then
    printf "%s\n" "$SUDO_PASSWORD" | sudo -S -p "" "$@"
  else
    sudo "$@"
  fi
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
    run-timed "remote bootstrap prerequisites" {
      run-remote-prereqs $pi_host $ssh_key_path $sudo_password $remote_prereq_script
    }

    run-timed "remote nushell bootstrap" {
      run-remote-nu-bootstrap $pi_host $ssh_key_path $sudo_password $app_dir $remote_nu_script
    }
  } else {
    run-timed "first-time remote bootstrap and SSH key setup" {
      run-first-time-bootstrap $pi_host $ssh_key_path $sudo_password $app_dir $remote_prereq_script $remote_nu_script
    }

    if not (key-auth-works $pi_host $ssh_key_path) {
      error make {msg: $"SSH key setup completed, but key auth still failed for ($pi_host)"}
    }
  }
}
