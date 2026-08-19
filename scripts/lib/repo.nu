const REPO_ROOT = (path self | path dirname | path dirname | path dirname)

export def repo-root []: nothing -> string {
  $REPO_ROOT
}

export def source-installable [source_dir: string, installable: string]: nothing -> string {
  if ($installable | str starts-with ".#") {
    $"path:($source_dir)#($installable | str substring 2..)"
  } else {
    $installable
  }
}

export def deploy-excludes []: nothing -> list<string> {
  [
    "node_modules"
    "result"
    "result-*"
    ".git"
    ".direnv"
    ".env"
    "coverage"
    ".reference"
    "data"
  ]
}
