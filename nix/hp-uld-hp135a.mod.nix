{
  perSystem =
    {
      config,
      lib,
      pkgs,
      ...
    }:
    let
      inherit (lib.lists) singleton;
    in
    {
      packages.hp-uld-hp135a = pkgs.callPackage (
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
          inherit (lib.attrsets) getLib;
          inherit (lib.lists) zipListsWith;
          inherit (lib.strings)
            concatMapStringsSep
            concatStringsSep
            escapeShellArg
            makeLibraryPath
            ;

          hpRasterFilterLine = ''*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"'';
          pdfPreflightFilterLine = ''*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"'';
          standard600DpiLine = ''*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"'';
          standardSafe300DpiLine = ''*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"'';
          skipBlankPagesDefaultLine = "*DefaultJCLSkipBlankPages: False";
          safeSkipBlankPagesDefaultLine = "*DefaultJCLSkipBlankPages: True";
          letterDefaults = [
            "*DefaultPageSize: Letter"
            "*DefaultPageRegion: Letter"
            "*DefaultImageableArea: Letter"
            "*DefaultPaperDimension: Letter"
          ];
          a4Defaults = [
            "*DefaultPageSize: A4"
            "*DefaultPageRegion: A4"
            "*DefaultImageableArea: A4"
            "*DefaultPaperDimension: A4"
          ];

          cupsFilterReplacement = escapeShellArg (
            concatStringsSep "\n" [
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

          libraryPath = makeLibraryPath [
            (getLib cups)
            stdenv.cc.cc.lib
          ];

          grepAll =
            lines:
            concatMapStringsSep "\n" (line: "grep --fixed-strings ${escapeShellArg line} \"$ppd\"") lines;
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
            (getLib cups)
            stdenv.cc.cc.lib
          ];

          dontBuild = true;

          installPhase = /* bash */ ''
            runHook preInstall

            mkdir --parents \
              "$out/lib/cups/filter" \
              "$out/lib/smfp" \
              "$out/libexec/hp-uld" \
              "$out/share/ppd/uld-hp"

            install -D --mode=755 "${arch}/rastertospl" "$out/libexec/hp-uld/rastertospl"
            install -D --mode=755 "${arch}/pstosecps" "$out/libexec/hp-uld/pstosecps"
            install -D --mode=755 "${arch}/libscmssc.so" "$out/lib/smfp/libscmssc.so"

            ppd="$out/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd"
            cp "noarch/share/ppd/HP_Laser_MFP_13x_Series.ppd" "$ppd"

            ${grepAll (
              [
                ''*ColorModel Gray/Grayscale: "<</cupsColorSpace 0 /cupsBitsPerColor 8>>setpagedevice"''
                hpRasterFilterLine
                standard600DpiLine
                skipBlankPagesDefaultLine
              ]
              ++ letterDefaults
            )}

            substituteInPlace "$ppd" \
              --replace-fail ${escapeShellArg hpRasterFilterLine} ${cupsFilterReplacement} \
              --replace-fail ${escapeShellArg standard600DpiLine} ${escapeShellArg standardSafe300DpiLine} \
              --replace-fail ${escapeShellArg skipBlankPagesDefaultLine} ${escapeShellArg safeSkipBlankPagesDefaultLine} \
              ${concatMapStringsSep " \\\n      " (
                pair: "--replace-fail ${escapeShellArg pair.from} ${escapeShellArg pair.to}"
              ) (zipListsWith (from: to: { inherit from to; }) letterDefaults a4Defaults)}

            ${grepAll (
              [
                pdfPreflightFilterLine
                standardSafe300DpiLine
                safeSkipBlankPagesDefaultLine
              ]
              ++ a4Defaults
            )}

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
      ) { };

      checks.hp-uld-hp135a = config.packages.hp-uld-hp135a;

      checks.hp-uld-hp135a-ppd =
        pkgs.runCommand "hp-uld-hp135a-ppd-check"
          {
            nativeBuildInputs = singleton pkgs.gnugrep;
          }
          /* bash */ ''
            ppd="${config.packages.hp-uld-hp135a}/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd"

            grep --fixed-strings '*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"' "$ppd"
            grep --fixed-strings '*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"' "$ppd"
            grep --fixed-strings '*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"' "$ppd"
            grep --fixed-strings '*DefaultJCLSkipBlankPages: True' "$ppd"
            grep --fixed-strings '*DefaultPageSize: A4' "$ppd"
            grep --fixed-strings '*DefaultPageRegion: A4' "$ppd"
            grep --fixed-strings '*DefaultImageableArea: A4' "$ppd"
            grep --fixed-strings '*DefaultPaperDimension: A4' "$ppd"

            if grep --fixed-strings '*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"' "$ppd"; then
              echo "unsafe 600dpi default survived HP ULD PPD patch" >&2
              exit 1
            fi

            if grep --fixed-strings '*DefaultJCLSkipBlankPages: False' "$ppd"; then
              echo "unsafe blank-page printing default survived HP ULD PPD patch" >&2
              exit 1
            fi

            if grep --extended-regexp '^\*Default(PageSize|PageRegion|ImageableArea|PaperDimension): Letter$' "$ppd"; then
              echo "Letter survived as a PPD paper default" >&2
              exit 1
            fi

            touch "$out"
          '';
    };
}
