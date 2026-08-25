import { describe, expect, it } from "@effect/vitest"
import type { IppMessage } from "@ipp/ipp"

import {
  cupsJobAccountingAnomaly,
  reconcileRetainedCupsJobs,
  retainedJobsRequest,
} from "./CupsJobObservation.js"

const response = (
  jobs: ReadonlyArray<{
    readonly id: number
    readonly state: string
    readonly reasons?: readonly string[]
    readonly sheets?: number | null
    readonly impressions?: number | null
  }>,
): IppMessage => ({
  version: "2.0",
  statusCode: "successful-ok",
  id: 1,
  groups: jobs.map((job) => ({
    tag: "job-attributes-tag",
    attributes: [
      { name: "job-id", value: job.id },
      { name: "job-state", value: job.state },
      { name: "job-state-reasons", value: job.reasons ?? [] },
      ...(job.sheets === undefined
        ? []
        : [{ name: "job-media-sheets-completed", value: job.sheets }]),
      ...(job.impressions === undefined
        ? []
        : [{ name: "job-impressions-completed", value: job.impressions }]),
    ],
  })),
})

describe("CUPS retained job observation", () => {
  it("requests retained jobs and only accounting-safe attributes", () => {
    expect(retainedJobsRequest("ipp://localhost:631/printers/HP135a")).toEqual({
      "operation-attributes-tag": {
        "printer-uri": "ipp://localhost:631/printers/HP135a",
        "requesting-user-name": "ipp-print-orchestrator",
        "which-jobs": "all",
        "requested-attributes": [
          "job-id",
          "job-state",
          "job-state-reasons",
          "job-media-sheets-completed",
          "job-impressions-completed",
        ],
      },
    })
  })

  it("reconstructs retained jobs and emits only changed observations", () => {
    const first = reconcileRetainedCupsJobs(
      new Map(),
      response([
        {
          id: 13,
          state: "completed",
          reasons: ["job-completed-successfully"],
          sheets: 4,
          impressions: 4,
        },
      ]),
    )
    expect(first).toMatchObject({
      _tag: "Reconciled",
      changed: [
        {
          cupsJobId: 13,
          state: "completed",
          reasons: ["job-completed-successfully"],
          mediaSheetsCompleted: 4,
          impressionsCompleted: 4,
        },
      ],
    })
    if (first._tag !== "Reconciled") {
      return
    }

    expect(reconcileRetainedCupsJobs(first.current, response([]))).toEqual({
      _tag: "Reconciled",
      current: new Map(),
      changed: [],
    })
    expect(
      reconcileRetainedCupsJobs(
        first.current,
        response([
          {
            id: 13,
            state: "completed",
            reasons: ["job-completed-successfully"],
            sheets: 4,
            impressions: 4,
          },
        ]),
      ),
    ).toMatchObject({ _tag: "Reconciled", changed: [] })
  })

  it.each([
    ["completed", null, "completed-without-media-sheet-accounting"],
    ["completed", 0, "completed-with-zero-media-sheets"],
    ["aborted", 2, "unsuccessful-with-media-sheets"],
    ["completed", 2, null],
    ["processing", 0, null],
  ] as const)("classifies %s with %s sheets", (state, sheets, expected) => {
    expect(
      cupsJobAccountingAnomaly({
        cupsJobId: 14,
        state,
        reasons: [],
        mediaSheetsCompleted: sheets,
        impressionsCompleted: null,
      }),
    ).toBe(expected)
  })

  it("rejects duplicate retained job identifiers", () => {
    expect(
      reconcileRetainedCupsJobs(
        new Map(),
        response([
          { id: 14, state: "completed", sheets: 2 },
          { id: 14, state: "completed", sheets: 2 },
        ]),
      ),
    ).toEqual({
      _tag: "InvalidResponse",
      message: "Get-Jobs response contains duplicate job-id 14",
    })
  })
})
