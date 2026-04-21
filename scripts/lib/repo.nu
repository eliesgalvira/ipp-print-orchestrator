const REPO_ROOT = (path self | path dirname | path dirname | path dirname)

export def repo-root []: nothing -> string {
  $REPO_ROOT
}

export def deploy-excludes []: nothing -> list<string> {
  [
    "node_modules"
    ".git"
    ".env"
    "coverage"
    ".reference"
    "data"
  ]
}
