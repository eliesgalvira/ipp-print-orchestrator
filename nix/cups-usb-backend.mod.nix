{ self, ... }:
{
  perSystem =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    {
      packages.cups-usb-backend = pkgs.callPackage (
        {
          coreutils,
          dash,
          gnused,
          lib,
          stdenvNoCC,
        }:
        let
          inherit (lib.strings) escapeShellArg makeBinPath;
        in
        stdenvNoCC.mkDerivation {
          pname = "ipp-orch-cups-usb-backend";
          version = "0.1.0";

          src = self;

          dontUnpack = true;
          dontBuild = true;

          installPhase = /* bash */ ''
            runHook preInstall

            install -D --mode=755 "$src/scripts/cups/backend/ipp-orch-usb" "$out/libexec/ipp-orch-usb"
            substituteInPlace "$out/libexec/ipp-orch-usb" \
              --replace-fail "#!/bin/sh" ${escapeShellArg "#!${dash}/bin/dash"} \
              --replace-fail "set -u" ${escapeShellArg ''
                set -u
                PATH=${
                  makeBinPath [
                    coreutils
                    gnused
                  ]
                }:$PATH
                export PATH
              ''}

            install -D --mode=755 "$out/libexec/ipp-orch-usb" "$out/lib/cups/backend/ipp-orch-usb"

            runHook postInstall
          '';

          meta = {
            description = "CUPS USB backend wrapper for supervised HP USB printing";
            platforms = lib.platforms.linux;
          };
        }
      ) { };

      checks.cups-usb-backend = config.packages.cups-usb-backend;

      checks.cups-usb-backend-runtime =
        pkgs.runCommand "ipp-orch-cups-usb-backend-runtime-check"
          {
            nativeBuildInputs = [
              pkgs.coreutils
              pkgs.gnugrep
            ];
          }
          /* bash */ ''
            backend="${config.packages.cups-usb-backend}/lib/cups/backend/ipp-orch-usb"

            test -x "$backend"
            head --lines=1 "$backend" | grep --fixed-strings "#!${pkgs.dash}/bin/dash"
            grep --fixed-strings "PATH=${pkgs.coreutils}/bin:${pkgs.gnused}/bin:" "$backend"

            touch "$out"
          '';
    };
}
