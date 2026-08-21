import { describe, expect, it } from "@effect/vitest"

import { makeCupsQueueObservation } from "./CupsQueueObservation.js"

describe("CupsQueueObservation", () => {
  it("treats an offline queue as unavailable and the printer as apparently detached", () => {
    const observation = makeCupsQueueObservation({
      queueName: "HP135a",
      acceptingJobs: true,
      state: "stopped",
      reasons: ["offline-report", "connecting-to-device"],
      message: "Unable to communicate with printer",
    })

    expect(observation.available).toBe(false)
    expect(observation.physicalPrinterAppearsAttached).toBe(false)
    expect(observation.state).toBe("stopped")
  })

  it("treats a processing queue as available when no blocking reason is present", () => {
    const observation = makeCupsQueueObservation({
      queueName: "HP135a",
      acceptingJobs: true,
      state: "processing",
      reasons: ["moving-to-paused"],
      message: "Printing page 1",
    })

    expect(observation.available).toBe(true)
    expect(observation.physicalPrinterAppearsAttached).toBe(true)
    expect(observation.state).toBe("processing")
  })

  it.each([
    "media-jam-error",
    "cover-open-warning",
    "offline-warning",
  ])("classifies the base reason in %s", (reason) => {
    const observation = makeCupsQueueObservation({
      queueName: "HP135a",
      acceptingJobs: true,
      state: "idle",
      reasons: [reason],
      message: null,
    })

    expect(observation.available).toBe(false)
    if (reason.startsWith("offline")) {
      expect(observation.physicalPrinterAppearsAttached).toBe(false)
    }
  })
})
