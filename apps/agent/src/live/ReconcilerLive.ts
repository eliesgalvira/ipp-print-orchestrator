import { Clock, Effect, Layer, Match } from "effect"
import type { CupsJobObservation } from "../cups-observation/CupsObservation.js"
import { CupsObserver } from "../cups-observation/CupsObserver.js"
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

type ReconcilerService = typeof Reconciler.Service

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

          const occurredAt = new Date(
            yield* Clock.currentTimeMillis,
          ).toISOString()
          const result = transitionJob(
            job,
            {
              _tag: "SubmissionUncertain",
              reason: `CUPS no longer reports job ${job.cupsJobId ?? "unknown"}`,
            },
            occurredAt,
          )
          if (result._tag === "InvalidTransition") {
            return yield* Effect.die(new Error(result.reason))
          }

          return yield* persistTransition(result.job, result.event).pipe(
            Effect.mapError(
              (error) => new StartupRecoveryFailed({ message: String(error) }),
            ),
          )
        }

        yield* Effect.annotateCurrentSpan({
          "cups.job_state": observation.state,
          "cups.job_state_reasons": observation.reasons.join(","),
        })

        const occurredAt = new Date(
          yield* Clock.currentTimeMillis,
        ).toISOString()
        return yield* Match.value(observation.state).pipe(
          Match.whenOr("processing", "processing-stopped", () =>
            Effect.gen(function* () {
              if (job.state === "Printing") {
                return
              }
              const result = transitionJob(
                job,
                { _tag: "Printing" },
                occurredAt,
              )
              if (result._tag === "InvalidTransition") {
                return yield* Effect.die(new Error(result.reason))
              }
              return yield* persistTransition(result.job, result.event).pipe(
                Effect.mapError(
                  (error) =>
                    new StartupRecoveryFailed({ message: String(error) }),
                ),
              )
            }),
          ),
          Match.when("completed", () =>
            Effect.gen(function* () {
              const result = transitionJob(
                job,
                { _tag: "Completed" },
                occurredAt,
              )
              if (result._tag === "InvalidTransition") {
                return yield* Effect.die(new Error(result.reason))
              }
              return yield* persistTransition(result.job, result.event).pipe(
                Effect.mapError(
                  (error) =>
                    new StartupRecoveryFailed({ message: String(error) }),
                ),
              )
            }),
          ),
          Match.when("canceled", () =>
            Effect.gen(function* () {
              const result = transitionJob(
                job,
                { _tag: "Cancelled" },
                occurredAt,
              )
              if (result._tag === "InvalidTransition") {
                return yield* Effect.die(new Error(result.reason))
              }
              return yield* persistTransition(result.job, result.event).pipe(
                Effect.mapError(
                  (error) =>
                    new StartupRecoveryFailed({ message: String(error) }),
                ),
              )
            }),
          ),
          Match.when("aborted", () =>
            Effect.gen(function* () {
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
                return yield* Effect.die(new Error(result.reason))
              }
              return yield* persistTransition(result.job, result.event).pipe(
                Effect.mapError(
                  (error) =>
                    new StartupRecoveryFailed({ message: String(error) }),
                ),
              )
            }),
          ),
          Match.orElse(() => Effect.void),
        )
      })

    const reconcileCupsTrackedJob = (job: Job) =>
      Effect.gen(function* () {
        if (job.cupsJobId === undefined) {
          return
        }

        const observation = yield* cupsObserver.observeJob(job.cupsJobId).pipe(
          Effect.catchTag("CupsIppJobNotFound", () => Effect.succeed(null)),
          Effect.mapError(
            (error) =>
              new StartupRecoveryFailed({
                message: error.message,
              }),
          ),
        )

        yield* applyObservedJobState(job, observation)
      })

    const rehydrateRetryableJobs: ReconcilerService["rehydrateRetryableJobs"] =
      Effect.fn("Reconciler.rehydrateRetryableJobs")(function* () {
        const startedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        const startedEvent = new WideEvent({
          timestamp: startedAt,
          eventName: "queue.rehydration.started",
        })
        yield* emitEvent(startedEvent).pipe(
          Effect.mapError(
            (error) => new StartupRecoveryFailed({ message: String(error) }),
          ),
        )

        const jobs = yield* jobRepo
          .listNonTerminal()
          .pipe(
            Effect.mapError(
              (error) => new StartupRecoveryFailed({ message: error.message }),
            ),
          )
        const retryableJobs = jobs.filter((job) =>
          requeueableStates.has(job.state),
        )

        yield* Effect.forEach(retryableJobs, (job) =>
          queueRuntime
            .enqueue(job.id)
            .pipe(
              Effect.mapError(
                (error) =>
                  new StartupRecoveryFailed({ message: String(error) }),
              ),
            ),
        )

        const completedAt = new Date(
          yield* Clock.currentTimeMillis,
        ).toISOString()
        const completedEvent = new WideEvent({
          timestamp: completedAt,
          eventName: "queue.rehydration.completed",
        })
        yield* emitEvent(completedEvent).pipe(
          Effect.mapError(
            (error) => new StartupRecoveryFailed({ message: String(error) }),
          ),
        )

        return retryableJobs
      })

    const repairCupsTrackedJobs: ReconcilerService["repairCupsTrackedJobs"] =
      Effect.fn("Reconciler.repairCupsTrackedJobs")(function* () {
        const startedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        const startedEvent = new WideEvent({
          timestamp: startedAt,
          eventName: "cups.job.repair.started",
        })
        yield* emitEvent(startedEvent).pipe(
          Effect.mapError(
            (error) => new StartupRecoveryFailed({ message: String(error) }),
          ),
        )

        const jobs = yield* jobRepo
          .listNonTerminal()
          .pipe(
            Effect.mapError(
              (error) => new StartupRecoveryFailed({ message: error.message }),
            ),
          )
        const cupsTrackedJobs = jobs.filter((job) =>
          cupsTrackedStates.has(job.state),
        )

        yield* Effect.forEach(cupsTrackedJobs, (job) =>
          reconcileCupsTrackedJob(job),
        )

        const completedAt = new Date(
          yield* Clock.currentTimeMillis,
        ).toISOString()
        const completedEvent = new WideEvent({
          timestamp: completedAt,
          eventName: "cups.job.repair.completed",
        })
        yield* emitEvent(completedEvent).pipe(
          Effect.mapError(
            (error) => new StartupRecoveryFailed({ message: String(error) }),
          ),
        )

        return cupsTrackedJobs
      })

    const recoverStartup: ReconcilerService["recoverStartup"] = Effect.fn(
      "Reconciler.recoverStartup",
    )(function* () {
      const rehydratedJobs = yield* rehydrateRetryableJobs()
      const repairedJobs = yield* repairCupsTrackedJobs()
      return [...rehydratedJobs, ...repairedJobs] as const
    })

    return Reconciler.of({
      rehydrateRetryableJobs,
      repairCupsTrackedJobs,
      recoverStartup,
    })
  }),
)
