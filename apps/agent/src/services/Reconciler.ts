import { Context, Effect } from "effect"

import { StartupRecoveryFailed } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"

export class Reconciler extends Context.Tag("@ipp/agent/Reconciler")<
  Reconciler,
  {
    readonly reconcileStartup: () => Effect.Effect<
      readonly Job[],
      StartupRecoveryFailed
    >
  }
>() {}
