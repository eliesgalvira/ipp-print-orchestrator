import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"

import { AppConfig } from "./config/AppConfig.js"
import { HttpLive } from "./http/HttpServer.js"
import { MainLayer } from "./live/MainLayer.js"
import { startObservability, withObservability } from "./observability/index.js"
import { Heartbeat } from "./services/Heartbeat.js"
import { Orchestrator } from "./services/Orchestrator.js"
import { QueueRuntime } from "./services/QueueRuntime.js"
import { Reconciler } from "./services/Reconciler.js"
import { loadAppEnv } from "./util/loadAppEnv.js"

loadAppEnv()
await startObservability()

const program = Effect.scoped(
  Effect.gen(function* () {
    const config = yield* AppConfig
    const queueRuntime = yield* QueueRuntime
    const orchestrator = yield* Orchestrator
    const reconciler = yield* Reconciler
    const heartbeat = yield* Heartbeat

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

    const heartbeatLoop = Effect.forever(
      Effect.gen(function* () {
        yield* heartbeat.beat().pipe(
          Effect.catchAll((error) =>
            Console.error(`heartbeat failed: ${error._tag}: ${error.message}`),
          ),
        )
        yield* Effect.sleep(config.heartbeatIntervalMs)
      }),
    )

    yield* Effect.forkScoped(Layer.launch(HttpLive))
    yield* Effect.forkScoped(workerLoop)
    yield* Effect.forkScoped(reconcileLoop)
    yield* Effect.forkScoped(heartbeatLoop)
    return yield* Effect.never
  }),
)

program.pipe(withObservability, Effect.provide(MainLayer), NodeRuntime.runMain)
