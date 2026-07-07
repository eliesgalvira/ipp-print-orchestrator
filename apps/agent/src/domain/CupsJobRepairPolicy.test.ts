import { describe, expect, it } from "@effect/vitest"

import type { CupsJobObservation } from "../cups-observation/CupsObservation.js"
import { deriveCupsJobRepairAction } from "./CupsJobRepairPolicy.js"
import { Job } from "./Job.js"
import { JobId } from "./JobId.js"

const job = (state: Job["state"], cupsJobId = "42") =>
  new Job({
    id: JobId.make(`job-${state}`),
    requestId: `req-${state}`,
    printerName: "test-printer",
    fileName: "document.pdf",
    mimeType: "application/pdf",
    fileSize: 12,
    state,
    retryCount: 0,
    cupsJobId,
    createdAt: "2026-03-09T00:00:00.000Z",
    updatedAt: "2026-03-09T00:00:00.000Z",
  })

const observation = (
  state: CupsJobObservation["state"],
  overrides: Partial<CupsJobObservation> = {},
): CupsJobObservation => ({
  cupsJobId: "42",
  state,
  reasons: [],
  printerState: null,
  printerStateReasons: [],
  printerStateMessage: null,
  mediaSheetsCompleted: null,
  ...overrides,
})

describe("CUPS job repair policy", () => {
  it("marks missing reported jobs as submission uncertain", () => {
    expect(deriveCupsJobRepairAction(job("Submitted"), null)).toEqual({
      _tag: "SubmissionUncertain",
      reason: "CUPS no longer reports job 42",
    })
  })

  it("does not re-mark an already uncertain missing job", () => {
    expect(
      deriveCupsJobRepairAction(job("SubmissionUncertain"), null),
    ).toBeNull()
  })

  it("maps active CUPS processing to Printing", () => {
    expect(
      deriveCupsJobRepairAction(job("Submitted"), observation("processing")),
    ).toEqual({ _tag: "Printing" })
  })

  it("maps terminal CUPS states to job lifecycle actions", () => {
    expect(
      deriveCupsJobRepairAction(job("Submitted"), observation("completed")),
    ).toEqual({ _tag: "Completed" })
    expect(
      deriveCupsJobRepairAction(job("Submitted"), observation("canceled")),
    ).toEqual({ _tag: "Cancelled" })
    expect(
      deriveCupsJobRepairAction(
        job("Submitted"),
        observation("aborted", {
          printerStateMessage: "backend failed",
        }),
      ),
    ).toEqual({ _tag: "FailedTerminal", reason: "backend failed" })
    expect(
      deriveCupsJobRepairAction(job("Submitted"), observation("aborted")),
    ).toEqual({ _tag: "FailedTerminal", reason: "CUPS reported aborted" })
  })
})
