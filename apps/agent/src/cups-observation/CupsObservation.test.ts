import { describe, expect, it } from "@effect/vitest"

import { makePrinterObservation } from "./CupsObservation.js"

describe("CupsObservation", () => {
  it("treats offline-report as detached and unavailable", () => {
    const observation = makePrinterObservation({
      printerName: "HP135a",
      acceptingJobs: true,
      state: "stopped",
      reasons: ["offline-report", "connecting-to-device"],
      message: "Unable to communicate with printer",
    })

    expect(observation.attached).toBe(false)
    expect(observation.queueAvailable).toBe(false)
    expect(observation.state).toBe("stopped")
  })

  it("treats processing printers as attached", () => {
    const observation = makePrinterObservation({
      printerName: "HP135a",
      acceptingJobs: true,
      state: "processing",
      reasons: ["moving-to-paused"],
      message: "Printing page 1",
    })

    expect(observation.attached).toBe(true)
    expect(observation.state).toBe("processing")
  })

  it.each([
    "media-jam-error",
    "cover-open-warning",
    "offline-warning",
  ])("classifies the base reason in %s", (reason) => {
    const observation = makePrinterObservation({
      printerName: "HP135a",
      acceptingJobs: true,
      state: "idle",
      reasons: [reason],
      message: null,
    })

    expect(observation.queueAvailable).toBe(false)
    if (reason.startsWith("offline")) {
      expect(observation.attached).toBe(false)
    }
  })
})
