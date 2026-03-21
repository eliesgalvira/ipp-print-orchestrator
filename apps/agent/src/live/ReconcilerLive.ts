import { Clock } from "effect"
import { Effect, Layer } from "effect"

import { CupsObserver } from "../cups-observation/CupsObserver.js"
import type { CupsJobObservation } from "../cups-observation/CupsObservation.js"
import { StartupRecoveryFailed } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"
import { transitionJob } from "../domain/StateMachine.js"
import { WideEvent } from "../domain/WideEvent.js"
import {
  makeJobOutcomeEvent,
  WideEventPublisher,
} from "../observability/WideEventPublisher.js"
import { JobRepo } from "../services/JobRepo.js"
import { QueueRuntime } from "../services/QueueRuntime.js"
import { Reconciler } from "../services/Reconciler.js"

const requeueableStates = new Set<string>([
  "Queued",
  "WaitingForPrinter",
  "WaitingForCups",
  "RetryScheduled",
])

const cupsTrackedStates = new Set<string>([
  "Submitted",
  "Printing",
  "SubmissionUncertain",
])

export const ReconcilerLive = Layer.effect(
  Reconciler,
  Effect.gen(function* () {
    const jobRepo = yield* JobRepo
    const queueRuntime = yield* QueueRuntime
    const wideEventPublisher = yield* WideEventPublisher
    const cupsObserver = yield* CupsObserver

    const emitEvent = (event: WideEvent) => wideEventPublisher.emit(event)

    const persistTransition = (job: Job, event: WideEvent) =>
      Effect.gen(function* () {
        yield* jobRepo.save(job)
        yield* jobRepo.appendTransition(job.id, event)
        yield* emitEvent(event)

        const outcomeEvent = makeJobOutcomeEvent({
          timestamp: event.timestamp,
          job,
          finalState: job.state,
          errorTag: event.errorTag,
          errorMessage: event.errorMessage,
        })

        if (outcomeEvent !== null) {
          yield* emitEvent(outcomeEvent)
        }
      })

    const applyObservedJobState = (
      job: Job,
      observation: CupsJobObservation | null,
    ) =>
      Effect.gen(function* () {
        if (observation === null) {
          if (job.state === "SubmissionUncertain") {
            return
          }

          const occurredAt = new Date(yield* Clock.currentTimeMillis).toISOString()
          const result = transitionJob(
            job,
            {
              _tag: "SubmissionUncertain",
              reason: `CUPS no longer reports job ${job.cupsJobId ?? "unknown"}`,
            },
            occurredAt,
          )
          if (result._tag === "InvalidTransition") {
            return yield* Effect.dieMessage(result.reason)
          }

          return yield* persistTransition(result.job, result.event).pipe(
            Effect.mapError((error) =>
              StartupRecoveryFailed.make({ message: String(error) }),
            ),
          )
        }

        yield* Effect.annotateCurrentSpan({
          "cups.job_state": observation.state,
          "cups.job_state_reasons": observation.reasons.join(","),
        })

        const occurredAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        switch (observation.state) {
          case "processing":
          case "processing-stopped": {
            if (job.state === "Printing") {
              return
            }
            const result = transitionJob(job, { _tag: "Printing" }, occurredAt)
            if (result._tag === "InvalidTransition") {
              return yield* Effect.dieMessage(result.reason)
            }
            return yield* persistTransition(result.job, result.event).pipe(
              Effect.mapError((error) =>
                StartupRecoveryFailed.make({ message: String(error) }),
              ),
            )
          }
          case "completed": {
            const result = transitionJob(job, { _tag: "Completed" }, occurredAt)
            if (result._tag === "InvalidTransition") {
              return yield* Effect.dieMessage(result.reason)
            }
            return yield* persistTransition(result.job, result.event).pipe(
              Effect.mapError((error) =>
                StartupRecoveryFailed.make({ message: String(error) }),
              ),
            )
          }
          case "canceled": {
            const result = transitionJob(job, { _tag: "Cancelled" }, occurredAt)
            if (result._tag === "InvalidTransition") {
              return yield* Effect.dieMessage(result.reason)
            }
            return yield* persistTransition(result.job, result.event).pipe(
              Effect.mapError((error) =>
                StartupRecoveryFailed.make({ message: String(error) }),
              ),
            )
          }
          case "aborted": {
            const reason =
              observation.printerStateMessage ??
              observation.reasons.join(", ") ??
              "CUPS reported aborted"
            const result = transitionJob(
              job,
              { _tag: "FailedTerminal", reason },
              occurredAt,
            )
            if (result._tag === "InvalidTransition") {
              return yield* Effect.dieMessage(result.reason)
            }
            return yield* persistTransition(result.job, result.event).pipe(
              Effect.mapError((error) =>
                StartupRecoveryFailed.make({ message: String(error) }),
              ),
            )
          }
          default:
            return
        }
      })

    const reconcileCupsTrackedJob = (job: Job) =>
      Effect.gen(function* () {
        if (job.cupsJobId === undefined) {
          return
        }

        const observation = yield* cupsObserver.observeJob(job.cupsJobId).pipe(
          Effect.catchTag("CupsIppJobNotFound", () => Effect.succeed(null)),
          Effect.mapError((error) =>
            StartupRecoveryFailed.make({
              message: error.message,
            }),
          ),
        )

        yield* applyObservedJobState(job, observation)
      })

    const reconcileStartup = Effect.fn("Reconciler.reconcileStartup")(function* () {
      const startedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
      const startedEvent = WideEvent.make({
        timestamp: startedAt,
        eventName: "startup.reconciliation.started",
      })
      yield* emitEvent(startedEvent).pipe(
        Effect.mapError((error) =>
          StartupRecoveryFailed.make({ message: String(error) }),
        ),
      )

      const jobs = yield* jobRepo.listNonTerminal().pipe(
        Effect.mapError((error) =>
          StartupRecoveryFailed.make({ message: error.message }),
        ),
      )

      yield* Effect.forEach(jobs, (job) =>
        requeueableStates.has(job.state)
          ? queueRuntime.enqueue(job.id).pipe(
              Effect.mapError((error) =>
                StartupRecoveryFailed.make({ message: String(error) }),
              ),
            )
          : cupsTrackedStates.has(job.state)
            ? reconcileCupsTrackedJob(job)
            : Effect.void,
      )

      const completedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
      const completedEvent = WideEvent.make({
        timestamp: completedAt,
        eventName: "startup.reconciliation.completed",
      })
      yield* emitEvent(completedEvent).pipe(
        Effect.mapError((error) =>
          StartupRecoveryFailed.make({ message: String(error) }),
        ),
      )

      return jobs
    })

    return Reconciler.of({
      reconcileStartup,
    })
  }),
)
