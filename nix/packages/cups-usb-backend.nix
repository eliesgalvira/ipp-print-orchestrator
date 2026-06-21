{
  coreutils,
  gnused,
  lib,
  makeWrapper,
  src,
  stdenvNoCC,
}:

stdenvNoCC.mkDerivation {
  pname = "ipp-orch-cups-usb-backend";
  version = "0.1.0";

  inherit src;

  nativeBuildInputs = [ makeWrapper ];

  dontUnpack = true;
  dontBuild = true;

  installPhase = ''
    runHook preInstall

    install -Dm755 "${src}/scripts/cups/backend/ipp-orch-usb" "$out/libexec/ipp-orch-usb"
    patchShebangs "$out/libexec/ipp-orch-usb"

    makeWrapper "$out/libexec/ipp-orch-usb" "$out/lib/cups/backend/ipp-orch-usb" \
      --prefix PATH : "${
        lib.makeBinPath [
          coreutils
          gnused
        ]
      }"

    runHook postInstall
  '';

  meta = {
    description = "CUPS USB backend wrapper for supervised HP USB printing";
    platforms = lib.platforms.linux;
  };
}
