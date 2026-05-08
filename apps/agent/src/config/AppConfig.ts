import { Config, Effect, Layer } from "effect"
import * as ServiceMap from "effect/ServiceMap"

export interface AppConfigShape {
  readonly dataDir: string
  readonly printerName: string
  readonly bindHost: string
  readonly bindPort: number
  readonly usbSysfsRoot: string
  readonly statusObservationIntervalMs: number
  readonly heartbeatIntervalMs: number
  readonly reconcileIntervalMs: number
  readonly logPretty: boolean
  readonly enableOtlp: boolean
}

export class AppConfig extends ServiceMap.Service<AppConfig, AppConfigShape>()(
  "@ipp/agent/config/AppConfig",
) {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const dataDir = yield* Config.string("IPP_ORCH_DATA_DIR").pipe(
        Config.withDefault("./data"),
      )
      const printerName = yield* Config.string("IPP_ORCH_PRINTER_NAME").pipe(
        Config.withDefault("printer"),
      )
      const bindHost = yield* Config.string("IPP_ORCH_BIND_HOST").pipe(
        Config.withDefault("127.0.0.1"),
      )
      const bindPort = yield* Config.int("IPP_ORCH_BIND_PORT").pipe(
        Config.withDefault(4310),
      )
      const usbSysfsRoot = yield* Config.string("IPP_ORCH_USB_SYSFS_ROOT").pipe(
        Config.withDefault("/sys/bus/usb/devices"),
      )
      const statusObservationIntervalMs = yield* Config.int(
        "IPP_ORCH_STATUS_OBSERVATION_INTERVAL_MS",
      ).pipe(Config.withDefault(10_000))
      const heartbeatIntervalMs = yield* Config.int(
        "IPP_ORCH_HEARTBEAT_INTERVAL_MS",
      ).pipe(Config.withDefault(60_000))
      const reconcileIntervalMs = yield* Config.int(
        "IPP_ORCH_RECONCILE_INTERVAL_MS",
      ).pipe(Config.withDefault(30_000))
      const logPretty = yield* Config.boolean("IPP_ORCH_LOG_PRETTY").pipe(
        Config.withDefault(false),
      )
      const enableOtlp = yield* Config.boolean("IPP_ORCH_ENABLE_OTLP").pipe(
        Config.withDefault(false),
      )

      return AppConfig.of({
        dataDir,
        printerName,
        bindHost,
        bindPort,
        usbSysfsRoot,
        statusObservationIntervalMs,
        heartbeatIntervalMs,
        reconcileIntervalMs,
        logPretty,
        enableOtlp,
      })
    }),
  )
}
