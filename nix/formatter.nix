{ pkgs }:

pkgs.writeTextFile {
  name = "ipp-print-orchestrator-format";
  destination = "/bin/ipp-print-orchestrator-format";
  executable = true;
  text = ''
    #!${pkgs.nushell}/bin/nu

    def main [...paths: string] {
      let targets = if ($paths | is-empty) {
        glob **/*.nix
        | where {|path|
          not (
            ($path | str starts-with ".git/")
            or ($path | str starts-with "node_modules/")
            or ($path | str starts-with "result/")
          )
        }
      } else {
        $paths
      }

      if ($targets | is-empty) {
        return
      }

      ^${pkgs.nixfmt}/bin/nixfmt ...$targets
    }
  '';
}
