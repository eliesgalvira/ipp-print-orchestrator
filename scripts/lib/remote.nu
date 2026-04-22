use env.nu [get-config has-value]

export def default-ssh-key-path []: nothing -> string {
  $nu.home-dir | path join ".ssh/ipp-print-orchestrator-pi"
}

export def remote-target [dotenv: record]: nothing -> record<host: string, key_path: string> {
  {
    host: (get-config $dotenv PI_HOST "pi@print-server.local")
    key_path: ((get-config $dotenv PI_SSH_KEY_PATH (default-ssh-key-path)) | path expand)
  }
}

export def ssh-options [
  --key-path: path
  --batch
] : nothing -> list<string> {
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

export def ssh-args [
  host: string
  --key-path: path
  --control-path: path
  --batch
  --tty
] : nothing -> list<string> {
  let tty_options = if $tty { ["-t"] } else { [] }
  let control_options = if (has-value $control_path) { ["-S" $control_path] } else { [] }
  ["ssh"] | append (ssh-options --key-path=$key_path --batch=$batch) | append $tty_options | append $control_options | append [$host]
}

def shell-quote [value: string]: nothing -> string {
  "'" + (($value | into string) | str replace --all "'" "'\\''") + "'"
}

export def ssh-rsh-command [
  --key-path: path
  --batch
] : nothing -> string {
  ["ssh"] | append (ssh-options --key-path=$key_path --batch=$batch) | each {|part| shell-quote $part} | str join " "
}

export def rsync-args [
  --key-path: path
  --batch
] : nothing -> list<string> {
  if $batch or (has-value $key_path) {
    ["rsync" "-e" (ssh-rsh-command --key-path=$key_path --batch=$batch)]
  } else {
    ["rsync"]
  }
}

export def run-sudo [args: list<string>]: nothing -> any {
  run-external "sudo" ...$args
}

export def run-with-retries [
  phase: string
  action: closure
  --attempts: int = 3
  --delay: duration = 2sec
]: nothing -> nothing {
  for attempt in 1..$attempts {
    try {
      do $action
      return
    } catch {|err|
      if $attempt >= $attempts {
        error make $err
      }

      print $"[(date now | format date "%+")] retry ($phase) after attempt ($attempt)/($attempts) failed: ($err.msg)"
      sleep $delay
    }
  }
}

export def --env ensure-user-bun-on-path []: nothing -> nothing {
  let bun_bin = ($nu.home-dir | path join ".bun/bin")
  if (($env.PATH | describe) =~ "^list") {
    $env.PATH = ([$bun_bin] ++ $env.PATH)
  } else {
    $env.PATH = $"($bun_bin):($env.PATH)"
  }
}

export def run-ssh [
  host: string
  remote_args: list<string>
  --key-path: path
  --control-path: path
  --batch
  --tty
] : nothing -> any {
  let remote_command = ($remote_args | each {|part| shell-quote $part} | str join " ")
  let command = ((ssh-args $host --key-path=$key_path --control-path=$control_path --batch=$batch --tty=$tty) ++ [$remote_command])
  run-external ...$command
}

export def run-ssh-with-input [
  host: string
  input: string
  remote_args: list<string>
  --key-path: path
  --control-path: path
  --batch
  --tty
] : nothing -> any {
  let remote_command = ($remote_args | each {|part| shell-quote $part} | str join " ")
  let command = ((ssh-args $host --key-path=$key_path --control-path=$control_path --batch=$batch --tty=$tty) ++ [$remote_command])
  $input | run-external ...$command
}

export def run-remote-nu-command [
  host: string
  command: string
  --key-path: path
  --control-path: path
  --batch
  --tty
] : nothing -> any {
  run-ssh $host ["nu" "-c" $command] --key-path=$key_path --control-path=$control_path --batch=$batch --tty=$tty
}

export def run-remote-nu-source [
  host: string
  script: string
  --key-path: path
  --control-path: path
  --batch
  --tty
] : nothing -> any {
  run-ssh-with-input $host $script ["nu" "--no-config-file" "-c" "source /dev/stdin"] --key-path=$key_path --control-path=$control_path --batch=$batch --tty=$tty
}

export def run-timed [phase: string, action: closure]: nothing -> nothing {
  let started_at = (date now)
  print $"[($started_at | format date "%+")] start ($phase)"
  let elapsed = (timeit { do $action })
  print $"[(date now | format date "%+")] done ($phase) \(($elapsed)\)"
}
