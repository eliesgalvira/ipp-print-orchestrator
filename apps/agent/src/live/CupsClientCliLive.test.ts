import { describe, expect, it } from "@effect/vitest"

import {
  parseLpinfoDevicesOutput,
  parseLpSubmitOutput,
  parseLpstatDeviceOutput,
  parseLpstatJobsOutput,
  parseLpstatPrinterOutput,
} from "./CupsClientCliLive.js"

describe("CupsClientCliLive parsers", () => {
  it("parses lp submit output", () => {
    expect(parseLpSubmitOutput("request id is printer-42 (1 file(s))")).toBe("42")
  })

  it("parses lpstat jobs output", () => {
    expect(
      parseLpstatJobsOutput(`
printer-41 bigweld 1024 Mon 09 Mar 2026 08:00:00 PM UTC
printer-42 bigweld 2048 Mon 09 Mar 2026 08:05:00 PM UTC
      `),
    ).toEqual([
      {
        cupsJobId: "41",
        state: "queued",
        title: "printer-41",
      },
      {
        cupsJobId: "42",
        state: "queued",
        title: "printer-42",
      },
    ])
  })

  it("parses lpstat printer output", () => {
    expect(
      parseLpstatPrinterOutput(
        "printer test-printer is idle. enabled since Mon 09 Mar 2026 08:05:00 PM UTC",
      ),
    ).toEqual({
      printerName: "test-printer",
      available: true,
      status: "idle",
    })
  })

  it("parses lpstat device output", () => {
    expect(
      parseLpstatDeviceOutput(
        "device for HP135a: usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
      ),
    ).toEqual({
      printerName: "HP135a",
      deviceUri: "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
    })
  })

  it("parses lpinfo device output", () => {
    expect(
      parseLpinfoDevicesOutput(`
direct usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1
network ipp://printer.local/ipp/print
      `),
    ).toEqual([
      "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
      "ipp://printer.local/ipp/print",
    ])
  })
})
