import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"

import { MainLayer } from "../live/MainLayer.js"
import {
  startObservability,
  withObservability,
} from "../observability/index.js"
import { Reconciler } from "../services/Reconciler.js"
import { loadAppEnv } from "../util/loadAppEnv.js"

await loadAppEnv()
await startObservability()

const program = Effect.gen(function* () {
  const reconciler = yield* Reconciler
  const jobs = yield* reconciler.recoverStartup()
  yield* Console.log(`recovered ${jobs.length} nonterminal jobs`)
})

const main = Effect.scoped(
  Effect.gen(function* () {
    const services = yield* Layer.build(MainLayer)
    return yield* program.pipe(
      withObservability,
      Effect.provideServices(services),
    )
  }),
)

NodeRuntime.runMain(main)
