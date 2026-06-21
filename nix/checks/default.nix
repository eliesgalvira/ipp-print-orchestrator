{
  pkgs,
  src,
  packages,
  nixosModule,
}:

let
  nixosEvalFor =
    serviceConfig:
    import "${pkgs.path}/nixos/lib/eval-config.nix" {
      pkgs = pkgs;
      system = pkgs.stdenv.hostPlatform.system;
      modules = [
        nixosModule
        (
          { ... }:
          {
            system.stateVersion = "26.05";
            services.ippPrintOrchestrator = serviceConfig;
          }
        )
      ];
    };

  baseModuleConfig = {
    enable = true;
    package = packages.ipp-print-orchestrator;
    hpDriverPackage = packages.hp-uld-hp135a;
    cupsUsbBackendPackage = packages.cups-usb-backend;

    printer = {
      queueName = "HP135a";
      enablePrinting = true;
      advertise = true;
    };

    observability = {
      enableOtlp = true;
      tracesEndpoint = "https://example.invalid/v1/traces";
      logsEndpoint = "https://example.invalid/v1/logs";
      tracesHeaders = "authorization=Bearer test,x-axiom-dataset=ipp-print-traces";
      logsHeaders = "authorization=Bearer test,x-axiom-dataset=ipp-print-logs";
    };
  };

  nixosEval = nixosEvalFor baseModuleConfig;

  service = nixosEval.config.systemd.services.ipp-print-orchestrator;
  heartbeat = nixosEval.config.systemd.services.ipp-print-orchestrator-heartbeat;

  unsafePrintingEval = builtins.tryEval (
    (nixosEvalFor (
      baseModuleConfig
      // {
        printer = {
          queueName = "HP135a";
          enablePrinting = true;
          advertise = false;
        };
      }
    )).config.system.build.toplevel.drvPath
  );

  unsafeOtlpEval = builtins.tryEval (
    (nixosEvalFor (
      baseModuleConfig
      // {
        observability = {
          enableOtlp = true;
          tracesEndpoint = null;
          logsEndpoint = "https://example.invalid/v1/logs";
          tracesHeaders = null;
          logsHeaders = "authorization=Bearer test,x-axiom-dataset=ipp-print-logs";
        };
      }
    )).config.system.build.toplevel.drvPath
  );
in
{
  hp-uld-hp135a = packages.hp-uld-hp135a;

  cups-usb-backend = packages.cups-usb-backend;

  cups-usb-backend-runtime =
    pkgs.runCommand "ipp-orch-cups-usb-backend-runtime-check"
      {
        nativeBuildInputs = [
          pkgs.coreutils
          pkgs.gnugrep
        ];
      }
      ''
        backend="${packages.cups-usb-backend}/lib/cups/backend/ipp-orch-usb"

        test -x "$backend"
        head -n 1 "$backend" | grep -F "#!${pkgs.dash}/bin/dash"
        grep -F "PATH=${pkgs.coreutils}/bin:${pkgs.gnused}/bin:" "$backend"

        touch "$out"
      '';

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
        grep -F '*DefaultJCLSkipBlankPages: True' "$ppd"

        if grep -F '*Quality 600dpi/Standard: "<</HWResolution[600 600]>>setpagedevice"' "$ppd"; then
          echo "unsafe 600dpi default survived HP ULD PPD patch" >&2
          exit 1
        fi

        if grep -F '*DefaultJCLSkipBlankPages: False' "$ppd"; then
          echo "unsafe blank-page printing default survived HP ULD PPD patch" >&2
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

  nixos-module =
    pkgs.runCommand "ipp-print-orchestrator-nixos-module-check"
      {
        serviceExec = service.serviceConfig.ExecStart;
        serviceOtlp = service.environment.IPP_ORCH_ENABLE_OTLP;
        serviceQueue = service.environment.IPP_ORCH_PRINTER_NAME;
        heartbeatExec = heartbeat.serviceConfig.ExecStart;
        unsafePrintingAccepted = if unsafePrintingEval.success then "true" else "false";
        unsafeOtlpAccepted = if unsafeOtlpEval.success then "true" else "false";
      }
      ''
        case "$serviceExec" in
          /nix/store/*/bin/ipp-print-orchestrator-agent) ;;
          *)
            echo "service ExecStart does not use the packaged store wrapper: $serviceExec" >&2
            exit 1
            ;;
        esac

        test "$serviceOtlp" = true
        test "$serviceQueue" = HP135a
        test "$unsafePrintingAccepted" = false
        test "$unsafeOtlpAccepted" = false

        case "$heartbeatExec" in
          /nix/store/*/bin/curl\ --fail\ --silent\ http://127.0.0.1:4310/v1/health) ;;
          *)
            echo "heartbeat ExecStart does not use store curl and expected health URL: $heartbeatExec" >&2
            exit 1
            ;;
        esac

        touch "$out"
      '';
}
