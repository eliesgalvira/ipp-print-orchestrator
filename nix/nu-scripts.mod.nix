{ self, ... }:
{
  perSystem =
    { pkgs, ... }:
    {
      checks.nu-scripts =
        pkgs.runCommand "ipp-print-orchestrator-nu-scripts-check"
          {
            nativeBuildInputs = [
              pkgs.bash
              pkgs.coreutils
              pkgs.nushell
              pkgs.openssl
            ];
          }
          /* bash */ ''
            cp --recursive ${self} source
            chmod --recursive u+w source
            cd source

            nu --no-config-file scripts/tests.nu

            touch "$out"
          '';
    };
}
