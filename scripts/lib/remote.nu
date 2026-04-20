use env.nu has-value

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
  --batch
  --tty
] {
  let tty_options = if $tty { ["-t"] } else { [] }
  ["ssh"] | append (ssh-options $key_path --batch=$batch) | append $tty_options | append [$host]
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

export def run-timed [phase: string, action: closure] {
  let started_at = (date now)
  print $"[($started_at | format date "%+")] start ($phase)"
  let elapsed = (timeit { do $action })
  print $"[(date now | format date "%+")] done ($phase) \(($elapsed)\)"
}
