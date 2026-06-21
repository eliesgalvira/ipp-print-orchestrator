{
  pkgs,
  src,
  packages,
}:

{
  hp-uld-hp135a = packages.hp-uld-hp135a;

  cups-usb-backend = packages.cups-usb-backend;

  ipp-print-orchestrator = packages.ipp-print-orchestrator;

  ipp-print-orchestrator-js =
    pkgs.runCommand "ipp-print-orchestrator-js-check"
      {
        nativeBuildInputs = [
          pkgs.coreutils
          pkgs.gnugrep
          pkgs.nodejs-slim
        ];
      }
      ''
        service="${packages.ipp-print-orchestrator}/share/ipp-print-orchestrator/service/main.js"
        filter="${packages.ipp-print-orchestrator}/libexec/ipp-print-orchestrator/cups-pdf-preflight-filter.js"
        js_root="${packages.ipp-print-orchestrator}/share/ipp-print-orchestrator/service ${packages.ipp-print-orchestrator}/libexec/ipp-print-orchestrator"

        test -r "$service"
        test -r "$filter"
        test -x "${packages.ipp-print-orchestrator}/bin/ipp-print-orchestrator-agent"
        test -x "${packages.ipp-print-orchestrator}/lib/cups/filter/ipp-pdf-preflight-to-spl"

        node --check "$service"
        node --check "$filter"

        if grep -R -n -E "^import .* from \"([^./]|@)" $js_root | grep -v -E "from \"node:"; then
          echo "bundled runtime output contains unresolved static package imports" >&2
          exit 1
        fi

        if grep -R -n -E "import\(\"([^./]|@)" $js_root | grep -v -E "import\(\"(node:|http\"|https\")"; then
          echo "bundled runtime output contains unresolved dynamic package imports" >&2
          exit 1
        fi

        touch "$out"
      '';

  hp-uld-hp135a-ppd =
    pkgs.runCommand "hp-uld-hp135a-ppd-check"
      {
        nativeBuildInputs = [ pkgs.gnugrep ];
      }
      ''
        ppd="${packages.hp-uld-hp135a}/share/ppd/uld-hp/HP_Laser_MFP_13x_Series.ppd"

        grep -F '*cupsFilter: "application/pdf 0 ipp-pdf-preflight-to-spl"' "$ppd"
        grep -F '*cupsFilter:  "application/vnd.cups-raster 0 rastertospl"' "$ppd"
        grep -F '*Quality 600dpi/Standard: "<</HWResolution[300 300]>>setpagedevice"' "$ppd"

        if grep -F '*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"' "$ppd"; then
          echo "unsafe 600dpi default survived HP ULD PPD patch" >&2
          exit 1
        fi

        touch "$out"
      '';

  nu-scripts =
    pkgs.runCommand "ipp-print-orchestrator-nu-scripts-check"
      {
        nativeBuildInputs = [
          pkgs.bash
          pkgs.coreutils
          pkgs.nushell
        ];
      }
      ''
        cp -R ${src} source
        chmod -R u+w source
        cd source

        nu --no-config-file scripts/tests.nu

        touch "$out"
      '';
}
