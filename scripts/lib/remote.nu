use env.nu [get-config has-value]

export def default-ssh-key-path [] {
  $nu.home-dir | path join ".ssh/ipp-print-orchestrator-pi"
}

export def remote-target [dotenv: record] {
  {
    host: (get-config $dotenv PI_HOST "pi@print-server.local")
    key_path: ((get-config $dotenv PI_SSH_KEY_PATH (default-ssh-key-path)) | path expand)
  }
}

export def ssh-options [
  key_path?: any
  --batch
] {
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
  key_path?: any
  control_path?: any
  --batch
  --tty
] {
  let tty_options = if $tty { ["-t"] } else { [] }
  let control_options = if (has-value $control_path) { ["-S" $control_path] } else { [] }
  ["ssh"] | append (ssh-options $key_path --batch=$batch) | append $tty_options | append $control_options | append [$host]
}

def shell-quote [value: any] {
  "'" + (($value | into string) | str replace --all "'" "'\\''") + "'"
}

export def ssh-rsh-command [
  key_path?: any
  --batch
] {
  ["ssh"] | append (ssh-options $key_path --batch=$batch) | each {|part| shell-quote $part} | str join " "
}

export def rsync-args [
  key_path?: any
  --batch
] {
  if $batch or (has-value $key_path) {
    ["rsync" "-e" (ssh-rsh-command $key_path --batch=$batch)]
  } else {
    ["rsync"]
  }
}

export def run-sudo [args: list<string>] {
  run-external "sudo" ...$args
}

export def --env ensure-user-bun-on-path [] {
  let bun_bin = ($nu.home-dir | path join ".bun/bin")
  if (($env.PATH | describe) =~ "^list") {
    $env.PATH = ([$bun_bin] ++ $env.PATH)
  } else {
    $env.PATH = $"($bun_bin):($env.PATH)"
  }
}

export def run-ssh [
  host: string
  key_path: any
  remote_args: list<string>
  control_path?: any
  --batch
  --tty
] {
  let remote_command = ($remote_args | each {|part| shell-quote $part} | str join " ")
  let command = ((ssh-args $host $key_path $control_path --batch=$batch --tty=$tty) ++ [$remote_command])
  run-external ...$command
}

export def run-ssh-with-input [
  host: string
  key_path: any
  input: string
  remote_args: list<string>
  control_path?: any
  --batch
  --tty
] {
  let remote_command = ($remote_args | each {|part| shell-quote $part} | str join " ")
  let command = ((ssh-args $host $key_path $control_path --batch=$batch --tty=$tty) ++ [$remote_command])
  $input | run-external ...$command
}

export def run-remote-nu-command [
  host: string
  key_path: any
  command: string
  control_path?: any
  --batch
  --tty
] {
  run-ssh $host $key_path ["nu" "-c" $command] $control_path --batch=$batch --tty=$tty
}

export def run-remote-nu-source [
  host: string
  key_path: any
  script: string
  control_path?: any
  --batch
  --tty
] {
  run-ssh-with-input $host $key_path $script ["nu" "--no-config-file" "-c" "source /dev/stdin"] $control_path --batch=$batch --tty=$tty
}

export def run-timed [phase: string, action: closure] {
  let started_at = (date now)
  print $"[($started_at | format date "%+")] start ($phase)"
  let elapsed = (timeit { do $action })
  print $"[(date now | format date "%+")] done ($phase) \(($elapsed)\)"
}
