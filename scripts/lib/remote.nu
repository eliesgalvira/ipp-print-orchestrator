use env.nu has-value

export def ssh-args [host: string, password?: any] {
  if (has-value $password) {
    ["sshpass" "-e" "ssh" $host]
  } else {
    ["ssh" $host]
  }
}

export def rsync-args [host: string, password?: any] {
  if (has-value $password) {
    ["sshpass" "-e" "rsync" "-e" "ssh"]
  } else {
    ["rsync"]
  }
}

export def remote-sudo-prefix [sudo_password?: any] {
  if (has-value $sudo_password) {
    ["sudo" "-S" "-p" ""]
  } else {
    ["sudo"]
  }
}

export def run-sudo [sudo_password: any, args: list<string>] {
  if (has-value $sudo_password) {
    (($sudo_password | into string) + "\n") | run-external "sudo" "-S" "-p" "" ...$args
  } else {
    run-external "sudo" ...$args
  }
}

export def run-timed [phase: string, action: closure] {
  let started_at = (date now)
  print $"[($started_at | format date "%+")] start ($phase)"
  do $action
  let elapsed = ((((date now) - $started_at) / 1sec) | math round)
  print $"[(date now | format date "%+")] done ($phase) \(($elapsed)s\)"
}
