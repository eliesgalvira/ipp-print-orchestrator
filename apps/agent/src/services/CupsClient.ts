import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

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

export class CupsClient extends ServiceMap.Service<
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
    readonly getPrinterDeviceUri: () => Effect.Effect<
      string,
      CupsUnavailable | CupsCommandFailed
    >
    readonly listAvailableDevices: () => Effect.Effect<
      readonly string[],
      CupsUnavailable | CupsCommandFailed
    >
  }
>()("@ipp/agent/CupsClient") {}
