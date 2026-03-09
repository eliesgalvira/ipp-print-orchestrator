import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import { MainLayer } from "../live/MainLayer.js"
import { Orchestrator } from "../services/Orchestrator.js"
import { QueueRuntime } from "../services/QueueRuntime.js"
import { Reconciler } from "../services/Reconciler.js"

export const workerProgram = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* AppConfig
    const queueRuntime = yield* QueueRuntime
    const orchestrator = yield* Orchestrator
    const reconciler = yield* Reconciler

    const workerLoop = Effect.forever(
      Effect.gen(function* () {
        const jobId = yield* queueRuntime.take()
        yield* orchestrator.processJob(jobId).pipe(
          Effect.tapError((error) =>
            Console.error(
              `job ${String(jobId)} failed: ${error._tag}: ${error.message}`,
            ),
          ),
          Effect.catchAll(() => Effect.void),
        )
      }),
    )

    const reconcileLoop = Effect.forever(
      Effect.gen(function* () {
        yield* reconciler.reconcileStartup().pipe(
          Effect.catchAll((error) =>
            Console.error(`startup reconciliation failed: ${error.message}`),
          ),
        )
        yield* Effect.sleep(config.reconcileIntervalMs)
      }),
    )

    yield* Effect.forkScoped(workerLoop)
    yield* Effect.forkScoped(reconcileLoop)
    return yield* Effect.never
  }),
)

workerProgram.pipe(Effect.provide(MainLayer), NodeRuntime.runMain)
