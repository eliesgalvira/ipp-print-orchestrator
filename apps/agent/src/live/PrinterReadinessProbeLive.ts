import { Effect, Layer } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import { AppConfig } from "../config/AppConfig.js"
import { CupsQueueObserver } from "../cups-observation/CupsQueueObserver.js"
import {
  CupsQueueStatus,
  derivePrinterReadiness,
  UsbDeviceState,
  type UsbDeviceState as UsbDeviceStateType,
  usbDeviceStateName,
} from "../domain/PrinterReadiness.js"
import {
  makeUsbDeviceIdentity,
  type UsbDeviceIdentity,
  usbDeviceIdentityMatches,
} from "../domain/UsbDeviceIdentity.js"
import { PrinterReadinessProbe } from "../services/PrinterReadinessProbe.js"

type PrinterReadinessProbeService = typeof PrinterReadinessProbe.Service

interface UsbSysfsDevice {
  readonly identity: UsbDeviceIdentity
  readonly authorized?: boolean
}

const readOptionalTextFile = (
  fs: FileSystem.FileSystem,
  filePath: string,
): Effect.Effect<string | null> =>
  fs.readFileString(filePath, "utf8").pipe(
    Effect.map((contents) => {
      const normalized = contents.trim()
      return normalized.length === 0 ? null : normalized
    }),
    Effect.catch(() => Effect.succeed(null)),
  )

const statUsbSysfsEntry = (
  fs: FileSystem.FileSystem,
  entryPath: string,
): Effect.Effect<boolean> =>
  fs.stat(entryPath).pipe(
    Effect.map(
      (stat) => stat.type === "Directory" || stat.type === "SymbolicLink",
    ),
    Effect.catch(() => Effect.succeed(false)),
  )

const readUsbSysfsDevice = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  deviceRoot: string,
): Effect.Effect<UsbSysfsDevice | null> =>
  Effect.gen(function* () {
    const vendorId = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "idVendor"),
    )
    const productId = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "idProduct"),
    )
    const serial = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "serial"),
    )
    const authorized = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "authorized"),
    )

    if (vendorId === null || productId === null) {
      return null
    }

    return {
      identity: makeUsbDeviceIdentity({ vendorId, productId, serial }),
      ...(authorized !== null ? { authorized: authorized !== "0" } : {}),
    } satisfies UsbSysfsDevice
  })

const readUsbSysfsDevices = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  usbSysfsRoot: string,
): Effect.Effect<readonly UsbSysfsDevice[], PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const entries = yield* fs.readDirectory(usbSysfsRoot)
    const devices = yield* Effect.all(
      entries
        .filter((entry) => !entry.includes(":"))
        .map((entry) =>
          Effect.gen(function* () {
            const deviceRoot = path.join(usbSysfsRoot, entry)
            const isDeviceDirectory = yield* statUsbSysfsEntry(fs, deviceRoot)
            if (!isDeviceDirectory) {
              return null
            }
            return yield* readUsbSysfsDevice(fs, path, deviceRoot)
          }),
        ),
      { concurrency: "unbounded" },
    )

    return devices.flatMap((device) => (device === null ? [] : [device]))
  })

const usbDeviceStateFromCupsInference = (
  physicalPrinterAppearsAttached: boolean,
): UsbDeviceStateType =>
  physicalPrinterAppearsAttached
    ? UsbDeviceState.Attached({ source: "cups-inference" })
    : UsbDeviceState.Missing({ source: "cups-inference" })

const usbDeviceStateFromDevices = (
  target: UsbDeviceIdentity,
  devices: readonly UsbSysfsDevice[],
): UsbDeviceStateType => {
  const matchingDevice = devices.find((device) =>
    usbDeviceIdentityMatches(target, device.identity),
  )

  if (matchingDevice === undefined) {
    return UsbDeviceState.Missing({ source: "sysfs" })
  }

  return matchingDevice.authorized === false
    ? UsbDeviceState.Deauthorized({ source: "sysfs" })
    : UsbDeviceState.Attached({ source: "sysfs" })
}

export const PrinterReadinessProbeLive = Layer.effect(
  PrinterReadinessProbe,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const cupsQueueObserver = yield* CupsQueueObserver
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const readUsbDeviceState = Effect.fn(
      "PrinterReadinessProbe.readUsbDeviceState",
    )(function* (physicalPrinterAppearsAttached: boolean) {
      return yield* readUsbSysfsDevices(fs, path, appConfig.usbSysfsRoot).pipe(
        Effect.map((devices) =>
          usbDeviceStateFromDevices(appConfig.usbDeviceIdentity, devices),
        ),
        Effect.tap((usbDevice) =>
          Effect.annotateCurrentSpan({
            "printer_probe.usb_presence_source": "sysfs",
            "printer_probe.usb_sysfs_root": appConfig.usbSysfsRoot,
            "printer_probe.usb_device_state": usbDeviceStateName(usbDevice),
          }),
        ),
        Effect.catch(() =>
          Effect.gen(function* () {
            const fallback = usbDeviceStateFromCupsInference(
              physicalPrinterAppearsAttached,
            )
            yield* Effect.annotateCurrentSpan({
              "printer_probe.usb_presence_source": "cups-fallback",
              "printer_probe.usb_sysfs_root": appConfig.usbSysfsRoot,
              "printer_probe.usb_device_state": usbDeviceStateName(fallback),
            })
            return fallback
          }),
        ),
      )
    })

    const observe: PrinterReadinessProbeService["observe"] = Effect.fn(
      "PrinterReadinessProbe.observe",
    )(function* () {
      return yield* cupsQueueObserver.observeQueue().pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            readUsbDeviceState(false).pipe(
              Effect.map((usbDevice) =>
                derivePrinterReadiness({
                  cupsQueue: CupsQueueStatus.Unreachable({
                    message: error.message,
                  }),
                  usbDevice,
                }),
              ),
            ),
          onSuccess: (observation) =>
            Effect.gen(function* () {
              const usbDevice = yield* readUsbDeviceState(
                observation.physicalPrinterAppearsAttached,
              )

              return derivePrinterReadiness({
                cupsQueue: CupsQueueStatus.Reachable({ observation }),
                usbDevice,
              })
            }),
        }),
      )
    })

    return PrinterReadinessProbe.of({
      observe,
    })
  }),
)
