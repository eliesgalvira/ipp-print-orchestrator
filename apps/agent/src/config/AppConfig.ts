import { Config, Context, Effect, Layer } from "effect"

import {
  makeUsbDeviceIdentity,
  type UsbDeviceIdentity,
} from "../domain/UsbDeviceIdentity.js"

export interface AppConfigShape {
  readonly printerName: string
  readonly bindHost: string
  readonly bindPort: number
  readonly usbSysfsRoot: string
  readonly usbDeviceIdentity: UsbDeviceIdentity
  readonly heartbeatIntervalMs: number
  readonly logPretty: boolean
  readonly enableOtlp: boolean
}

export class AppConfig extends Context.Service<AppConfig, AppConfigShape>()(
  "@ipp/agent/config/AppConfig",
) {
  static readonly layer = Layer.effect(
    AppConfig,
    Effect.gen(function* () {
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
      const usbVendorId = yield* Config.string("IPP_ORCH_USB_VENDOR_ID").pipe(
        Config.withDefault("03f0"),
      )
      const usbProductId = yield* Config.string("IPP_ORCH_USB_PRODUCT_ID").pipe(
        Config.withDefault("f22a"),
      )
      const usbSerial = yield* Config.string("IPP_ORCH_USB_SERIAL").pipe(
        Config.withDefault(""),
      )
      const heartbeatIntervalMs = yield* Config.int(
        "IPP_ORCH_HEARTBEAT_INTERVAL_MS",
      ).pipe(Config.withDefault(60_000))
      const logPretty = yield* Config.boolean("IPP_ORCH_LOG_PRETTY").pipe(
        Config.withDefault(false),
      )
      const enableOtlp = yield* Config.boolean("IPP_ORCH_ENABLE_OTLP").pipe(
        Config.withDefault(false),
      )

      return AppConfig.of({
        printerName,
        bindHost,
        bindPort,
        usbSysfsRoot,
        usbDeviceIdentity: makeUsbDeviceIdentity({
          vendorId: usbVendorId,
          productId: usbProductId,
          serial: usbSerial,
        }),
        heartbeatIntervalMs,
        logPretty,
        enableOtlp,
      })
    }),
  )
}
