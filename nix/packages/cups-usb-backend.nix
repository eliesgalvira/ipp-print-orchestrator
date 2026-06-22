{
  coreutils,
  dash,
  gnused,
  lib,
  src,
  stdenvNoCC,
}:

stdenvNoCC.mkDerivation {
  pname = "ipp-orch-cups-usb-backend";
  version = "0.1.0";

  inherit src;

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 "${src}/scripts/cups/backend/ipp-orch-usb" "$out/libexec/ipp-orch-usb"
    substituteInPlace "$out/libexec/ipp-orch-usb" \
      --replace-fail "#!/bin/sh" ${lib.escapeShellArg "#!${dash}/bin/dash"} \
      --replace-fail "set -u" ${lib.escapeShellArg ''
        set -u
        PATH=${
          lib.makeBinPath [
            coreutils
            gnused
          ]
        }:$PATH
        export PATH
      ''}

    install -Dm755 "$out/libexec/ipp-orch-usb" "$out/lib/cups/backend/ipp-orch-usb"

    runHook postInstall
  '';

  meta = {
    description = "CUPS USB backend wrapper for supervised HP USB printing";
    platforms = lib.platforms.linux;
  };
}
