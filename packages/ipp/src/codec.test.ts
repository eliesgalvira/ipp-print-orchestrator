import { describe, expect, it } from "@effect/vitest"

import {
  parseIppMessage,
  serializeIppRequest,
  serializeIppResponse,
} from "./codec.js"

describe("IPP codec", () => {
  it("parses a minimal Get-Printer-Attributes request", () => {
    const payload = Buffer.from(
      "0200" +
        "000B" +
        "00000001" +
        "01" +
        "470012617474726962757465732d6368617273657400057574662d38" +
        "48001b617474726962757465732d6e61747572616c2d6c616e67756167650002656e" +
        "03",
      "hex",
    )

    expect(parseIppMessage(payload)).toEqual({
      version: "2.0",
      operation: "Get-Printer-Attributes",
      id: 1,
      "operation-attributes-tag": {
        "attributes-charset": "utf-8",
        "attributes-natural-language": "en",
      },
    })
  })

  it("preserves subscription attributes when requests are serialized", () => {
    const bytes = serializeIppRequest({
      operation: "Create-Printer-Subscriptions",
      printerUri: "ipp://localhost:631/printers/Test_Printer",
      requestId: 42,
      message: {
        "operation-attributes-tag": {
          "requesting-user-name": "ipp-print-orchestrator",
        },
        "subscription-attributes-tag": {
          "notify-pull-method": "ippget",
          "notify-events": ["printer-state-changed", "printer-modified"],
          "notify-lease-duration": 0,
        },
      },
    })

    expect(parseIppMessage(bytes)).toEqual({
      version: "2.0",
      operation: "Create-Printer-Subscriptions",
      id: 42,
      "operation-attributes-tag": {
        "attributes-charset": "utf-8",
        "attributes-natural-language": "en",
        "printer-uri": "ipp://localhost:631/printers/Test_Printer",
        "requesting-user-name": "ipp-print-orchestrator",
      },
      "subscription-attributes-tag": {
        "notify-pull-method": "ippget",
        "notify-events": ["printer-state-changed", "printer-modified"],
        "notify-lease-duration": 0,
      },
    })
  })

  it("roundtrips common job attribute types without losing meaning", () => {
    const submittedAt = new Date("2026-04-19T12:34:56.700Z")
    const bytes = serializeIppRequest({
      operation: "Get-Job-Attributes",
      printerUri: "ipp://localhost:631/printers/Test_Printer",
      requestId: 7,
      message: {
        "operation-attributes-tag": {
          "job-name": "Quarterly report",
          "document-format": "application/pdf",
        },
        "job-attributes-tag": {
          copies: 2,
          finishings: "staple",
          "orientation-requested": "landscape",
          "print-quality": "high",
          "printer-resolution": [600, 600, "dpi"],
          "job-hold-until-time": submittedAt,
        },
      },
    })

    expect(parseIppMessage(bytes)).toEqual({
      version: "2.0",
      operation: "Get-Job-Attributes",
      id: 7,
      "operation-attributes-tag": {
        "attributes-charset": "utf-8",
        "attributes-natural-language": "en",
        "printer-uri": "ipp://localhost:631/printers/Test_Printer",
        "job-name": "Quarterly report",
        "document-format": "application/pdf",
      },
      "job-attributes-tag": {
        copies: 2,
        finishings: "staple",
        "orientation-requested": "landscape",
        "print-quality": "high",
        "printer-resolution": [600, 600, "dpi"],
        "job-hold-until-time": submittedAt,
      },
    })
  })

  it("serializes simple successful responses for local fixtures and transport tests", () => {
    const bytes = serializeIppResponse({
      statusCode: "successful-ok",
      requestId: 99,
      message: {
        "printer-attributes-tag": {
          "printer-name": "Test_Printer",
          "printer-state": "idle",
          "printer-is-accepting-jobs": true,
        },
      },
    })

    expect(parseIppMessage(bytes)).toEqual({
      version: "2.0",
      statusCode: "successful-ok",
      id: 99,
      "printer-attributes-tag": {
        "printer-name": "Test_Printer",
        "printer-state": "idle",
        "printer-is-accepting-jobs": true,
      },
    })
  })
})
