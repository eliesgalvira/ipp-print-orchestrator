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
        grep -F '*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"' "$ppd"
        grep -F '*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"' "$ppd"

        substituteInPlace "$ppd" \
          --replace-fail '*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"' '*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"
    *cupsFilter:  "application/vnd.cups-raster 0 rastertospl"' \
          --replace-fail '*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"' '*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"'

        grep -F '*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"' "$ppd"
        grep -F '*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"' "$ppd"

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
