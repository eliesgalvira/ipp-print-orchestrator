{ self, ... }:
{
  perSystem =
    { lib, pkgs, ... }:
    let
      inherit (lib.filesystem) listFilesRecursive;
      inherit (lib.lists) filter singleton;
      inherit (lib.strings) escapeShellArgs hasSuffix;

      nixFiles = listFilesRecursive self |> filter (hasSuffix ".nix");
    in
    {
      formatter = pkgs.nixfmt-tree;

      checks.nix-format =
        pkgs.runCommand "ipp-print-orchestrator-nix-format-check"
          {
            nativeBuildInputs = singleton pkgs.nixfmt;
          }
          /* bash */ ''
            nixfmt --check ${escapeShellArgs nixFiles}

            touch "$out"
          '';
    };
}
