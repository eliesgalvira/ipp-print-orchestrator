import { describe, expect, it } from "@effect/vitest"

import {
  jobAttributesRequestMessage,
  printerAttributesRequestMessage,
} from "./CupsObserverIppLive.js"
import { ippFailureMessage } from "./IppFailureMessage.js"

const operationAttributes = (
  message: Record<string, unknown>,
): Record<string, unknown> =>
  message["operation-attributes-tag"] as Record<string, unknown>

describe("CupsObserverIppLive request messages", () => {
  it("matches the passing ipptool printer attribute request", () => {
    const attrs = operationAttributes(printerAttributesRequestMessage())

    expect(attrs["requested-attributes"]).toEqual(["all", "media-col-database"])
    expect(attrs["printer-uri"]).toBeUndefined()
  })

  it("adds only the required job id for job observation", () => {
    const attrs = operationAttributes(jobAttributesRequestMessage(123))
    expect(attrs["job-id"]).toBe(123)
    expect(attrs["printer-uri"]).toBeUndefined()
  })

  it("includes IPP response diagnostics in failure messages", () => {
    expect(
      ippFailureMessage({
        statusCode: "client-error-bad-request",
        "operation-attributes-tag": {
          "status-message": "Bad URI",
        },
        "unsupported-attributes-tag": {
          "printer-uri": "ipp://localhost/printers/HP135a",
        },
      }),
    ).toBe(
      'IPP request failed: client-error-bad-request (status-message="Bad URI"; unsupported-attributes=printer-uri="ipp://localhost/printers/HP135a")',
    )
  })

  it("includes the failed operation when provided", () => {
    expect(
      ippFailureMessage(
        {
          statusCode: "client-error-bad-request",
        },
        { operation: "Get-Notifications" },
      ),
    ).toBe("IPP Get-Notifications request failed: client-error-bad-request")
  })
})
