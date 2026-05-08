import { Effect, Layer, Ref, Schema } from "effect"
import * as FileSystem from "effect/FileSystem"
import * as Path from "effect/Path"
import type * as PlatformError from "effect/PlatformError"
import { AppConfig } from "../config/AppConfig.js"
import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

type PrinterProbeService = typeof PrinterProbe.Service

interface ParsedUsbDeviceUri {
  readonly deviceUri: string
  readonly serial: string | null
  readonly matchTokens: readonly string[]
}

interface UsbSysfsDevice {
  readonly serial: string | null
  readonly matchTokens: readonly string[]
}

const usbDeviceMissingReason = "usb-device-missing"
const usbDeviceMissingMessage =
  "Configured USB printer device is not present in sysfs. Printer might be unplugged or turned off."
const usbDevicePresentMessage =
  "Configured USB printer device is present in sysfs"

class UsbSysfsReadFailed extends Schema.TaggedErrorClass<UsbSysfsReadFailed>()(
  "UsbSysfsReadFailed",
  {
    message: Schema.String,
  },
) {}

const normalizeSerial = (value: string | null): string | null => {
  if (value === null) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  return normalized.length === 0 ? null : normalized
}

const normalizeMatchTokens = (value: string): readonly string[] =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 0)

export const parseUsbDeviceUri = (
  deviceUri: string,
): ParsedUsbDeviceUri | null => {
  if (!deviceUri.startsWith("usb://")) {
    return null
  }

  try {
    const url = new URL(deviceUri)
    const manufacturer = decodeURIComponent(url.hostname)
    const product = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    return {
      deviceUri,
      serial: normalizeSerial(url.searchParams.get("serial")),
      matchTokens: normalizeMatchTokens(`${manufacturer} ${product}`),
    }
  } catch {
    return null
  }
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

    if (manufacturer === null && product === null && serial === null) {
      return null
    }

    return {
      serial: normalizeSerial(serial),
      matchTokens: normalizeMatchTokens(
        `${manufacturer ?? ""} ${product ?? ""}`,
      ),
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
  target: ParsedUsbDeviceUri,
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

export const PrinterProbeCliLive = Layer.effect(
  PrinterProbe,
  Effect.gen(function* () {
    const appConfig = yield* AppConfig
    const cupsObserver = yield* CupsObserver
    const cupsClient = yield* CupsClient
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const configuredDeviceUriRef = yield* Ref.make<string | null>(null)
    const usbAttachedRef = yield* Ref.make<boolean | null>(null)

    const getConfiguredDeviceUri = Effect.fn(
      "PrinterProbe.getConfiguredDeviceUri",
    )(function* () {
      const cached = yield* Ref.get(configuredDeviceUriRef)
      if (cached !== null) {
        return cached
      }

      const deviceUri = yield* cupsClient.getPrinterDeviceUri().pipe(
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

    const refreshUsbAttached = Effect.fn("PrinterProbe.refreshUsbAttached")(
      function* (attachedFromObservation: boolean) {
        const cached = yield* Ref.get(usbAttachedRef)
        const configuredDeviceUri = yield* getConfiguredDeviceUri()
        const parsedUsbDeviceUri =
          configuredDeviceUri === null
            ? null
            : parseUsbDeviceUri(configuredDeviceUri)

        if (parsedUsbDeviceUri === null) {
          yield* Ref.set(usbAttachedRef, null)
          return attachedFromObservation
        }

        return yield* readUsbSysfsDevices(
          fs,
          path,
          appConfig.usbSysfsRoot,
        ).pipe(
          Effect.map((devices) =>
            devices.some((device) =>
              usbDeviceUriMatchesSysfsDevice(parsedUsbDeviceUri, device),
            ),
          ),
          Effect.mapError(
            (error) =>
              new UsbSysfsReadFailed({
                message: String(error),
              }),
          ),
          Effect.tap((usbAttached) => Ref.set(usbAttachedRef, usbAttached)),
          Effect.tap((usbAttached) =>
            Effect.annotateCurrentSpan({
              "printer_probe.usb_presence_source": "sysfs",
              "printer_probe.usb_sysfs_root": appConfig.usbSysfsRoot,
              "printer_probe.usb_attached": usbAttached,
            }),
          ),
          Effect.catch(() =>
            Effect.gen(function* () {
              const fallback = cached ?? attachedFromObservation
              yield* Effect.annotateCurrentSpan({
                "printer_probe.usb_presence_source": "sysfs-fallback",
                "printer_probe.usb_sysfs_root": appConfig.usbSysfsRoot,
                "printer_probe.usb_attached": fallback,
              })
              return fallback
            }),
          ),
        )
      },
    )

    const deriveAttached = Effect.fn("PrinterProbe.deriveAttached")(function* (
      attached: boolean,
      reason?: string,
    ) {
      if (!attached) {
        return false
      }

      const deviceUri = yield* getConfiguredDeviceUri()

      if (deviceUri === null || !deviceUri.startsWith("usb://")) {
        return attached
      }

      const cached = yield* Ref.get(usbAttachedRef)
      if (reason !== "udev-usb-event" && cached !== null) {
        yield* Effect.annotateCurrentSpan({
          "printer_probe.usb_presence_source": "cache",
          "printer_probe.usb_attached": cached,
        })
        return cached
      }

      return yield* refreshUsbAttached(attached)
    })

    const status: PrinterProbeService["status"] = Effect.fn(
      "PrinterProbe.status",
    )(function* (reason?: string) {
      return yield* cupsObserver.observePrinter().pipe(
        Effect.flatMap((observation) =>
          Effect.gen(function* () {
            const attached = yield* deriveAttached(observation.attached, reason)
            const configuredDeviceUri = yield* getConfiguredDeviceUri()
            const isUsbPrinter: boolean =
              configuredDeviceUri?.startsWith("usb://") ?? false
            const usbMissing: boolean =
              isUsbPrinter && observation.attached && !attached
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
              reasons: usbMissing
                ? [usbDeviceMissingReason, ...observation.reasons]
                : observation.reasons,
              message: usbMissing
                ? usbDeviceMissingMessage
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
