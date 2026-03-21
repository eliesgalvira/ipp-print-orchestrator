import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"

import { AppConfig } from "../config/AppConfig.js"
import { MainLayer } from "../live/MainLayer.js"
import { startObservability, withObservability } from "../observability/index.js"
import { Orchestrator } from "../services/Orchestrator.js"
import { QueueRuntime } from "../services/QueueRuntime.js"
import { Reconciler } from "../services/Reconciler.js"
import { loadAppEnv } from "../util/loadAppEnv.js"

loadAppEnv()
await startObservability()

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
          Effect.catch(() => Effect.void),
        )
      }),
    )

    const reconcileLoop = Effect.forever(
      Effect.gen(function* () {
        yield* reconciler.reconcileStartup().pipe(
          Effect.catch((error) =>
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

const runtimeLayer = MainLayer.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
)

workerProgram.pipe(
  withObservability,
  Effect.provide(runtimeLayer),
  NodeRuntime.runMain,
)
