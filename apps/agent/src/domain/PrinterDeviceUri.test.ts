import { describe, expect, it } from "@effect/vitest"

import {
  isPhysicalUsbDeviceUri,
  parsePhysicalUsbDeviceUri,
} from "./PrinterDeviceUri.js"

describe("PrinterDeviceUri", () => {
  const raw =
    "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1"

  it.each([
    raw,
    raw.replace("usb://", "ipp-orch-usb://"),
  ])("identifies the physical USB printer behind %s", (installedUri) => {
    expect(parsePhysicalUsbDeviceUri(installedUri)).toEqual({
      installedUri,
      physicalUri: raw,
      serial: "abc123",
      matchTokens: ["hp", "laser", "mfp", "131", "133", "135", "138"],
    })
    expect(isPhysicalUsbDeviceUri(installedUri)).toBe(true)
  })

  it("does not classify an IPP network destination as USB", () => {
    expect(
      parsePhysicalUsbDeviceUri("ipps://printer.local/ipp/print"),
    ).toBeNull()
  })
})
