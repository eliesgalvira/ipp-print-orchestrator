#!/usr/bin/env nu

use lib/env.nu *
use lib/remote.nu ssh-args
use lib/repo.nu repo-root

def require-command [name: string] {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def run-ssh-with-input [host: string, ssh_password: any, input: string, remote_args: list<string>] {
  let command = ((ssh-args $host $ssh_password) ++ $remote_args)

  if (has-value $ssh_password) {
    $input | with-env {SSHPASS: $ssh_password} {
      run-external ...$command
    }
  } else {
    $input | run-external ...$command
  }
}

def run-remote-prereqs [host: string, ssh_password: any, sudo_password: any, script: string] {
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

  run-ssh-with-input $host $ssh_password $payload $remote_args
}

def run-remote-nu-bootstrap [host: string, ssh_password: any, sudo_password: any, app_dir: string, script: string] {
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

  run-ssh-with-input $host $ssh_password $payload $remote_args
}

def main [] {
  let root_dir = (repo-root)
  let dotenv = (load-dotenv ($root_dir | path join ".env"))
  let pi_host = (get-config $dotenv PI_HOST "pi@print-server.local")
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let ssh_password = (required-secret $dotenv [PI_SSH_PASSWORD PI_PASSWORD])
  let sudo_password = (required-secret $dotenv [PI_SUDO_PASSWORD PI_PASSWORD])

  require-command ssh
  if (has-value $ssh_password) {
    require-command sshpass
  }

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

if command -v apt-get >/dev/null 2>&1; then
  run_sudo apt-get update
  run_sudo apt-get install -y curl ca-certificates gnupg
else
  echo "Unsupported package manager on target machine. Install curl, ca-certificates, gnupg, and nushell manually." >&2
  exit 1
fi

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

  run-remote-prereqs $pi_host $ssh_password $sudo_password $remote_prereq_script
  run-remote-nu-bootstrap $pi_host $ssh_password $sudo_password $app_dir $remote_nu_script
}
