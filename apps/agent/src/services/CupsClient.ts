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
  }
>() {}
