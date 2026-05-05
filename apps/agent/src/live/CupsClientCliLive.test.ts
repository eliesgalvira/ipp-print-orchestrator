import { describe, expect, it } from "@effect/vitest"
import { parseIppMessage, serializeIppRequest } from "@ipp/ipp"

import { Job } from "../domain/Job.js"
import { JobId } from "../domain/JobId.js"
import {
  buildPrintJobRequest,
  parseIppSubmitResponse,
  parseLpinfoDevicesOutput,
  parseLpSubmitOutput,
  parseLpstatDeviceOutput,
  parseLpstatJobsOutput,
  parseLpstatPrinterOutput,
} from "./CupsClientCliLive.js"

describe("CupsClientCliLive parsers", () => {
  const job = new Job({
    id: JobId.makeUnsafe("job-test"),
    requestId: "request-test",
    printerName: "HP135a",
    fileName: "print-test-page.pdf",
    mimeType: "application/pdf",
    fileSize: 4,
    state: "Submitting",
    retryCount: 0,
    createdAt: "2026-05-05T00:00:00.000Z",
    updatedAt: "2026-05-05T00:00:00.000Z",
  })

  it("builds phone-style IPP Print-Job requests instead of lp-style page range jobs", () => {
    const request = buildPrintJobRequest(job, Buffer.from("%PDF"))

    expect(request.operation).toBe("Print-Job")
    expect(request.endpoint).toBe("http://localhost:631/printers/HP135a")
    expect(request.printerUri).toBe("ipp://localhost:631/printers/HP135a")
    expect(request.message?.["operation-attributes-tag"]).toEqual({
      "requesting-user-name": "ipp-print-orchestrator",
      "job-name": "print-test-page.pdf",
      "document-format": "application/pdf",
    })
    expect(request.message?.["job-attributes-tag"]).toEqual({
      copies: 1,
      "orientation-requested": "portrait",
      "print-scaling": "none",
      "print-quality": "normal",
      sides: "one-sided",
      "print-color-mode": "monochrome",
    })
    expect(request.message?.["job-attributes-tag"]).not.toHaveProperty(
      "page-ranges",
    )
  })

  it("parses IPP Print-Job response job ids", () => {
    expect(
      parseIppSubmitResponse({
        statusCode: "successful-ok",
        "job-attributes-tag": {
          "job-id": 43,
        },
      }),
    ).toBe("43")
  })

  it("serializes the Print-Job attributes used by the live submit path", () => {
    const request = buildPrintJobRequest(job, Buffer.from("%PDF"))
    const parsed = parseIppMessage(serializeIppRequest(request))

    expect(parsed).toMatchObject({
      operation: "Print-Job",
      "operation-attributes-tag": {
        "printer-uri": "ipp://localhost:631/printers/HP135a",
        "job-name": "print-test-page.pdf",
        "document-format": "application/pdf",
      },
      "job-attributes-tag": {
        "print-scaling": "none",
        "print-color-mode": "monochrome",
        sides: "one-sided",
      },
    })
    expect(parsed.data?.toString()).toBe("%PDF")
  })

  it("parses lp submit output", () => {
    expect(parseLpSubmitOutput("request id is printer-42 (1 file(s))")).toBe(
      "42",
    )
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

  it("parses lpstat printer output while actively printing", () => {
    expect(
      parseLpstatPrinterOutput(
        "printer HP135a now printing HP135a-21. enabled since Mon 09 Mar 2026 08:05:00 PM UTC",
      ),
    ).toEqual({
      printerName: "HP135a",
      available: true,
      status: "printing",
    })
  })

  it("parses lpstat device output", () => {
    expect(
      parseLpstatDeviceOutput(
        "device for HP135a: usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
      ),
    ).toEqual({
      printerName: "HP135a",
      deviceUri:
        "usb://HP/Laser%20MFP%20131%20133%20135-138?serial=ABC123&interface=1",
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
