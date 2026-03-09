import { Clock } from "effect"
import { Effect, Layer } from "effect"

import { StartupRecoveryFailed } from "../domain/Errors.js"
import { WideEvent } from "../domain/WideEvent.js"
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

export const ReconcilerLive = Layer.effect(
  Reconciler,
  Effect.gen(function* () {
    const jobRepo = yield* JobRepo
    const queueRuntime = yield* QueueRuntime
    const eventSink = yield* EventSink
    const telemetry = yield* Telemetry

    const emitEvent = (event: WideEvent) =>
      eventSink.append(event).pipe(
        Effect.zipRight(telemetry.emit(event).pipe(Effect.catchAll(() => Effect.void))),
      )

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
