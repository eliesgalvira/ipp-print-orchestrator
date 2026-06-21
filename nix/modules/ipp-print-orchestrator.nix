{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.ippPrintOrchestrator;

  inherit (lib)
    literalExpression
    mkEnableOption
    mkIf
    mkMerge
    mkOption
    types
    ;

  nonEmptyString =
    description:
    types.addCheck types.str (value: (builtins.stringLength value) > 0)
    // {
      description = "${description} (non-empty string)";
    };

  environment = {
    IPP_ORCH_DATA_DIR = cfg.dataDir;
    IPP_ORCH_PRINTER_NAME = cfg.printer.queueName;
    IPP_ORCH_BIND_HOST = cfg.bind.host;
    IPP_ORCH_BIND_PORT = toString cfg.bind.port;
    IPP_ORCH_USB_SYSFS_ROOT = cfg.usbSysfsRoot;
    IPP_ORCH_STATUS_OBSERVATION_INTERVAL_MS = toString cfg.statusObservationIntervalMs;
    IPP_ORCH_HEARTBEAT_INTERVAL_MS = toString cfg.heartbeatIntervalMs;
    IPP_ORCH_RECONCILE_INTERVAL_MS = toString cfg.reconcileIntervalMs;
    IPP_ORCH_LOG_PRETTY = if cfg.logPretty then "true" else "false";
    IPP_ORCH_ENABLE_OTLP = if cfg.observability.enableOtlp then "true" else "false";
    OTEL_RESOURCE_ATTRIBUTES = cfg.observability.resourceAttributes;
  }
  // lib.optionalAttrs (cfg.observability.tracesEndpoint != null) {
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = cfg.observability.tracesEndpoint;
  }
  // lib.optionalAttrs (cfg.observability.logsEndpoint != null) {
    OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = cfg.observability.logsEndpoint;
  }
  // lib.optionalAttrs (cfg.observability.tracesHeaders != null) {
    OTEL_EXPORTER_OTLP_TRACES_HEADERS = cfg.observability.tracesHeaders;
  }
  // lib.optionalAttrs (cfg.observability.logsHeaders != null) {
    OTEL_EXPORTER_OTLP_LOGS_HEADERS = cfg.observability.logsHeaders;
  };

  serviceExec = "${cfg.package}/bin/ipp-print-orchestrator-agent";
in
{
  options.services.ippPrintOrchestrator = {
    enable = mkEnableOption "IPP print orchestrator service";

    package = mkOption {
      type = types.nullOr types.package;
      default = null;
      defaultText = literalExpression "null";
      description = ''
        Store package containing the ipp-print-orchestrator-agent wrapper and
        the CUPS PDF preflight filter.
      '';
    };

    hpDriverPackage = mkOption {
      type = types.nullOr types.package;
      default = null;
      defaultText = literalExpression "null";
      description = "Store package containing the patched HP Laser MFP 135a ULD driver.";
    };

    cupsUsbBackendPackage = mkOption {
      type = types.nullOr types.package;
      default = null;
      defaultText = literalExpression "null";
      description = "Store package containing the supervised CUPS USB backend.";
    };

    user = mkOption {
      type = nonEmptyString "service user";
      default = "ipp-print-orchestrator";
      description = "User that runs the application service.";
    };

    group = mkOption {
      type = nonEmptyString "service group";
      default = "ipp-print-orchestrator";
      description = "Group that runs the application service.";
    };

    dataDir = mkOption {
      type = nonEmptyString "data directory";
      default = "/var/lib/ipp-print-orchestrator";
      description = "Writable application state directory.";
    };

    cacheDir = mkOption {
      type = nonEmptyString "cache directory";
      default = "/var/cache/ipp-print-orchestrator";
      description = "Writable cache directory used by the CUPS PDF preflight filter.";
    };

    usbSysfsRoot = mkOption {
      type = nonEmptyString "USB sysfs root";
      default = "/sys/bus/usb/devices";
      description = "Sysfs root used by USB printer status discovery.";
    };

    bind = {
      host = mkOption {
        type = nonEmptyString "bind host";
        default = "127.0.0.1";
        description = "HTTP bind host for the local orchestrator API.";
      };

      port = mkOption {
        type = types.port;
        default = 4310;
        description = "HTTP bind port for the local orchestrator API.";
      };
    };

    printer = {
      profile = mkOption {
        type = types.enum [ "hp135a-safe" ];
        default = "hp135a-safe";
        description = "Printer safety profile. The HP 135a profile keeps the patched 300dpi-safe driver path.";
      };

      queueName = mkOption {
        type = nonEmptyString "CUPS queue name";
        default = "HP135a";
        description = "CUPS queue name observed by the service.";
      };

      enablePrinting = mkOption {
        type = types.bool;
        default = false;
        description = "Whether the host should expose a live printing queue.";
      };

      advertise = mkOption {
        type = types.bool;
        default = false;
        description = "Whether the live queue should be advertised to clients.";
      };

      preserveJobFilesSeconds = mkOption {
        type = types.ints.positive;
        default = 86400;
        description = "CUPS PreserveJobFiles duration for operator inspection.";
      };

      maxJobTimeSeconds = mkOption {
        type = types.ints.positive;
        default = 300;
        description = "CUPS MaxJobTime guard for this printer.";
      };

      usbBackendTimeoutSeconds = mkOption {
        type = types.ints.positive;
        default = 60;
        description = "Timeout for the supervised USB backend wrapper.";
      };
    };

    statusObservationIntervalMs = mkOption {
      type = types.ints.positive;
      default = 10000;
      description = "Printer status observation interval in milliseconds.";
    };

    heartbeatIntervalMs = mkOption {
      type = types.ints.positive;
      default = 60000;
      description = "Application heartbeat interval in milliseconds.";
    };

    reconcileIntervalMs = mkOption {
      type = types.ints.positive;
      default = 30000;
      description = "Printer reconciliation interval in milliseconds.";
    };

    logPretty = mkOption {
      type = types.bool;
      default = false;
      description = "Whether application logs should use pretty local formatting.";
    };

    observability = {
      enableOtlp = mkOption {
        type = types.bool;
        default = false;
        description = "Enable OTLP export for logs and traces.";
      };

      tracesEndpoint = mkOption {
        type = types.nullOr (nonEmptyString "OTLP traces endpoint");
        default = null;
        description = "OTLP HTTP traces endpoint.";
      };

      logsEndpoint = mkOption {
        type = types.nullOr (nonEmptyString "OTLP logs endpoint");
        default = null;
        description = "OTLP HTTP logs endpoint.";
      };

      tracesHeaders = mkOption {
        type = types.nullOr (nonEmptyString "OTLP traces headers");
        default = null;
        description = "Comma-separated OTLP traces headers.";
      };

      logsHeaders = mkOption {
        type = types.nullOr (nonEmptyString "OTLP logs headers");
        default = null;
        description = "Comma-separated OTLP logs headers.";
      };

      resourceAttributes = mkOption {
        type = nonEmptyString "OpenTelemetry resource attributes";
        default = "service.name=ipp-print-orchestrator";
        description = "OpenTelemetry resource attributes attached to exported telemetry.";
      };
    };
  };

  config = mkIf cfg.enable (mkMerge [
    {
      assertions = [
        {
          assertion = cfg.package != null;
          message = "services.ippPrintOrchestrator.package must be set when the service is enabled.";
        }
        {
          assertion = cfg.printer.profile == "hp135a-safe" -> cfg.hpDriverPackage != null;
          message = "hp135a-safe requires services.ippPrintOrchestrator.hpDriverPackage.";
        }
        {
          assertion = cfg.printer.profile == "hp135a-safe" -> cfg.cupsUsbBackendPackage != null;
          message = "hp135a-safe requires services.ippPrintOrchestrator.cupsUsbBackendPackage.";
        }
        {
          assertion = cfg.printer.enablePrinting -> cfg.printer.advertise;
          message = "live printing requires an explicit printer.advertise = true opt-in.";
        }
        {
          assertion =
            cfg.observability.enableOtlp
            ->
              cfg.observability.tracesEndpoint != null
              && cfg.observability.logsEndpoint != null
              && cfg.observability.tracesHeaders != null
              && cfg.observability.logsHeaders != null;
          message = "observability.enableOtlp requires traces/logs endpoints and headers.";
        }
      ];

      users.groups.${cfg.group} = { };
      users.users.${cfg.user} = {
        inherit (cfg) group;
        isSystemUser = true;
        home = cfg.dataDir;
        createHome = true;
      };

      systemd.tmpfiles.rules = [
        "d ${cfg.dataDir} 0750 ${cfg.user} ${cfg.group} -"
      ]
      ++ lib.optionals cfg.printer.enablePrinting [
        "d ${cfg.cacheDir} 0750 lp lp -"
      ];

      systemd.services.ipp-print-orchestrator = {
        description = "IPP print orchestrator";
        after = [ "cups.service" ];
        wants = [ "cups.service" ];
        wantedBy = [ "multi-user.target" ];

        environment = environment // {
          IPP_ORCH_USB_BACKEND_TIMEOUT_SECONDS = toString cfg.printer.usbBackendTimeoutSeconds;
        };

        serviceConfig = {
          Type = "simple";
          User = cfg.user;
          Group = cfg.group;
          WorkingDirectory = cfg.dataDir;
          ExecStart = serviceExec;
          Restart = "always";
          RestartSec = 5;
          StateDirectory = "ipp-print-orchestrator";
          CacheDirectory = "ipp-print-orchestrator";
          NoNewPrivileges = true;
          PrivateTmp = true;
          ProtectHome = true;
        };
      };

      systemd.services.ipp-print-orchestrator-heartbeat = {
        description = "IPP print orchestrator heartbeat check";
        after = [ "ipp-print-orchestrator.service" ];
        path = [ pkgs.curl ];

        serviceConfig = {
          Type = "oneshot";
          User = cfg.user;
          Group = cfg.group;
          ExecStart = "${pkgs.curl}/bin/curl --fail --silent http://${cfg.bind.host}:${toString cfg.bind.port}/v1/health";
        };
      };

      systemd.timers.ipp-print-orchestrator-heartbeat = {
        description = "Run IPP print orchestrator heartbeat check every minute";
        wantedBy = [ "timers.target" ];

        timerConfig = {
          OnBootSec = "30s";
          OnUnitActiveSec = "60s";
          Unit = "ipp-print-orchestrator-heartbeat.service";
        };
      };
    }
  ]);
}
