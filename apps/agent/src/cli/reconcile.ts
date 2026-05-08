import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"

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

// @effect-diagnostics-next-line effect/strictEffectProvide:off
const main = program.pipe(withObservability, Effect.provide(MainLayer))

NodeRuntime.runMain(main)
