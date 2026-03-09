import { Context, Effect } from "effect"

import {
  CupsCommandFailed,
  CupsRejectedJob,
  CupsUnavailable,
  SubmissionUncertainError,
} from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"

export interface SubmitResult {
  readonly cupsJobId: string
}

export interface CupsJobSummary {
  readonly cupsJobId: string
  readonly state: string
  readonly title: string
}

export interface PrinterSummary {
  readonly printerName: string
  readonly available: boolean
  readonly status: string
}

export class CupsClient extends Context.Tag("@ipp/agent/CupsClient")<
  CupsClient,
  {
    readonly submitFile: (
      job: Job,
      bytes: Uint8Array,
    ) => Effect.Effect<
      SubmitResult,
      | CupsUnavailable
      | CupsRejectedJob
      | CupsCommandFailed
      | SubmissionUncertainError
    >
    readonly getJobStatus: (
      cupsJobId: string,
    ) => Effect.Effect<CupsJobSummary, CupsUnavailable | CupsCommandFailed>
    readonly listRecentJobs: () => Effect.Effect<
      readonly CupsJobSummary[],
      CupsUnavailable | CupsCommandFailed
    >
    readonly getPrinterSummary: () => Effect.Effect<
      PrinterSummary,
      CupsUnavailable | CupsCommandFailed
    >
  }
>() {}
