#!/usr/bin/env nu

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
const REPO_ROOT = (path self | path dirname | path dirname)

def has-value [value] {
  if $value == null {
    false
  } else {
    (($value | into string | str trim | str length) > 0)
  }
}

def trim-surrounding-quotes [value: string] {
  let trimmed = ($value | str trim)
  let length = ($trimmed | str length)

  if $length < 2 {
    $trimmed
  } else if (($trimmed | str starts-with '"') and ($trimmed | str ends-with '"')) {
    $trimmed | str substring 1..-2
  } else if (($trimmed | str starts-with "'") and ($trimmed | str ends-with "'")) {
    $trimmed | str substring 1..-2
  } else {
    $trimmed
  }
}

def load-dotenv [path: path] {
  if not ($path | path exists) {
    {}
  } else {
    open --raw $path
    | lines
    | reduce -f {} {|line, acc|
        let trimmed = ($line | str trim)

        if (($trimmed | str length) == 0) or ($trimmed | str starts-with "#") or (not ($trimmed | str contains "=")) {
          $acc
        } else {
          let parts = ($trimmed | split row "=")
          let key = ($parts | first | str trim)
          let raw_value = ($parts | skip 1 | str join "=")
          let value = (trim-surrounding-quotes $raw_value)

          if (($key | str length) == 0) {
            $acc
          } else {
            $acc | upsert $key $value
          }
        }
      }
  }
}

def get-config [dotenv: record, key: string, fallback?: any] {
  let env_value = ($env | get -o $key)

  if (has-value $env_value) {
    $env_value
  } else {
    let dotenv_value = ($dotenv | get -o $key)

    if (has-value $dotenv_value) {
      $dotenv_value
    } else {
      $fallback
    }
  }
}

def require-command [name: string] {
  if (which $name | is-empty) {
    error make {msg: $"missing required command: ($name)"}
  }
}

def default-ssh-key-path [] {
  $nu.home-dir | path join ".ssh/ipp-print-orchestrator-pi"
}

def command-exists [name: string] {
  not (which $name | is-empty)
}

def ssh-options [key_path?: any, --batch] {
  let key_options = if (has-value $key_path) {
    ["-i" ($key_path | path expand) "-o" "IdentitiesOnly=yes"]
  } else {
    []
  }
  let batch_options = if $batch {
    ["-o" "BatchMode=yes"]
  } else {
    []
  }

  $key_options | append $batch_options
}

def ssh-args [host: string, key_path?: any, --batch] {
  ["ssh"] | append (ssh-options $key_path --batch=$batch) | append [$host]
}

def run-sudo [args: list<string>] {
  run-external "sudo" ...$args
}

def run-timed [phase: string, action: closure] {
  print $"[(date now | format date "%+")] start ($phase)"
  let elapsed = (timeit { do $action })
  print $"[(date now | format date "%+")] done ($phase) \(($elapsed)\)"
}

def run-ssh-with-input [host: string, key_path: path, input: string, remote_args: list<string>] {
  let command = ((ssh-args $host $key_path --batch) ++ $remote_args)
  $input | run-external ...$command
}

def run-remote-update [host: string, key_path: path, app_dir: string] {
  let remote_script = ($app_dir | path join "scripts/update-pi-packages.nu")
  let remote_args = ["nu" "--no-config-file" $remote_script "--remote-run" "--app-dir" $app_dir]

  run-ssh-with-input $host $key_path "" $remote_args
}

def apt-package-installed [package: string] {
  let result = (^dpkg-query -W "-f=${Status}" $package | complete)
  ($result.exit_code == 0) and ($result.stdout | str contains "install ok installed")
}

def update-installed-apt-packages [] {
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

def update-bun [] {
  if (command-exists bun) {
    ^bun upgrade
  } else {
    print "bun is not installed; skipping bun upgrade"
  }
}

def dependency-manifest-paths [] {
  [
    "package.json"
    "bun.lock"
    "apps/agent/package.json"
    "packages/ipp/package.json"
    "packages/shared/package.json"
    "packages/testkit/package.json"
  ]
}

def production-install-stamp-path [] {
  ".ipp-orch-production-install.sha256"
}

def production-install-fingerprint [] {
  dependency-manifest-paths
  | where {|path| $path | path exists}
  | each {|path|
      {
        path: $path
        sha256: (open --raw $path | hash sha256)
      }
    }
  | to json -r
  | hash sha256
}

def update-production-dependencies [app_dir: string] {
  if not ($app_dir | path exists) {
    error make {msg: $"app directory does not exist: ($app_dir)"}
  }
  if not (command-exists bun) {
    print "bun is not installed; skipping production dependency update"
    return
  }

  cd $app_dir
  ^bun install --frozen-lockfile --ignore-scripts --production
  production-install-fingerprint | save --force (production-install-stamp-path)
}

def local-main [] {
  let dotenv = (load-dotenv ($REPO_ROOT | path join ".env"))
  let pi_host = (get-config $dotenv PI_HOST "pi@print-server.local")
  let app_dir = (get-config $dotenv APP_DIR "/home/pi/apps/ipp-print-orchestrator")
  let ssh_key_path = ((get-config $dotenv PI_SSH_KEY_PATH (default-ssh-key-path)) | path expand)

  require-command ssh

  run-timed "remote package/dependency update" {
    run-remote-update $pi_host $ssh_key_path $app_dir
  }
}

def remote-main [app_dir: string] {
  run-timed "update apt packages" {
    update-installed-apt-packages
  }

  run-timed "update bun runtime" {
    update-bun
  }

  run-timed "update production dependencies" {
    update-production-dependencies $app_dir
  }
}

def main [
  --remote-run
  --app-dir: string = "/home/pi/apps/ipp-print-orchestrator"
] {
  if $remote_run {
    remote-main $app_dir
  } else {
    local-main
  }
}
