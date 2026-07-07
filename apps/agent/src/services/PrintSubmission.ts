import { Context, Effect, Layer } from "effect"

import type {
  CupsCommandFailed,
  CupsRejectedJob,
  CupsUnavailable,
  SubmissionUncertainError,
} from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"
import { CupsClient, type SubmitResult } from "./CupsClient.js"

export class PrintSubmission extends Context.Service<
  PrintSubmission,
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
>()("@ipp/agent/services/PrintSubmission") {
  static readonly fromCupsClientLayer = Layer.effect(
    PrintSubmission,
    Effect.gen(function* () {
      const cupsClient = yield* CupsClient

      return PrintSubmission.of({
        submitFile: cupsClient.submitFile,
      })
    }),
  )
}
