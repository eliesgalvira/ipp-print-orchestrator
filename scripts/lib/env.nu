export def has-value [value] {
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

export def load-dotenv [path: path] {
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

export def get-config [dotenv: record, key: string, fallback?: any] {
  let env_value = ($env | get -o $key)

  if $env_value != null {
    $env_value
  } else {
    let dotenv_value = ($dotenv | get -o $key)

    if $dotenv_value != null {
      $dotenv_value
    } else {
      $fallback
    }
  }
}

export def required-secret [dotenv: record, keys: list<string>] {
  $keys
  | each {|key| get-config $dotenv $key null}
  | where {|value| has-value $value}
  | first
  | default null
}
