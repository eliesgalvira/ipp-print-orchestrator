import { Data } from "effect"

import type {
  CupsQueueObservation,
  CupsQueueState,
} from "../cups-observation/CupsQueueObservation.js"

export type UsbDeviceObservationSource = "sysfs" | "cups-inference"

export type UsbDeviceState = Data.TaggedEnum<{
  Attached: { readonly source: UsbDeviceObservationSource }
  Missing: { readonly source: UsbDeviceObservationSource }
  Deauthorized: { readonly source: "sysfs" }
}>

export const UsbDeviceState = Data.taggedEnum<UsbDeviceState>()

export type CupsQueueStatus = Data.TaggedEnum<{
  Reachable: { readonly observation: CupsQueueObservation }
  Unreachable: { readonly message: string }
}>

export const CupsQueueStatus = Data.taggedEnum<CupsQueueStatus>()

export interface PrinterReadiness {
  readonly ready: boolean
  readonly cupsQueue: CupsQueueStatus
  readonly usbDevice: UsbDeviceState
}

export const derivePrinterReadiness = (input: {
  readonly cupsQueue: CupsQueueStatus
  readonly usbDevice: UsbDeviceState
}): PrinterReadiness => ({
  ...input,
  ready:
    CupsQueueStatus.$is("Reachable")(input.cupsQueue) &&
    input.cupsQueue.observation.available &&
    UsbDeviceState.$is("Attached")(input.usbDevice),
})

export type UsbDeviceStateName = "attached" | "missing" | "deauthorized"

export const usbDeviceStateName = (state: UsbDeviceState): UsbDeviceStateName =>
  UsbDeviceState.$match(state, {
    Attached: (): UsbDeviceStateName => "attached",
    Missing: (): UsbDeviceStateName => "missing",
    Deauthorized: (): UsbDeviceStateName => "deauthorized",
  })

export interface PrinterReadinessStatus {
  readonly printerReady: boolean
  readonly cupsReachable: boolean
  readonly cupsQueueAvailable: boolean
  readonly cupsQueueState: CupsQueueState | null
  readonly cupsQueueReasons: readonly string[]
  readonly cupsQueueMessage: string | null
  readonly usbDeviceState: UsbDeviceStateName
  readonly usbDeviceStateSource: UsbDeviceObservationSource
}

export const printerReadinessStatus = (
  readiness: PrinterReadiness,
): PrinterReadinessStatus => {
  const cupsQueue = CupsQueueStatus.$match(readiness.cupsQueue, {
    Reachable: ({ observation }) => ({
      cupsReachable: true,
      cupsQueueAvailable: observation.available,
      cupsQueueState: observation.state,
      cupsQueueReasons: observation.reasons,
      cupsQueueMessage: observation.message,
    }),
    Unreachable: ({ message }) => ({
      cupsReachable: false,
      cupsQueueAvailable: false,
      cupsQueueState: null,
      cupsQueueReasons: [],
      cupsQueueMessage: message,
    }),
  })

  return {
    printerReady: readiness.ready,
    ...cupsQueue,
    usbDeviceState: usbDeviceStateName(readiness.usbDevice),
    usbDeviceStateSource: readiness.usbDevice.source,
  }
}

const usbDeviceMissingMessage =
  "Configured USB printer device is not present. Printer might be unplugged or turned off."
const usbDeviceDeauthorizedMessage =
  "Configured USB printer device is present but deauthorized by the kernel. Reconnect or reauthorize the USB device before printing."

export interface LegacyPrinterStatus {
  readonly printerAttached: boolean
  readonly printerQueueAvailable: boolean
  readonly printerState: string | null
  readonly printerReasons: readonly string[]
  readonly printerMessage: string | null
}

export const legacyPrinterStatus = (
  readiness: PrinterReadiness,
): LegacyPrinterStatus => {
  const status = printerReadinessStatus(readiness)
  const usbDevice = UsbDeviceState.$match(readiness.usbDevice, {
    Attached: () => ({ reason: null, message: null }),
    Missing: () => ({
      reason: "usb-device-missing",
      message: usbDeviceMissingMessage,
    }),
    Deauthorized: () => ({
      reason: "usb-device-deauthorized",
      message: usbDeviceDeauthorizedMessage,
    }),
  })

  return {
    printerAttached: status.usbDeviceState === "attached",
    printerQueueAvailable: status.printerReady,
    printerState: status.cupsQueueState,
    printerReasons:
      usbDevice.reason === null
        ? status.cupsQueueReasons
        : [usbDevice.reason, ...status.cupsQueueReasons],
    printerMessage: usbDevice.message ?? status.cupsQueueMessage,
  }
}
