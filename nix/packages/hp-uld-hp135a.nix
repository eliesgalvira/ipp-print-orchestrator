{
  autoPatchelfHook,
  cups,
  fetchurl,
  lib,
  makeWrapper,
  stdenv,
  stdenvNoCC,
}:

let
  hpRasterFilterLine = ''*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"'';
  pdfPreflightFilterLine = ''*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"'';
  standard600DpiLine = ''*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"'';
  standardSafe300DpiLine = ''*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"'';
  skipBlankPagesDefaultLine = "*DefaultJCLSkipBlankPages: False";
  safeSkipBlankPagesDefaultLine = "*DefaultJCLSkipBlankPages: True";

  cupsFilterReplacement = lib.escapeShellArg (
    lib.concatStringsSep "\n" [
      pdfPreflightFilterLine
      hpRasterFilterLine
    ]
  );

  arch =
    if stdenv.hostPlatform.system == "aarch64-linux" then
      "aarch64"
    else if stdenv.hostPlatform.system == "x86_64-linux" then
      "x86_64"
    else
      throw "unsupported HP ULD platform: ${stdenv.hostPlatform.system}";

  libraryPath = lib.makeLibraryPath [
    (lib.getLib cups)
    stdenv.cc.cc.lib
  ];
in
stdenvNoCC.mkDerivation {
  pname = "hp-uld-hp135a";
  version = "1.00.39.12-00.15";

  src = fetchurl {
    url = "https://ftp.hp.com/pub/softlib/software13/printers/CLP150/uld-hp_V1.00.39.12_00.15.tar.gz";
    hash = "sha256-zrube2El50BmNLucKpiwFHfR4R1mx8kEdGad6ZJ7yR0=";
  };

  nativeBuildInputs = [
    autoPatchelfHook
    makeWrapper
  ];

  buildInputs = [
    (lib.getLib cups)
    stdenv.cc.cc.lib
  ];

  dontBuild = true;

  installPhase = ''
    runHook preInstall

    mkdir -p \
      "$out/lib/cups/filter" \
      "$out/lib/smfp" \
      "$out/libexec/hp-uld" \
      "$out/share/ppd/uld-hp"

    install -Dm755 "${arch}/rastertospl" "$out/libexec/hp-uld/rastertospl"
    install -Dm755 "${arch}/pstosecps" "$out/libexec/hp-uld/pstosecps"
    install -Dm755 "${arch}/libscmssc.so" "$out/lib/smfp/libscmssc.so"

    ppd="$out/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd"
    cp "noarch/share/ppd/HP_Laser_MFP_13x_Series.ppd" "$ppd"

    grep -F '*ColorModel Gray/Grayscale: "<</cupsColorSpace 0 /cupsBitsPerColor 8>>setpagedevice"' "$ppd"
    grep -F ${lib.escapeShellArg hpRasterFilterLine} "$ppd"
    grep -F ${lib.escapeShellArg standard600DpiLine} "$ppd"
    grep -F ${lib.escapeShellArg skipBlankPagesDefaultLine} "$ppd"

    substituteInPlace "$ppd" \
      --replace-fail ${lib.escapeShellArg hpRasterFilterLine} ${cupsFilterReplacement} \
      --replace-fail ${lib.escapeShellArg standard600DpiLine} ${lib.escapeShellArg standardSafe300DpiLine} \
      --replace-fail ${lib.escapeShellArg skipBlankPagesDefaultLine} ${lib.escapeShellArg safeSkipBlankPagesDefaultLine}

    grep -F ${lib.escapeShellArg pdfPreflightFilterLine} "$ppd"
    grep -F ${lib.escapeShellArg standardSafe300DpiLine} "$ppd"
    grep -F ${lib.escapeShellArg safeSkipBlankPagesDefaultLine} "$ppd"

    makeWrapper "$out/libexec/hp-uld/rastertospl" "$out/lib/cups/filter/rastertospl" \
      --prefix LD_LIBRARY_PATH : "$out/lib/smfp:${libraryPath}"

    makeWrapper "$out/libexec/hp-uld/pstosecps" "$out/lib/cups/filter/pstosecps" \
      --prefix LD_LIBRARY_PATH : "$out/lib/smfp:${libraryPath}"

    runHook postInstall
  '';

  meta = {
    description = "HP Unified Linux Driver package for HP Laser MFP 135a CUPS use";
    homepage = "https://support.hp.com/";
    license = lib.licenses.unfreeRedistributable;
    platforms = [
      "x86_64-linux"
      "aarch64-linux"
    ];
  };
}
