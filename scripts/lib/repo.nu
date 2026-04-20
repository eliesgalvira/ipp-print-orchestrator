const REPO_ROOT = (path self | path dirname | path dirname | path dirname)

export def repo-root [] {
  $REPO_ROOT
}

export def deploy-excludes [] {
  [
    "node_modules"
    ".git"
    "coverage"
    ".reference"
    "data"
  ]
}
