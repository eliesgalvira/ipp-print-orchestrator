import { describe, expect, it } from "@effect/vitest"

import {
  parseIppMessage,
  serializeIppRequest,
  serializeIppResponse,
  validateIppMessage,
} from "./codec.js"

describe("IPP codec", () => {
  it("preserves repeated complete attributes instead of overwriting them", () => {
    const attribute = (name: string, value: string) => {
      const nameBytes = Buffer.from(name, "ascii")
      const valueBytes = Buffer.from(value, "ascii")
      const lengths = Buffer.alloc(4)
      lengths.writeUInt16BE(nameBytes.length, 0)
      lengths.writeUInt16BE(valueBytes.length, 2)
      return Buffer.concat([
        Buffer.from([0x44]),
        lengths.subarray(0, 2),
        nameBytes,
        lengths.subarray(2),
        valueBytes,
      ])
    }
    const payload = Buffer.concat([
      Buffer.from("020000000000000104", "hex"),
      attribute("media-default", "A4"),
      attribute("media-default", "iso_a4_210x297mm"),
      Buffer.from([0x03]),
    ])

    const parsed = parseIppMessage(payload)

    expect(parsed).toEqual({
      version: "2.0",
      statusCode: "successful-ok",
      id: 1,
      groups: [
        {
          tag: "printer-attributes-tag",
          attributes: [
            { name: "media-default", value: "A4" },
            { name: "media-default", value: "iso_a4_210x297mm" },
          ],
        },
      ],
    })
    expect(() => validateIppMessage(parsed)).toThrow(
      expect.objectContaining({
        _tag: "IppDuplicateAttributeError",
        group: "printer-attributes-tag",
        name: "media-default",
        occurrences: 2,
      }),
    )
  })

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
      groups: [
        {
          tag: "operation-attributes-tag",
          attributes: [
            { name: "attributes-charset", value: "utf-8" },
            { name: "attributes-natural-language", value: "en" },
          ],
        },
      ],
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
      groups: [
        {
          tag: "operation-attributes-tag",
          attributes: [
            { name: "attributes-charset", value: "utf-8" },
            { name: "attributes-natural-language", value: "en" },
            {
              name: "printer-uri",
              value: "ipp://localhost:631/printers/Test_Printer",
            },
            {
              name: "requesting-user-name",
              value: "ipp-print-orchestrator",
            },
          ],
        },
        {
          tag: "subscription-attributes-tag",
          attributes: [
            { name: "notify-pull-method", value: "ippget" },
            {
              name: "notify-events",
              value: ["printer-state-changed", "printer-modified"],
            },
            { name: "notify-lease-duration", value: 0 },
          ],
        },
      ],
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
      groups: [
        {
          tag: "operation-attributes-tag",
          attributes: [
            { name: "attributes-charset", value: "utf-8" },
            { name: "attributes-natural-language", value: "en" },
            {
              name: "printer-uri",
              value: "ipp://localhost:631/printers/Test_Printer",
            },
            { name: "job-name", value: "Quarterly report" },
            { name: "document-format", value: "application/pdf" },
          ],
        },
        {
          tag: "job-attributes-tag",
          attributes: [
            { name: "copies", value: 2 },
            { name: "finishings", value: "staple" },
            { name: "orientation-requested", value: "landscape" },
            { name: "print-quality", value: "high" },
            { name: "printer-resolution", value: [600, 600, "dpi"] },
            { name: "job-hold-until-time", value: submittedAt },
          ],
        },
      ],
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
      groups: [
        {
          tag: "printer-attributes-tag",
          attributes: [
            { name: "printer-name", value: "Test_Printer" },
            { name: "printer-state", value: "idle" },
            { name: "printer-is-accepting-jobs", value: true },
          ],
        },
      ],
    })
  })
})
