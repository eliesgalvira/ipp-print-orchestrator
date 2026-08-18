import { Effect, Layer, Ref, Schema } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import { AppConfig } from "../config/AppConfig.js"
import { CupsObserver } from "../cups-observation/CupsObserver.js"
import {
  isPhysicalUsbDeviceUri,
  type PhysicalUsbDeviceUri,
  parsePhysicalUsbDeviceUri,
} from "../domain/PrinterDeviceUri.js"
import { PrinterDeviceSource } from "../services/PrinterDeviceSource.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

type PrinterProbeService = typeof PrinterProbe.Service

interface UsbSysfsDevice {
  readonly serial: string | null
  readonly matchTokens: readonly string[]
  readonly authorized?: boolean
}

const usbDeviceMissingReason = "usb-device-missing"
const usbDeviceDeauthorizedReason = "usb-device-deauthorized"
const usbDeviceMissingMessage =
  "Configured USB printer device is not present in sysfs. Printer might be unplugged or turned off."
const usbDeviceDeauthorizedMessage =
  "Configured USB printer device is present in sysfs but deauthorized by the kernel. Reconnect or reauthorize the USB device before printing."
const usbDevicePresentMessage =
  "Configured USB printer device is present in sysfs"

type UsbPresence = "attached" | "missing" | "deauthorized"

class UsbSysfsReadFailed extends Schema.TaggedError<UsbSysfsReadFailed>()(
  "UsbSysfsReadFailed",
  {
    message: Schema.String,
  },
) {}

const normalizeMatchTokens = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 0)

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
    const manufacturer = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "manufacturer"),
    )
    const product = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "product"),
    )
    const serial = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "serial"),
    )
    const authorized = yield* readOptionalTextFile(
      fs,
      path.join(deviceRoot, "authorized"),
    )

    if (manufacturer === null && product === null && serial === null) {
      return null
    }

    return {
      serial: serial?.trim().toLowerCase() ?? null,
      matchTokens: normalizeMatchTokens(
        `${manufacturer ?? ""} ${product ?? ""}`,
      ),
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

export const listUsbSysfsDevices = (
  usbSysfsRoot: string,
): Effect.Effect<
  readonly UsbSysfsDevice[],
  UsbSysfsReadFailed,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    return yield* readUsbSysfsDevices(fs, path, usbSysfsRoot)
  }).pipe(
    Effect.mapError(
      (error) =>
        new UsbSysfsReadFailed({
          message: String(error),
        }),
    ),
  )

export const usbDeviceUriMatchesSysfsDevice = (
  target: PhysicalUsbDeviceUri,
  device: UsbSysfsDevice,
): boolean => {
  if (target.serial !== null) {
    return device.serial === target.serial
  }

  return (
    target.matchTokens.length > 0 &&
    target.matchTokens.every((token) => device.matchTokens.includes(token))
  )
}

const usbPresenceFromObservation = (attached: boolean): UsbPresence =>
  attached ? "attached" : "missing"

const usbPresenceFromDevices = (
  target: PhysicalUsbDeviceUri,
  devices: readonly UsbSysfsDevice[],
): UsbPresence => {
  const matchingDevice = devices.find((device) =>
    usbDeviceUriMatchesSysfsDevice(target, device),
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
    const printerDeviceSource = yield* PrinterDeviceSource
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const configuredDeviceUriRef = yield* Ref.make<string | null>(null)
    const usbPresenceRef = yield* Ref.make<UsbPresence | null>(null)

    const getConfiguredDeviceUri = Effect.fn(
      "PrinterProbe.getConfiguredDeviceUri",
    )(function* () {
      const cached = yield* Ref.get(configuredDeviceUriRef)
      if (cached !== null) {
        return cached
      }

      const deviceUri = yield* printerDeviceSource.installedDeviceUri().pipe(
        Effect.catchTag("CupsUnavailable", () =>
          Effect.succeed<string | null>(null),
        ),
        Effect.catchTag("CupsCommandFailed", () =>
          Effect.succeed<string | null>(null),
        ),
      )

      if (deviceUri !== null) {
        yield* Ref.set(configuredDeviceUriRef, deviceUri)
      }

      return deviceUri
    })

    const refreshUsbPresence = Effect.fn("PrinterProbe.refreshUsbPresence")(
      function* (attachedFromObservation: boolean) {
        const cached = yield* Ref.get(usbPresenceRef)
        const configuredDeviceUri = yield* getConfiguredDeviceUri()
        const parsedUsbDeviceUri =
          configuredDeviceUri === null
            ? null
            : parsePhysicalUsbDeviceUri(configuredDeviceUri)

        if (parsedUsbDeviceUri === null) {
          yield* Ref.set(usbPresenceRef, null)
          return usbPresenceFromObservation(attachedFromObservation)
        }

        return yield* readUsbSysfsDevices(
          fs,
          path,
          appConfig.usbSysfsRoot,
        ).pipe(
          Effect.map((devices) =>
            usbPresenceFromDevices(parsedUsbDeviceUri, devices),
          ),
          Effect.mapError(
            (error) =>
              new UsbSysfsReadFailed({
                message: String(error),
              }),
          ),
          Effect.tap((usbPresence) => Ref.set(usbPresenceRef, usbPresence)),
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
              const fallback =
                cached ?? usbPresenceFromObservation(attachedFromObservation)
              yield* Effect.annotateCurrentSpan({
                "printer_probe.usb_presence_source": "sysfs-fallback",
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

    const deriveUsbPresence = Effect.fn("PrinterProbe.deriveUsbPresence")(
      function* (attached: boolean, reason?: string) {
        if (!attached) {
          return "missing" satisfies UsbPresence
        }

        const deviceUri = yield* getConfiguredDeviceUri()

        if (deviceUri === null || !isPhysicalUsbDeviceUri(deviceUri)) {
          return usbPresenceFromObservation(attached)
        }

        const cached = yield* Ref.get(usbPresenceRef)
        if (reason !== "udev-usb-event" && cached !== null) {
          yield* Effect.annotateCurrentSpan({
            "printer_probe.usb_presence_source": "cache",
            "printer_probe.usb_attached": cached === "attached",
            "printer_probe.usb_presence": cached,
          })
          return cached
        }

        return yield* refreshUsbPresence(attached)
      },
    )

    const status: PrinterProbeService["status"] = Effect.fn(
      "PrinterProbe.status",
    )(function* (reason?: string) {
      return yield* cupsObserver.observePrinter().pipe(
        Effect.flatMap((observation) =>
          Effect.gen(function* () {
            const configuredDeviceUri = yield* getConfiguredDeviceUri()
            const isUsbPrinter =
              configuredDeviceUri !== null &&
              isPhysicalUsbDeviceUri(configuredDeviceUri)
            const usbPresence = yield* deriveUsbPresence(
              observation.attached,
              reason,
            )
            const attached = isUsbPrinter
              ? usbPresence === "attached"
              : observation.attached
            const usbUnavailable: boolean =
              isUsbPrinter && observation.attached && usbPresence !== "attached"
            const usbPresentEvent: boolean =
              isUsbPrinter &&
              reason === "udev-usb-event" &&
              observation.attached &&
              attached

            return {
              attached,
              queueAvailable: attached && observation.queueAvailable,
              cupsReachable: true,
              state: observation.state,
              reasons: usbUnavailable
                ? [usbPresenceReason(usbPresence), ...observation.reasons]
                : observation.reasons,
              message: usbUnavailable
                ? usbPresenceMessage(usbPresence)
                : usbPresentEvent
                  ? usbDevicePresentMessage
                  : observation.message,
            }
          }),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            attached: false,
            queueAvailable: false,
            cupsReachable: false,
            state: null,
            reasons: [error._tag],
            message: error.message,
          }),
        ),
      )
    })

    return PrinterProbe.of({
      status,
    })
  }),
)
