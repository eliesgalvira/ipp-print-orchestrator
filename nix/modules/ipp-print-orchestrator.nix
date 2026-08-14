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
    IPP_ORCH_PRINTER_NAME = cfg.printerName;
    IPP_ORCH_BIND_HOST = cfg.bind.host;
    IPP_ORCH_BIND_PORT = toString cfg.bind.port;
    IPP_ORCH_USB_SYSFS_ROOT = cfg.usbSysfsRoot;
    IPP_ORCH_HEARTBEAT_INTERVAL_MS = toString cfg.heartbeatIntervalMs;
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
    enable = mkEnableOption "IPP printer observer service";

    package = mkOption {
      type = types.nullOr types.package;
      default = null;
      defaultText = literalExpression "null";
      description = "Store package containing the agent service.";
    };

    user = mkOption {
      type = nonEmptyString "service user";
      default = "ipp-print-orchestrator";
      description = "User that runs the observation service.";
    };

    group = mkOption {
      type = nonEmptyString "service group";
      default = "ipp-print-orchestrator";
      description = "Group that runs the observation service.";
    };

    printerName = mkOption {
      type = nonEmptyString "CUPS queue name";
      default = "HP135a";
      description = "CUPS queue observed by the service.";
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
        description = "HTTP bind host for health and status.";
      };

      port = mkOption {
        type = types.port;
        default = 4310;
        description = "HTTP bind port for health and status.";
      };
    };

    heartbeatIntervalMs = mkOption {
      type = types.ints.positive;
      default = 60000;
      description = "Application heartbeat interval in milliseconds.";
    };

    logPretty = mkOption {
      type = types.bool;
      default = false;
      description = "Whether application logs use local pretty formatting.";
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

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = cfg.package != null;
        message = "services.ippPrintOrchestrator.package must be set when the service is enabled.";
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
    };

    systemd.services.ipp-print-orchestrator = {
      description = "IPP printer observer";
      after = [ "cups.service" ];
      wants = [ "cups.service" ];
      wantedBy = [ "multi-user.target" ];
      inherit environment;

      serviceConfig = {
        Type = "simple";
        User = cfg.user;
        Group = cfg.group;
        ExecStart = serviceExec;
        Restart = "always";
        RestartSec = 5;
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectHome = true;
      };
    };

    systemd.services.ipp-print-orchestrator-heartbeat = {
      description = "IPP printer observer heartbeat check";
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
      description = "Run IPP printer observer heartbeat check every minute";
      wantedBy = [ "timers.target" ];
      timerConfig = {
        OnBootSec = "30s";
        OnUnitActiveSec = "60s";
        Unit = "ipp-print-orchestrator-heartbeat.service";
      };
    };
  };
}
