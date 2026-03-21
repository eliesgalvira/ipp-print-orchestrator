import { Effect } from "effect"
import * as ServiceMap from "effect/ServiceMap"

import { StartupRecoveryFailed } from "../domain/Errors.js"
import type { Job } from "../domain/Job.js"

export class Reconciler extends ServiceMap.Service<
  Reconciler,
  {
    readonly reconcileStartup: () => Effect.Effect<
      readonly Job[],
      StartupRecoveryFailed
    >
  }
>()("@ipp/agent/Reconciler") {}
