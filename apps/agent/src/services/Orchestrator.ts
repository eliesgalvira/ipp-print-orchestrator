import { Clock, Context, Effect, Layer } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import {
  type OperationalError,
  UnsupportedFileType,
} from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"
import type { JobId } from "../domain/JobId.js"
import { createJob, transitionJob } from "../domain/StateMachine.js"
import { WideEvent } from "../domain/WideEvent.js"
import { BlobStore } from "./BlobStore.js"
import { CupsClient, type SubmitResult } from "./CupsClient.js"
import { EventSink } from "./EventSink.js"
import { JobRepo } from "./JobRepo.js"
import { NetworkProbe } from "./NetworkProbe.js"
import { PrinterProbe } from "./PrinterProbe.js"
import { QueueRuntime } from "./QueueRuntime.js"
import { Telemetry } from "./Telemetry.js"

export interface SubmitJobInput {
  readonly id: JobId
  readonly requestId: string
  readonly fileName: string
  readonly mimeType: string
  readonly bytes: Uint8Array
}

export class Orchestrator extends Context.Tag("@ipp/agent/Orchestrator")<
  Orchestrator,
  {
    readonly submit: (
      input: SubmitJobInput,
    ) => Effect.Effect<Job, OperationalError>
    readonly processJob: (
      jobId: JobId,
    ) => Effect.Effect<Job, OperationalError>
  }
>() {
  static readonly layer = Layer.effect(
    Orchestrator,
    Effect.gen(function* () {
      const config = yield* AppConfig
      const blobStore = yield* BlobStore
      const jobRepo = yield* JobRepo
      const eventSink = yield* EventSink
      const telemetry = yield* Telemetry
      const cupsClient = yield* CupsClient
      const printerProbe = yield* PrinterProbe
      const networkProbe = yield* NetworkProbe
      const queueRuntime = yield* QueueRuntime

      const persistEvent = (event: WideEvent) =>
        eventSink.append(event).pipe(
          Effect.zipRight(telemetry.emit(event).pipe(Effect.catchAll(() => Effect.void))),
        )

      const nowIso = Effect.map(Clock.currentTimeMillis, (millis) =>
        new Date(millis).toISOString(),
      )

      const persistTransition = (job: Job, event: WideEvent) =>
        jobRepo.save(job).pipe(
          Effect.zipRight(jobRepo.appendTransition(job.id, event)),
          Effect.zipRight(persistEvent(event)),
          Effect.as(job),
        )

      const applyTransition = (
        job: Job,
        action: Parameters<typeof transitionJob>[1],
        occurredAt: string,
      ) => {
        const result = transitionJob(job, action, occurredAt)
        if (result._tag === "InvalidTransition") {
          return Effect.dieMessage(result.reason)
        }
        return persistTransition(result.job, result.event)
      }

      const buildReceivedEvent = (job: Job, occurredAt: string) =>
        WideEvent.make({
          timestamp: occurredAt,
          eventName: "print.request.received",
          requestId: job.requestId,
          printId: job.id,
          printerName: job.printerName,
          fileName: job.fileName,
          mimeType: job.mimeType,
          fileSize: job.fileSize,
          retryCount: job.retryCount,
          currentState: job.state,
        })

      const submit: (
        input: SubmitJobInput,
      ) => Effect.Effect<Job, OperationalError> = Effect.fn(
        "Orchestrator.submit",
      )(function* (input: SubmitJobInput) {
        if (
          input.mimeType !== "application/pdf" &&
          input.mimeType !== "text/plain" &&
          input.mimeType !== "application/octet-stream"
        ) {
          return yield* UnsupportedFileType.make({
            message: `unsupported mime type: ${input.mimeType}`,
          })
        }

        const occurredAt = yield* nowIso

        const initialJob = createJob({
          id: input.id,
          requestId: input.requestId,
          printerName: config.printerName,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.bytes.byteLength,
          createdAt: occurredAt,
        })

        yield* blobStore.putOriginal(input.id, input.fileName, input.bytes)
        yield* jobRepo.create(initialJob)
        const receivedEvent = buildReceivedEvent(initialJob, occurredAt)
        yield* jobRepo.appendTransition(initialJob.id, receivedEvent)
        yield* persistEvent(receivedEvent)

        const storedJob = yield* applyTransition(initialJob, { _tag: "Stored" }, occurredAt)
        const queuedJob = yield* applyTransition(storedJob, { _tag: "Queued" }, occurredAt)

        yield* queueRuntime.enqueue(queuedJob.id)

        return queuedJob
      })

      const processJob: (
        jobId: JobId,
      ) => Effect.Effect<Job, OperationalError> = Effect.fn(
        "Orchestrator.processJob",
      )(function* (jobId: JobId) {
        const network = yield* networkProbe.status()
        if (!network.online) {
          yield* Effect.void
        }
        const currentJob = yield* jobRepo.get(jobId)
        if (
          currentJob.state === "Completed" ||
          currentJob.state === "Cancelled" ||
          currentJob.state === "FailedTerminal" ||
          currentJob.state === "SubmissionUncertain"
        ) {
          return currentJob
        }

        const printer = yield* printerProbe.status()
        const occurredAt = yield* nowIso

        if (!printer.attached || !printer.queueAvailable) {
          return yield* applyTransition(
            currentJob,
            { _tag: "PrinterUnavailable", reason: "printer unavailable" },
            occurredAt,
          )
        }

        const submittingJob =
          currentJob.state === "Submitting"
            ? currentJob
            : yield* applyTransition(
                currentJob,
                { _tag: "SubmissionAttemptStarted" },
                occurredAt,
              )

        const bytes = yield* blobStore.getOriginal(jobId)

        const submitResult: SubmitResult | Job = yield* cupsClient
          .submitFile(submittingJob, bytes)
          .pipe(
            Effect.catchAll((error) => {
              switch (error._tag) {
                case "CupsUnavailable":
                  return Effect.gen(function* () {
                    const waitingAt = yield* nowIso
                    const waitingJob = yield* applyTransition(
                      submittingJob,
                      { _tag: "CupsUnavailable", reason: error.message },
                      waitingAt,
                    )
                    const retryAt = yield* nowIso
                    const retryJob = yield* applyTransition(
                      waitingJob,
                      { _tag: "RetryScheduled", reason: error.message },
                      retryAt,
                    )
                    yield* Effect.sleep(config.reconcileIntervalMs)
                    return yield* processJob(retryJob.id)
                  })
                case "SubmissionUncertain":
                  return applyTransition(
                    submittingJob,
                    { _tag: "SubmissionUncertain", reason: error.message },
                    occurredAt,
                  )
                case "CupsRejectedJob":
                case "CupsCommandFailed":
                  return applyTransition(
                    submittingJob,
                    { _tag: "FailedTerminal", reason: error.message },
                    occurredAt,
                  )
                default:
                  return Effect.die(error)
              }
            }),
        )

        if ("state" in submitResult) {
          return submitResult
        }

        return yield* applyTransition(
          submittingJob,
          { _tag: "Submitted", cupsJobId: submitResult.cupsJobId },
          yield* nowIso,
        )
      })

      return Orchestrator.of({
        submit,
        processJob,
      })
    }),
  )
}
