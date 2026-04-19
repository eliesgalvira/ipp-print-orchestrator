import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { requestIpp } from "./client.js"
import { parseIppMessage, serializeIppResponse } from "./codec.js"

describe("IPP client transport", () => {
  let closeServer: (() => Promise<void>) | null = null

  afterEach(async () => {
    await closeServer?.()
    closeServer = null
  })

  it("posts IPP bytes and parses the binary response", async () => {
    let capturedRequest: ReturnType<typeof parseIppMessage> | null = null

    const server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })
      request.on("end", () => {
        capturedRequest = parseIppMessage(Buffer.concat(chunks))
        response.statusCode = 200
        response.setHeader("content-type", "application/ipp")
        response.end(
          serializeIppResponse({
            statusCode: "successful-ok",
            requestId: 123,
            message: {
              "printer-attributes-tag": {
                "printer-name": "Test_Printer",
                "printer-state": "idle",
                "printer-is-accepting-jobs": true,
              },
            },
          }),
        )
      })
    })

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve())
    })

    closeServer = () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })

    const address = server.address() as AddressInfo
    const response = await Effect.runPromise(
      requestIpp({
        endpoint: `http://127.0.0.1:${address.port}/printers/Test_Printer`,
        printerUri: "ipp://127.0.0.1/printers/Test_Printer",
        operation: "Get-Printer-Attributes",
        message: {
          "operation-attributes-tag": {
            "requested-attributes": ["printer-name", "printer-state"],
          },
        },
      }),
    )

    expect(capturedRequest).toEqual({
      version: "2.0",
      operation: "Get-Printer-Attributes",
      id: expect.any(Number),
      "operation-attributes-tag": {
        "attributes-charset": "utf-8",
        "attributes-natural-language": "en",
        "printer-uri": "ipp://127.0.0.1/printers/Test_Printer",
        "requested-attributes": ["printer-name", "printer-state"],
      },
    })

    expect(response).toEqual({
      version: "2.0",
      statusCode: "successful-ok",
      id: 123,
      "printer-attributes-tag": {
        "printer-name": "Test_Printer",
        "printer-state": "idle",
        "printer-is-accepting-jobs": true,
      },
    })
  })
})
