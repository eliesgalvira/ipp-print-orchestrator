import { Effect, Layer } from "effect"

import {
  CupsCommandFailed,
  CupsRejectedJob,
  CupsUnavailable,
  SubmissionUncertainError,
} from "../../../apps/agent/src/domain/Errors.js"
import type { Job } from "../../../apps/agent/src/domain/Job.js"
import {
  CupsClient,
  type CupsJobSummary,
  type PrinterSummary,
  type SubmitResult,
} from "../../../apps/agent/src/services/CupsClient.js"
import { makeFaultScript } from "./FaultScript.js"

export type CupsSubmitStep =
  | { readonly _tag: "Submitted"; readonly cupsJobId: string }
  | { readonly _tag: "CupsUnavailable"; readonly message: string }
  | { readonly _tag: "CupsRejectedJob"; readonly message: string }
  | { readonly _tag: "CupsCommandFailed"; readonly message: string }
  | { readonly _tag: "SubmissionUncertain"; readonly message: string }

export const layer = (steps: readonly [CupsSubmitStep, ...readonly CupsSubmitStep[]]) =>
  Layer.effect(
    CupsClient,
    Effect.gen(function* () {
      const script = yield* makeFaultScript(steps)

      const submitFile: (
        job: Job,
        bytes: Uint8Array,
      ) => Effect.Effect<
        SubmitResult,
        | CupsUnavailable
        | CupsRejectedJob
        | CupsCommandFailed
        | SubmissionUncertainError
      > = (_job, _bytes) =>
        script.next.pipe(
          Effect.flatMap((step): Effect.Effect<
            SubmitResult,
            | CupsUnavailable
            | CupsRejectedJob
            | CupsCommandFailed
            | SubmissionUncertainError
          > => {
            switch (step._tag) {
              case "Submitted":
                return Effect.succeed({ cupsJobId: step.cupsJobId })
              case "CupsUnavailable":
                return Effect.fail(new CupsUnavailable({ message: step.message }))
              case "CupsRejectedJob":
                return Effect.fail(new CupsRejectedJob({ message: step.message }))
              case "CupsCommandFailed":
                return Effect.fail(new CupsCommandFailed({ message: step.message }))
              case "SubmissionUncertain":
                return Effect.fail(
                  new SubmissionUncertainError({ message: step.message }),
                )
            }
          }),
        )

      const getJobStatus = (cupsJobId: string) =>
        Effect.succeed({
          cupsJobId,
          state: "submitted",
          title: "scripted job",
        } satisfies CupsJobSummary)

      const listRecentJobs = () =>
        Effect.succeed([
          {
            cupsJobId: "scripted-1",
            state: "submitted",
            title: "scripted job",
          } satisfies CupsJobSummary,
        ] as const)

      const getPrinterSummary = () =>
        Effect.succeed({
          printerName: "test-printer",
          available: true,
          status: "idle",
        } satisfies PrinterSummary)

      const getPrinterDeviceUri = () =>
        Effect.succeed(
          "usb://test-printer?serial=scripted&interface=1",
        )

      const listAvailableDevices = () =>
        Effect.succeed([
          "usb://test-printer?serial=scripted&interface=1",
        ] as const)

      return CupsClient.of({
        submitFile,
        getJobStatus,
        listRecentJobs,
        getPrinterSummary,
        getPrinterDeviceUri,
        listAvailableDevices,
      })
    }),
  )
