import { Effect, Layer } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import { AppConfig } from "../config/AppConfig.js"
import { CupsObserver } from "../cups-observation/CupsObserver.js"
import {
  makeUsbDeviceIdentity,
  type UsbDeviceIdentity,
  usbDeviceIdentityMatches,
} from "../domain/UsbDeviceIdentity.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

type PrinterProbeService = typeof PrinterProbe.Service

interface UsbSysfsDevice {
  readonly identity: UsbDeviceIdentity
  readonly authorized?: boolean
}

const usbDeviceMissingReason = "usb-device-missing"
const usbDeviceDeauthorizedReason = "usb-device-deauthorized"
const usbDeviceMissingMessage =
  "Configured USB printer device is not present in sysfs. Printer might be unplugged or turned off."
const usbDeviceDeauthorizedMessage =
  "Configured USB printer device is present in sysfs but deauthorized by the kernel. Reconnect or reauthorize the USB device before printing."
type UsbPresence = "attached" | "missing" | "deauthorized"

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

const usbPresenceFromObservation = (attached: boolean): UsbPresence =>
  attached ? "attached" : "missing"

const usbPresenceFromDevices = (
  target: UsbDeviceIdentity,
  devices: readonly UsbSysfsDevice[],
): UsbPresence => {
  const matchingDevice = devices.find((device) =>
    usbDeviceIdentityMatches(target, device.identity),
  )

  if (matchingDevice === undefined) {
    return "missing"
  }

  return matchingDevice.authorized === false ? "deauthorized" : "attached"
}

const usbPresenceReason = (presence: UsbPresence): string =>
  presence === "deauthorized"
    ? usbDeviceDeauthorizedReason
    : usbDeviceMissingReason

const usbPresenceMessage = (presence: UsbPresence): string =>
  presence === "deauthorized"
    ? usbDeviceDeauthorizedMessage
    : usbDeviceMissingMessage

export const PrinterProbeCliLive = Layer.effect(
  PrinterProbe,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const cupsObserver = yield* CupsObserver
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const readUsbPresence = Effect.fn("PrinterProbe.readUsbPresence")(
      function* (attachedFromObservation: boolean) {
        return yield* readUsbSysfsDevices(
          fs,
          path,
          appConfig.usbSysfsRoot,
        ).pipe(
          Effect.map((devices) =>
            usbPresenceFromDevices(appConfig.usbDeviceIdentity, devices),
          ),
          Effect.tap((usbPresence) =>
            Effect.annotateCurrentSpan({
              "printer_probe.usb_presence_source": "sysfs",
              "printer_probe.usb_sysfs_root": appConfig.usbSysfsRoot,
              "printer_probe.usb_attached": usbPresence === "attached",
              "printer_probe.usb_presence": usbPresence,
            }),
          ),
          Effect.catch(() =>
            Effect.gen(function* () {
              const fallback = usbPresenceFromObservation(
                attachedFromObservation,
              )
              yield* Effect.annotateCurrentSpan({
                "printer_probe.usb_presence_source": "cups-fallback",
                "printer_probe.usb_sysfs_root": appConfig.usbSysfsRoot,
                "printer_probe.usb_attached": fallback === "attached",
                "printer_probe.usb_presence": fallback,
              })
              return fallback
            }),
          ),
        )
      },
    )

    const status: PrinterProbeService["status"] = Effect.fn(
      "PrinterProbe.status",
    )(function* () {
      return yield* cupsObserver.observePrinter().pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            readUsbPresence(false).pipe(
              Effect.map((usbPresence) => ({
                attached: usbPresence === "attached",
                queueAvailable: false,
                cupsReachable: false,
                state: null,
                reasons:
                  usbPresence === "attached"
                    ? []
                    : [usbPresenceReason(usbPresence)],
                message: error.message,
              })),
            ),
          onSuccess: (observation) =>
            Effect.gen(function* () {
              const usbPresence = yield* readUsbPresence(observation.attached)
              const attached = usbPresence === "attached"

              return {
                attached,
                queueAvailable: attached && observation.queueAvailable,
                cupsReachable: true,
                state: observation.state,
                reasons: attached
                  ? observation.reasons
                  : [usbPresenceReason(usbPresence), ...observation.reasons],
                message: attached
                  ? observation.message
                  : usbPresenceMessage(usbPresence),
              }
            }),
        }),
      )
    })

    return PrinterProbe.of({
      status,
    })
  }),
)
