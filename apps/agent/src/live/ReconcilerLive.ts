import { Clock } from "effect"
import { Effect, Layer } from "effect"

import { StartupRecoveryFailed } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"
import { transitionJob } from "../domain/StateMachine.js"
import { WideEvent } from "../domain/WideEvent.js"
import { CupsClient } from "../services/CupsClient.js"
import { EventSink } from "../services/EventSink.js"
import { JobRepo } from "../services/JobRepo.js"
import { QueueRuntime } from "../services/QueueRuntime.js"
import { Reconciler } from "../services/Reconciler.js"
import { Telemetry } from "../services/Telemetry.js"

const requeueableStates = new Set<string>([
  "Queued",
  "WaitingForPrinter",
  "WaitingForCups",
  "RetryScheduled",
])

const cupsTrackedStates = new Set<string>(["Submitted", "Printing"])

export const ReconcilerLive = Layer.effect(
  Reconciler,
  Effect.gen(function* () {
    const jobRepo = yield* JobRepo
    const queueRuntime = yield* QueueRuntime
    const eventSink = yield* EventSink
    const telemetry = yield* Telemetry
    const cupsClient = yield* CupsClient

    const emitEvent = (event: WideEvent) =>
      eventSink.append(event).pipe(
        Effect.zipRight(telemetry.emit(event).pipe(Effect.catchAll(() => Effect.void))),
      )

    const persistTransition = (job: Job, event: WideEvent) =>
      jobRepo.save(job).pipe(
        Effect.zipRight(jobRepo.appendTransition(job.id, event)),
        Effect.zipRight(emitEvent(event)),
      )

    const reconcileCupsTrackedJob = (job: Job) =>
      Effect.gen(function* () {
        if (job.cupsJobId === undefined) {
          return
        }

        const activeJobs = yield* cupsClient.listRecentJobs().pipe(
          Effect.catchAll(() => Effect.succeed(null)),
        )
        if (activeJobs === null) {
          return
        }

        const stillActive = activeJobs.some(
          (activeJob) => activeJob.cupsJobId === job.cupsJobId,
        )
        if (stillActive) {
          return
        }

        const occurredAt = new Date(yield* Clock.currentTimeMillis).toISOString()
        const result = transitionJob(job, { _tag: "Completed" }, occurredAt)
        if (result._tag === "InvalidTransition") {
          return yield* Effect.dieMessage(result.reason)
        }

        yield* persistTransition(result.job, result.event).pipe(
          Effect.mapError((error) =>
            StartupRecoveryFailed.make({ message: String(error) }),
          ),
        )
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
