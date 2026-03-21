import { NodeFileSystem, NodePath, NodeRuntime } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"

import { MainLayer } from "../live/MainLayer.js"
import { startObservability, withObservability } from "../observability/index.js"
import { Reconciler } from "../services/Reconciler.js"
import { loadAppEnv } from "../util/loadAppEnv.js"

loadAppEnv()
await startObservability()

const program = Effect.gen(function* () {
  const reconciler = yield* Reconciler
  const jobs = yield* reconciler.reconcileStartup()
  yield* Console.log(`reconciled ${jobs.length} nonterminal jobs`)
})

const runtimeLayer = MainLayer.pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
)

program.pipe(
  withObservability,
  Effect.provide(runtimeLayer),
  NodeRuntime.runMain,
)
