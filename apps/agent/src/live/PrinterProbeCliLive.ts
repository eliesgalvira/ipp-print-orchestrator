import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"

import { Effect, Layer, Ref, Schema } from "effect"

import { CupsObserver } from "../cups-observation/CupsObserver.js"
import { AppConfig } from "../config/AppConfig.js"
import { CupsClient } from "../services/CupsClient.js"
import { PrinterProbe } from "../services/PrinterProbe.js"

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
const usbDeviceMissingMessage = "Configured USB printer device is not present in sysfs"
const usbDevicePresentMessage = "Configured USB printer device is present in sysfs"

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

export const parseUsbDeviceUri = (deviceUri: string): ParsedUsbDeviceUri | null => {
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

const readOptionalTextFile = async (path: string): Promise<string | null> => {
  try {
    const contents = await readFile(path, "utf8")
    const normalized = contents.trim()
    return normalized.length === 0 ? null : normalized
  } catch {
    return null
  }
}

export const listUsbSysfsDevices = (
  usbSysfsRoot: string,
): Effect.Effect<readonly UsbSysfsDevice[], UsbSysfsReadFailed> =>
  Effect.tryPromise({
    try: async () => {
      const entries = await readdir(usbSysfsRoot, { withFileTypes: true })
      const devices = await Promise.all(
        entries
          .filter(
            (entry) =>
              (entry.isDirectory() || entry.isSymbolicLink()) &&
              !entry.name.includes(":"),
          )
          .map(async (entry) => {
            const deviceRoot = join(usbSysfsRoot, entry.name)
            const manufacturer = await readOptionalTextFile(
              join(deviceRoot, "manufacturer"),
            )
            const product = await readOptionalTextFile(join(deviceRoot, "product"))
            const serial = await readOptionalTextFile(join(deviceRoot, "serial"))

            if (manufacturer === null && product === null && serial === null) {
              return null
            }

            return {
              serial: normalizeSerial(serial),
              matchTokens: normalizeMatchTokens(
                `${manufacturer ?? ""} ${product ?? ""}`,
              ),
            } satisfies UsbSysfsDevice
          }),
      )

      return devices.flatMap((device) => (device === null ? [] : [device]))
    },
    catch: (error) =>
      new UsbSysfsReadFailed({
        message: String(error),
      }),
  })

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
    const configuredDeviceUriRef = yield* Ref.make<string | null>(null)
    const usbAttachedRef = yield* Ref.make<boolean | null>(null)

    const getConfiguredDeviceUri = Effect.fn("PrinterProbe.getConfiguredDeviceUri")(function* () {
      const cached = yield* Ref.get(configuredDeviceUriRef)
      if (cached !== null) {
        return cached
      }

      const deviceUri = yield* cupsClient.getPrinterDeviceUri().pipe(
        Effect.catchTag("CupsUnavailable", () => Effect.succeed<string | null>(null)),
        Effect.catchTag("CupsCommandFailed", () => Effect.succeed<string | null>(null)),
      )

      if (deviceUri !== null) {
        yield* Ref.set(configuredDeviceUriRef, deviceUri)
      }

      return deviceUri
    })

    const refreshUsbAttached = Effect.fn("PrinterProbe.refreshUsbAttached")(function* (
      attachedFromObservation: boolean,
    ) {
      const cached = yield* Ref.get(usbAttachedRef)
      const configuredDeviceUri = yield* getConfiguredDeviceUri()
      const parsedUsbDeviceUri =
        configuredDeviceUri === null ? null : parseUsbDeviceUri(configuredDeviceUri)

      if (parsedUsbDeviceUri === null) {
        yield* Ref.set(usbAttachedRef, null)
        return attachedFromObservation
      }

      return yield* listUsbSysfsDevices(appConfig.usbSysfsRoot).pipe(
        Effect.map((devices) =>
          devices.some((device) =>
            usbDeviceUriMatchesSysfsDevice(parsedUsbDeviceUri, device),
          ),
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
    })

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

    const status = Effect.fn("PrinterProbe.status")(function* (reason?: string) {
      return yield* cupsObserver.observePrinter().pipe(
        Effect.flatMap((observation) =>
          Effect.gen(function* () {
            const attached = yield* deriveAttached(observation.attached, reason)
            const configuredDeviceUri = yield* getConfiguredDeviceUri()
            const isUsbPrinter =
              configuredDeviceUri !== null && configuredDeviceUri.startsWith("usb://")
            const usbMissing = isUsbPrinter && observation.attached && !attached
            const usbPresentEvent =
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
