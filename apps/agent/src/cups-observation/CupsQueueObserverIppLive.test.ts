import { describe, expect, it } from "@effect/vitest"

import { printerAttributesRequestMessage } from "./CupsQueueObserverIppLive.js"
import { ippFailureMessage } from "./IppFailureMessage.js"

describe("CupsQueueObserverIppLive", () => {
  it("matches the passing ipptool printer attribute request", () => {
    const attrs = printerAttributesRequestMessage()["operation-attributes-tag"]

    expect(attrs?.["requested-attributes"]).toEqual([
      "all",
      "media-col-database",
    ])
    expect(attrs?.["printer-uri"]).toBeUndefined()
  })

  it("includes every IPP failure attribute without flattening", () => {
    expect(
      ippFailureMessage({
        version: "2.0",
        statusCode: "client-error-bad-request",
        id: 1,
        groups: [
          {
            tag: "operation-attributes-tag",
            attributes: [{ name: "status-message", value: "Bad URI" }],
          },
          {
            tag: "unsupported-attributes-tag",
            attributes: [
              {
                name: "printer-uri",
                value: "ipp://localhost/printers/HP135a",
              },
            ],
          },
        ],
      }),
    ).toBe(
      'IPP request failed: client-error-bad-request (status-message="Bad URI"; unsupported-attributes=printer-uri="ipp://localhost/printers/HP135a")',
    )
  })

  it("includes the failed operation when provided", () => {
    expect(
      ippFailureMessage(
        {
          version: "2.0",
          statusCode: "client-error-bad-request",
          id: 1,
          groups: [],
        },
        { operation: "Get-Notifications" },
      ),
    ).toBe("IPP Get-Notifications request failed: client-error-bad-request")
  })
})
