export def has-value [value: any]: nothing -> bool {
  if $value == null {
    false
  } else {
    (($value | into string | str trim | str length) > 0)
  }
}

def trim-surrounding-quotes [value: string]: nothing -> string {
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

export def load-dotenv [path: path]: nothing -> record {
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

export def get-config [dotenv: record, key: cell-path, fallback: string]: nothing -> string {
  let env_value = ($env | get -o $key)

  if (has-value $env_value) {
    $env_value | into string
  } else {
    let dotenv_value = ($dotenv | get -o $key)

    if (has-value $dotenv_value) {
      $dotenv_value | into string
    } else {
      $fallback
    }
  }
}
