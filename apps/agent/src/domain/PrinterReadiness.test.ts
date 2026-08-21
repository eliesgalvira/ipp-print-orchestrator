import { describe, expect, it } from "@effect/vitest"

import type { CupsQueueObservation } from "../cups-observation/CupsQueueObservation.js"
import {
  CupsQueueStatus,
  derivePrinterReadiness,
  legacyPrinterStatus,
  printerReadinessStatus,
  UsbDeviceState,
} from "./PrinterReadiness.js"

const availableQueue: CupsQueueObservation = {
  queueName: "HP135a",
  acceptingJobs: true,
  state: "idle",
  reasons: [],
  message: null,
  available: true,
  physicalPrinterAppearsAttached: true,
}

describe("PrinterReadiness", () => {
  it("is ready when the CUPS queue is available and sysfs sees the USB device", () => {
    const readiness = derivePrinterReadiness({
      cupsQueue: CupsQueueStatus.Reachable({ observation: availableQueue }),
      usbDevice: UsbDeviceState.Attached({ source: "sysfs" }),
    })

    expect(readiness.ready).toBe(true)
  })

  it.each([
    UsbDeviceState.Missing({ source: "sysfs" }),
    UsbDeviceState.Deauthorized({ source: "sysfs" }),
  ])("is not ready when USB state is $_tag", (usbDevice) => {
    const readiness = derivePrinterReadiness({
      cupsQueue: CupsQueueStatus.Reachable({ observation: availableQueue }),
      usbDevice,
    })

    expect(readiness.ready).toBe(false)
  })

  it("is not ready when the CUPS queue is unavailable", () => {
    const readiness = derivePrinterReadiness({
      cupsQueue: CupsQueueStatus.Reachable({
        observation: { ...availableQueue, available: false },
      }),
      usbDevice: UsbDeviceState.Attached({ source: "sysfs" }),
    })

    expect(readiness.ready).toBe(false)
  })

  it("is not ready when CUPS cannot be reached", () => {
    const readiness = derivePrinterReadiness({
      cupsQueue: CupsQueueStatus.Unreachable({ message: "CUPS unavailable" }),
      usbDevice: UsbDeviceState.Attached({ source: "sysfs" }),
    })

    expect(readiness.ready).toBe(false)
  })

  it("preserves when USB attachment came from a CUPS inference", () => {
    const readiness = derivePrinterReadiness({
      cupsQueue: CupsQueueStatus.Reachable({ observation: availableQueue }),
      usbDevice: UsbDeviceState.Attached({ source: "cups-inference" }),
    })

    expect(readiness.usbDevice).toEqual({
      _tag: "Attached",
      source: "cups-inference",
    })
  })

  it("projects canonical status fields without collapsing USB state", () => {
    const readiness = derivePrinterReadiness({
      cupsQueue: CupsQueueStatus.Reachable({ observation: availableQueue }),
      usbDevice: UsbDeviceState.Deauthorized({ source: "sysfs" }),
    })

    expect(printerReadinessStatus(readiness)).toEqual({
      printerReady: false,
      cupsReachable: true,
      cupsQueueAvailable: true,
      cupsQueueState: "idle",
      cupsQueueReasons: [],
      cupsQueueMessage: null,
      usbDeviceState: "deauthorized",
      usbDeviceStateSource: "sysfs",
    })
  })

  it("keeps the old status fields as an explicit compatibility projection", () => {
    const readiness = derivePrinterReadiness({
      cupsQueue: CupsQueueStatus.Reachable({ observation: availableQueue }),
      usbDevice: UsbDeviceState.Deauthorized({ source: "sysfs" }),
    })

    expect(legacyPrinterStatus(readiness)).toEqual({
      printerAttached: false,
      printerQueueAvailable: false,
      printerState: "idle",
      printerReasons: ["usb-device-deauthorized"],
      printerMessage:
        "Configured USB printer device is present but deauthorized by the kernel. Reconnect or reauthorize the USB device before printing.",
    })
  })
})
