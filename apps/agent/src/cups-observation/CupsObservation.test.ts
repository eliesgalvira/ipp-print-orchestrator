import { describe, expect, it } from "@effect/vitest"

import {
  makeJobObservation,
  makePrinterObservation,
} from "./CupsObservation.js"

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

  it("maps terminal CUPS job states explicitly", () => {
    const canceled = makeJobObservation({
      cupsJobId: "42",
      state: "canceled",
      reasons: ["job-canceled-at-device"],
      printerState: "idle",
      printerStateReasons: [],
      printerStateMessage: null,
      mediaSheetsCompleted: 1,
    })

    const aborted = makeJobObservation({
      cupsJobId: "43",
      state: "aborted",
      reasons: ["aborted-by-system"],
      printerState: "stopped",
      printerStateReasons: ["media-empty"],
      printerStateMessage: "Out of paper",
      mediaSheetsCompleted: 0,
    })

    expect(canceled.state).toBe("canceled")
    expect(aborted.state).toBe("aborted")
    expect(aborted.printerStateMessage).toBe("Out of paper")
  })
})
