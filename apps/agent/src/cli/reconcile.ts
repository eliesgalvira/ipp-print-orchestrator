import { NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"

import { MainLayer } from "../live/MainLayer.js"
import { Reconciler } from "../services/Reconciler.js"
import { loadAppEnv } from "../util/loadAppEnv.js"

loadAppEnv()

const program = Effect.gen(function* () {
  const reconciler = yield* Reconciler
  const jobs = yield* reconciler.reconcileStartup()
  yield* Console.log(`reconciled ${jobs.length} nonterminal jobs`)
})

program.pipe(Effect.provide(MainLayer), NodeRuntime.runMain)
