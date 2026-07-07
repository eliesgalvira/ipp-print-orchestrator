import { describe, expect, it } from "@effect/vitest"

import { derivePrinterReadiness } from "./PrinterReadiness.js"

describe("printer readiness", () => {
  it("accepts an attached and queue-available printer", () => {
    expect(
      derivePrinterReadiness({
        attached: true,
        queueAvailable: true,
        reasons: [],
        message: null,
      }),
    ).toEqual({ _tag: "Ready" })
  })

  it("uses the printer message as the unavailable reason", () => {
    expect(
      derivePrinterReadiness({
        attached: false,
        queueAvailable: false,
        reasons: ["offline"],
        message: "Printer is offline",
      }),
    ).toEqual({ _tag: "Unavailable", reason: "Printer is offline" })
  })

  it("falls back to reasons and then a stable generic reason", () => {
    expect(
      derivePrinterReadiness({
        attached: true,
        queueAvailable: false,
        reasons: ["paused", "media-empty"],
        message: null,
      }),
    ).toEqual({ _tag: "Unavailable", reason: "paused, media-empty" })

    expect(
      derivePrinterReadiness({
        attached: false,
        queueAvailable: false,
        reasons: [],
        message: null,
      }),
    ).toEqual({ _tag: "Unavailable", reason: "printer unavailable" })
  })
})
